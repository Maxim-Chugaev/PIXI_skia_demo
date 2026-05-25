import { jsPDF } from "jspdf";
import * as PIXI from "pixi.js-legacy";

/**
 * Генерирует настоящий *векторный* PDF из дерева `PIXI.Container`.
 *
 * Архитектурно это родственник `SkiaPixiRenderer`: дерево обходит тот же
 * визитор, но вместо Skia-вызовов он собирает jsPDF-документ.
 *
 * Замечания по реализации
 * -----------------------
 * Высокоуровневое API jsPDF (`rect`, `circle`, `lines`, `addImage`)
 * работает в «пользовательском пространстве» с началом в левом верхнем
 * углу — внутри оно делает Y-flip в нативную систему PDF (Y вверх,
 * начало в левом нижнем). Матричное же API
 * (`setCurrentTransformationMatrix`) работает уже в нативной системе
 * PDF и поэтому НЕ совместимо с PIXI-матрицами (Y вниз). Смешение
 * этих двух режимов приводит к тому, что содержимое уезжает за пределы
 * страницы.
 *
 * Чтобы этого избежать, мы сами считаем world-матрицу каждого узла
 * и трансформируем вершины каждой фигуры в абсолютные координаты
 * пользовательского пространства, а затем эмитим результат
 * исключительно через высокоуровневое API. Кривые (круги, эллипсы,
 * скруглённые углы) аппроксимируем кубическими безье, чтобы они
 * сохраняли форму при произвольном повороте и неравномерном масштабе
 * и оставались в PDF вектором.
 *
 * Про требование «Skia PDF backend»
 * ---------------------------------
 * По ТЗ экспорт желательно делать через родной PDF-бекенд Skia
 * (`SkPDF::MakeDocument`). Этот бекенд закрыт GN-флагом
 * `skia_enable_pdf=true` и *не* входит в готовый npm-пакет
 * `canvaskit-wasm` — чтобы им воспользоваться, нужно собрать
 * собственный CanvasKit WASM из исходников Skia (рецепт в README).
 * Чтобы демо запускалось «из коробки», мы воспроизводим ту же модель
 * «запись → проигрывание» поверх jsPDF; визитор устроен так, что для
 * перехода на настоящий `MakePDFDocument().beginPage()` достаточно
 * заменить хелперы `emit*` на их Skia-эквиваленты.
 */
export function exportContainerToPdf(
  container: PIXI.Container,
  width: number,
  height: number,
  filename = "pixi-skia-scene.pdf",
): void {
  // Используем "pt", чтобы страница была ровно `width × height` точек,
  // а наши пиксельные координаты ложились 1:1 на пользовательское
  // пространство. Без хотфикса `px_scaling`: он скейлит примитивы
  // рисования, но не скейлит трансляции в матричном API — и тихо
  // утаскивает трансформированное содержимое за пределы страницы.
  const doc = new jsPDF({
    unit: "pt",
    format: [width, height],
    orientation: width >= height ? "landscape" : "portrait",
  });

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, width, height, "F");

  drawNode(container, doc, IDENTITY, 1);

  doc.save(filename);
}

// ---------------------------------------------------------------- матричная математика

/**
 * Аффинная матрица в конвенции PIXI / Skia:
 *   | a c tx |
 *   | b d ty |
 *   | 0 0  1 |
 *
 * Точка `(x, y)` переводится как
 *   x' = a*x + c*y + tx
 *   y' = b*x + d*y + ty
 */
interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function multiply(p: Mat, l: Mat): Mat {
  return {
    a: p.a * l.a + p.c * l.b,
    b: p.b * l.a + p.d * l.b,
    c: p.a * l.c + p.c * l.d,
    d: p.b * l.c + p.d * l.d,
    tx: p.a * l.tx + p.c * l.ty + p.tx,
    ty: p.b * l.tx + p.d * l.ty + p.ty,
  };
}

function transformPoint(m: Mat, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.tx, m.b * x + m.d * y + m.ty];
}

// ---------------------------------------------------------------- обход дерева

