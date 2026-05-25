import type {
  Canvas as SkCanvas,
  CanvasKit,
  Image as SkImage,
  Paint as SkPaint,
  Path as SkPath,
} from "canvaskit-wasm";
import * as PIXI from "pixi.js-legacy";

import { SkiaImageCache } from "./textureCache";

/**
 * Публичный фасад, превращающий дерево `PIXI.Container` в Skia-вызовы
 * и проигрывающий их на любой `SkCanvas` (живой сёрфейс, SVG-рекордер,
 * picture-рекордер и т.д.).
 *
 * Реализация обходит дерево DisplayObject'ов сверху вниз, учитывает
 * локальную трансформацию каждого узла (translate / rotate / scale /
 * pivot / skew через матрицу), параметры видимости и альфы, и эмитит
 * Skia-вызовы для минимального набора фигур, требуемого ТЗ:
 *   - `PIXI.Graphics` (прямоугольники, скруглённые прямоугольники,
 *     круги, эллипсы, полигоны, линии из `moveTo` / `lineTo`)
 *   - `PIXI.Sprite` (растровые картинки, декодируются один раз
 *     на базовую текстуру PIXI и кэшируются как Skia `Image`).
 *
 * Все остальные типы (Text, Mesh, ParticleContainer и т.д.) молча
 * пропускаются — расширение визитора сводится к добавлению ещё одной
 * ветки в `#drawNode`.
 */
export class SkiaPixiRenderer {
  readonly #ck: CanvasKit;
  readonly #images: SkiaImageCache;

  constructor(canvasKit: CanvasKit) {
    this.#ck = canvasKit;
    this.#images = new SkiaImageCache(canvasKit);
  }

  /** Удобный доступ к лежащему в основе экземпляру CanvasKit. */
  get canvasKit(): CanvasKit {
    return this.#ck;
  }

  /**
   * Проигрывает дерево Pixi-контейнера в Skia-канвас.
   *
   * Переданный `canvas` мутируется по месту. Очистку и `flush()`
   * сёрфейса вокруг этого вызова обеспечивает вызывающая сторона.
   */
  render(container: PIXI.Container, canvas: SkCanvas): void {
    this.#drawNode(container, canvas);
  }

  /** Освобождает все ресурсы (GPU/CPU), занимаемые кэшем картинок. */
  dispose(): void {
    this.#images.dispose();
  }

  // ---------------------------------------------------------------- обход дерева

  #drawNode(node: PIXI.DisplayObject, canvas: SkCanvas): void {
    if (!node.visible || node.worldAlpha === 0) return;