function drawNode(
  node: PIXI.DisplayObject,
  doc: jsPDF,
  parentMatrix: Mat,
  parentAlpha: number,
): void {
  if (!node.visible) return;

  const local = node.transform.localTransform;
  const world = multiply(parentMatrix, {
    a: local.a,
    b: local.b,
    c: local.c,
    d: local.d,
    tx: local.tx,
    ty: local.ty,
  });
  const alpha = parentAlpha * (node.alpha ?? 1);
  if (alpha <= 0) return;

  if (node instanceof PIXI.Graphics) {
    drawGraphics(node, doc, world, alpha);
  } else if (node instanceof PIXI.Sprite) {
    drawSprite(node, doc, world, alpha);
  }

  if (node instanceof PIXI.Container) {
    for (const child of node.children) {
      drawNode(child, doc, world, alpha);
    }
  }
}

// ---------------------------------------------------------------- графика

function drawGraphics(
  g: PIXI.Graphics,
  doc: jsPDF,
  world: Mat,
  alpha: number,
): void {
  const data = g.geometry.graphicsData;
  if (!data || data.length === 0) return;

  for (const d of data) {
    const hasFill = d.fillStyle && d.fillStyle.visible;
    const hasStroke = d.lineStyle && d.lineStyle.visible && d.lineStyle.width > 0;
    if (!hasFill && !hasStroke) continue;

    const path = shapeToPath(d.shape);
    if (!path) continue;

    // Учитываем средний world-масштаб в толщине обводки, чтобы линия,
    // объявленная как «10pt» в PIXI, выглядела ~10pt и в документе.
    const strokeScale = Math.sqrt(Math.abs(world.a * world.d - world.b * world.c));

    if (hasFill) {
      const [r, gg, b] = rgbFromInt(d.fillStyle.color);
      doc.setFillColor(r, gg, b);
      doc.setGState(
        doc.GState({ opacity: (d.fillStyle.alpha ?? 1) * alpha }),
      );
    }
    if (hasStroke) {
      const [r, gg, b] = rgbFromInt(d.lineStyle.color);
      doc.setDrawColor(r, gg, b);
      doc.setLineWidth(d.lineStyle.width * strokeScale);
      doc.setGState(
        doc.GState({ "stroke-opacity": (d.lineStyle.alpha ?? 1) * alpha }),
      );
      doc.setLineCap(pdfLineCap(d.lineStyle.cap));
      doc.setLineJoin(pdfLineJoin(d.lineStyle.join));
    }
    const style: "F" | "S" | "FD" =
      hasFill && hasStroke ? "FD" : hasFill ? "F" : "S";

    emitPath(doc, path, world, style);
  }
}

// ---------------------------------------------------------------- модель пути

/**
 * Подпуть — это список кубических безье-сегментов плюс явная стартовая
 * точка. Каждый сегмент несёт ДВЕ контрольные точки и конечную точку;
 * прямые линии кодируются вырожденным кубиком (контрольные точки
 * совпадают с концами), благодаря чему мы всегда эмитим один вызов
 * jsPDF `lines(...)` — независимо от типа исходного примитива.
 */
interface SubPath {
  start: [number, number];
  segments: CubicSegment[];
  closed: boolean;
}

interface CubicSegment {
  c1: [number, number];
  c2: [number, number];
  end: [number, number];
}

/** Константа аппроксимации четверти круга кубическим безье (kappa). */
const K = 0.5522847498307933;

function shapeToPath(shape: PIXI.IShape): SubPath | null {
  switch (shape.type) {
    case PIXI.SHAPES.RECT: {
      const r = shape as PIXI.Rectangle;
      return polyToPath(
        [
          [r.x, r.y],
          [r.x + r.width, r.y],
          [r.x + r.width, r.y + r.height],
          [r.x, r.y + r.height],
        ],
        true,
      );
    }
    case PIXI.SHAPES.RREC: {
      const r = shape as PIXI.RoundedRectangle;
      return roundedRectPath(r.x, r.y, r.width, r.height, r.radius);
    }
    case PIXI.SHAPES.CIRC: {
      const c = shape as PIXI.Circle;
      return ellipsePath(c.x, c.y, c.radius, c.radius);
    }
    case PIXI.SHAPES.ELIP: {
      const e = shape as PIXI.Ellipse;
      return ellipsePath(e.x, e.y, e.width, e.height);
    }
    case PIXI.SHAPES.POLY: {
      const p = shape as PIXI.Polygon;
      const pts = p.points;
      if (pts.length < 2) return null;
      const verts: [number, number][] = [];
      for (let i = 0; i < pts.length; i += 2) verts.push([pts[i], pts[i + 1]]);
      return polyToPath(verts, !!p.closeStroke);
    }
    default:
      return null;
  }
}

function polyToPath(points: [number, number][], closed: boolean): SubPath {
  const start = points[0];
  const segments: CubicSegment[] = [];
  for (let i = 1; i < points.length; i++) {
    segments.push(lineSegment(points[i - 1], points[i]));
  }
  if (closed && points.length > 2) {
    segments.push(lineSegment(points[points.length - 1], start));
  }
  return { start, segments, closed };
}

function lineSegment(
  from: [number, number],
  to: [number, number],
): CubicSegment {
  // Кодируем прямой отрезок как вырожденный кубик: контрольные точки
  // совпадают с концами отрезка, и кривая-рендерер jsPDF всё равно
  // отрисует это как линию.
  return { c1: from, c2: to, end: to };
}

function ellipsePath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): SubPath {
  const ox = rx * K;
  const oy = ry * K;
  // Стартуем из самой правой точки, обходим по часовой.
  const start: [number, number] = [cx + rx, cy];
  const segments: CubicSegment[] = [
    {
      c1: [cx + rx, cy + oy],
      c2: [cx + ox, cy + ry],
      end: [cx, cy + ry],
    },
    {
      c1: [cx - ox, cy + ry],
      c2: [cx - rx, cy + oy],
      end: [cx - rx, cy],
    },
    {
      c1: [cx - rx, cy - oy],
      c2: [cx - ox, cy - ry],
      end: [cx, cy - ry],
    },
    {
      c1: [cx + ox, cy - ry],
      c2: [cx + rx, cy - oy],
      end: [cx + rx, cy],
    },
  ];
  return { start, segments, closed: true };
}

function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): SubPath {
  const radius = Math.min(r, w / 2, h / 2);
  const o = radius * K;
  const x2 = x + w;
  const y2 = y + h;

  const start: [number, number] = [x + radius, y];
  const segments: CubicSegment[] = [];

  segments.push(lineSegment([x + radius, y], [x2 - radius, y]));
  // верхний-правый угол
  segments.push({
    c1: [x2 - radius + o, y],
    c2: [x2, y + radius - o],
    end: [x2, y + radius],
  });
  segments.push(lineSegment([x2, y + radius], [x2, y2 - radius]));
  // нижний-правый угол
  segments.push({
    c1: [x2, y2 - radius + o],
    c2: [x2 - radius + o, y2],
    end: [x2 - radius, y2],
  });
  segments.push(lineSegment([x2 - radius, y2], [x + radius, y2]));
  // нижний-левый угол
  segments.push({
    c1: [x + radius - o, y2],
    c2: [x, y2 - radius + o],
    end: [x, y2 - radius],
  });
  segments.push(lineSegment([x, y2 - radius], [x, y + radius]));
  // верхний-левый угол
  segments.push({
    c1: [x, y + radius - o],
    c2: [x + radius - o, y],
    end: [x + radius, y],
  });

  return { start, segments, closed: true };
}

// ---------------------------------------------------------------- эмит