    canvas.save();
    try {
      // Применяем локальную трансформацию узла. `Matrix` из PIXI и
      // 3×3-матрица Skia используют одну и ту же row-major-конвенцию:
      //   | a c tx |
      //   | b d ty |
      //   | 0 0  1 |
      const m = node.transform.localTransform;
      canvas.concat([m.a, m.c, m.tx, m.b, m.d, m.ty, 0, 0, 1]);

      if (node instanceof PIXI.Graphics) {
        this.#drawGraphics(node, canvas);
      } else if (node instanceof PIXI.Sprite) {
        this.#drawSprite(node, canvas);
      }

      if (node instanceof PIXI.Container) {
        for (const child of node.children) {
          this.#drawNode(child, canvas);
        }
      }
    } finally {
      canvas.restore();
    }
  }

  // ---------------------------------------------------------------- графика

  #drawGraphics(g: PIXI.Graphics, canvas: SkCanvas): void {
    // `graphicsData` — публичное, но «полу-внутреннее» поле PIXI, где
    // лежит каждая фигура/заливка/обводка, записанная через API
    // PIXI.Graphics.
    const data = g.geometry.graphicsData;
    if (!data || data.length === 0) return;

    for (const d of data) {
      const path = this.#shapeToPath(d.shape);
      if (!path) continue;

      try {
        // Сначала заливка, потом обводка — повторяем порядок отрисовки PIXI.
        if (d.fillStyle && d.fillStyle.visible) {
          const paint = this.#makeFillPaint(d.fillStyle, g.worldAlpha);
          canvas.drawPath(path, paint);
          paint.delete();
        }
        if (d.lineStyle && d.lineStyle.visible && d.lineStyle.width > 0) {
          const paint = this.#makeStrokePaint(d.lineStyle, g.worldAlpha);
          canvas.drawPath(path, paint);
          paint.delete();
        }
      } finally {
        path.delete();
      }
    }
  }

  #shapeToPath(shape: PIXI.IShape): SkPath | null {
    const ck = this.#ck;
    const path = new ck.Path();

    switch (shape.type) {
      case PIXI.SHAPES.RECT: {
        const r = shape as PIXI.Rectangle;
        path.addRect([r.x, r.y, r.x + r.width, r.y + r.height]);
        return path;
      }
      case PIXI.SHAPES.RREC: {
        const r = shape as PIXI.RoundedRectangle;
        path.addRRect([
          r.x,
          r.y,
          r.x + r.width,
          r.y + r.height,
          r.radius,
          r.radius,
          r.radius,
          r.radius,
          r.radius,
          r.radius,
          r.radius,
          r.radius,
        ]);
        return path;
      }
      case PIXI.SHAPES.CIRC: {
        const c = shape as PIXI.Circle;
        path.addOval([
          c.x - c.radius,
          c.y - c.radius,
          c.x + c.radius,
          c.y + c.radius,
        ]);
        return path;
      }
      case PIXI.SHAPES.ELIP: {
        const e = shape as PIXI.Ellipse;
        path.addOval([e.x - e.width, e.y - e.height, e.x + e.width, e.y + e.height]);
        return path;
      }
      case PIXI.SHAPES.POLY: {
        const p = shape as PIXI.Polygon;
        const pts = p.points;
        if (pts.length < 2) {
          path.delete();
          return null;
        }
        path.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) {
          path.lineTo(pts[i], pts[i + 1]);
        }
        if (p.closeStroke) path.close();
        return path;
      }
      default:
        path.delete();
        return null;
    }
  }

  #makeFillPaint(fill: PIXI.FillStyle, worldAlpha: number): SkPaint {
    const ck = this.#ck;
    const paint = new ck.Paint();
    paint.setStyle(ck.PaintStyle.Fill);
    paint.setAntiAlias(true);
    paint.setColor(
      ck.Color4f(...numberToRgb(fill.color), (fill.alpha ?? 1) * worldAlpha),
    );
    return paint;
  }

  #makeStrokePaint(line: PIXI.LineStyle, worldAlpha: number): SkPaint {
    const ck = this.#ck;
    const paint = new ck.Paint();
    paint.setStyle(ck.PaintStyle.Stroke);
    paint.setAntiAlias(true);
    paint.setStrokeWidth(line.width);
    paint.setColor(
      ck.Color4f(...numberToRgb(line.color), (line.alpha ?? 1) * worldAlpha),
    );
    paint.setStrokeCap(strokeCap(ck, line.cap));
    paint.setStrokeJoin(strokeJoin(ck, line.join));
    if (line.miterLimit) paint.setStrokeMiter(line.miterLimit);
    return paint;
  }

  // ------------------------------------------------------------------ спрайт

  #drawSprite(sprite: PIXI.Sprite, canvas: SkCanvas): void {
    const img: SkImage | null = this.#images.get(sprite.texture);
    if (!img) return;

    const tex = sprite.texture;
    const w = tex.orig.width;
    const h = tex.orig.height;

    // Компенсируем PIXI-якорь (сдвиг начала координат внутри спрайта).
    const ox = -sprite.anchor.x * w;
    const oy = -sprite.anchor.y * h;

    const ck = this.#ck;
    const paint = new ck.Paint();
    paint.setAntiAlias(true);
    if (sprite.worldAlpha < 1) {
      paint.setAlphaf(sprite.worldAlpha);
    }

    // Берём нужный кадр из исходной картинки (которая может быть
    // частью атласа).
    const src: [number, number, number, number] = [
      tex.frame.x,
      tex.frame.y,
      tex.frame.x + tex.frame.width,
      tex.frame.y + tex.frame.height,
    ];
    const dst: [number, number, number, number] = [ox, oy, ox + w, oy + h];

    canvas.drawImageRect(img, src, dst, paint);
    paint.delete();
  }
}

// ---------------------------------------------------------------- утилиты

function numberToRgb(color: number): [number, number, number] {
  // PIXI fillStyle.color — это 24-битное целое RGB.
  return [
    ((color >> 16) & 0xff) / 255,
    ((color >> 8) & 0xff) / 255,
    (color & 0xff) / 255,
  ];
}

function strokeCap(ck: CanvasKit, cap: PIXI.LINE_CAP) {
  switch (cap) {
    case PIXI.LINE_CAP.ROUND:
      return ck.StrokeCap.Round;
    case PIXI.LINE_CAP.SQUARE:
      return ck.StrokeCap.Square;
    default:
      return ck.StrokeCap.Butt;
  }
}

function strokeJoin(ck: CanvasKit, join: PIXI.LINE_JOIN) {
  switch (join) {
    case PIXI.LINE_JOIN.ROUND:
      return ck.StrokeJoin.Round;
    case PIXI.LINE_JOIN.BEVEL:
      return ck.StrokeJoin.Bevel;
    default:
      return ck.StrokeJoin.Miter;
  }
}