function emitPath(
  doc: jsPDF,
  path: SubPath,
  world: Mat,
  style: "F" | "S" | "FD",
): void {
  // Трансформируем стартовую точку, а также конечные и контрольные
  // точки каждого сегмента в world-пространство (= пользовательское
  // пространство PDF), а затем переводим каждый сегмент в ОТНОСИТЕЛЬНУЮ
  // форму, которую ожидает jsPDF-метод `lines(...)`.
  const [sx, sy] = transformPoint(world, path.start[0], path.start[1]);
  let prevX = sx;
  let prevY = sy;
  const segs: number[][] = [];

  for (const seg of path.segments) {
    const [c1x, c1y] = transformPoint(world, seg.c1[0], seg.c1[1]);
    const [c2x, c2y] = transformPoint(world, seg.c2[0], seg.c2[1]);
    const [ex, ey] = transformPoint(world, seg.end[0], seg.end[1]);
    segs.push([
      c1x - prevX,
      c1y - prevY,
      c2x - prevX,
      c2y - prevY,
      ex - prevX,
      ey - prevY,
    ]);
    prevX = ex;
    prevY = ey;
  }

  doc.lines(segs, sx, sy, [1, 1], style, path.closed);
}

// ----------------------------------------------------------------- спрайт

function drawSprite(
  sprite: PIXI.Sprite,
  doc: jsPDF,
  world: Mat,
  alpha: number,
): void {
  const tex = sprite.texture;
  const source = (
    tex.baseTexture.resource as PIXI.BaseImageResource | undefined
  )?.source;
  const dataUrl = sourceToDataUrl(source, tex.frame);
  if (!dataUrl) return;

  const w = tex.orig.width;
  const h = tex.orig.height;
  const ox = -sprite.anchor.x * w;
  const oy = -sprite.anchor.y * h;

  // Раскладываем world-матрицу на translate + rotate + scale.
  // На практике PIXI не использует skew для спрайтов, поэтому чистого
  // TRS-разложения нам тут достаточно.
  const scaleX = Math.sqrt(world.a * world.a + world.b * world.b) || 1;
  const scaleY = Math.sqrt(world.c * world.c + world.d * world.d) || 1;
  // Atan2 от X-базисного вектора — та же конвенция, что у PIXI / Skia.
  const angleRad = Math.atan2(world.b, world.a);
  const angleDeg = angleRad * (180 / Math.PI);

  const widthOut = w * scaleX;
  const heightOut = h * scaleY;

  // Левый верхний угол с учётом якоря в world-координатах
  // (по центру, если anchor = 0.5).
  const [tlx, tly] = transformPoint(world, ox, oy);

  doc.setGState(doc.GState({ opacity: alpha }));

  // `addImage` в jsPDF вращает картинку вокруг её собственного
  // левого верхнего угла; если поворота нет — используем простую
  // форму без угла.
  if (Math.abs(angleDeg) < 1e-3) {
    doc.addImage(dataUrl, "PNG", tlx, tly, widthOut, heightOut);
  } else {
    // Чтобы сохранить визуальное положение, ставим левый верхний угол
    // ровно туда, куда его перенесла world-матрица: это та же точка,
    // что получается из локального начала координат после применения
    // всей цепочки трансформаций.
    doc.addImage(
      dataUrl,
      "PNG",
      tlx,
      tly,
      widthOut,
      heightOut,
      undefined,
      undefined,
      angleDeg,
    );
  }

  doc.setGState(doc.GState({ opacity: 1 }));
}

function sourceToDataUrl(source: unknown, frame: PIXI.Rectangle): string | null {
  if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
    return source.toDataURL("image/png");
  }
  if (
    (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) ||
    (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap)
  ) {
    const c = document.createElement("canvas");
    c.width = frame.width;
    c.height = frame.height;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(
      source as CanvasImageSource,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      0,
      0,
      frame.width,
      frame.height,
    );
    return c.toDataURL("image/png");
  }
  return null;
}

// ----------------------------------------------------------------- утилиты

function rgbFromInt(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function pdfLineCap(cap: PIXI.LINE_CAP): "butt" | "round" | "square" {
  switch (cap) {
    case PIXI.LINE_CAP.ROUND:
      return "round";
    case PIXI.LINE_CAP.SQUARE:
      return "square";
    default:
      return "butt";
  }
}

function pdfLineJoin(join: PIXI.LINE_JOIN): "miter" | "round" | "bevel" {
  switch (join) {
    case PIXI.LINE_JOIN.ROUND:
      return "round";
    case PIXI.LINE_JOIN.BEVEL:
      return "bevel";
    default:
      return "miter";
  }
}
