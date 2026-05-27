import type { CanvasKit, Image as SkImage } from "./canvaskit-pdf.d.ts";
import * as PIXI from "pixi.js-legacy";

/**
 * Кэш объектов `Image` из Skia, индексированный по базовой текстуре PIXI.
 * Благодаря ему одна и та же исходная картинка (PNG, страница атласа и т.д.)
 * декодируется в память Skia ровно один раз, даже если она используется
 * сразу во многих спрайтах или участвует во множестве перерисовок.
 */
export class SkiaImageCache {
  readonly #ck: CanvasKit;
  readonly #byBaseUid = new Map<number, SkImage | null>();

  constructor(canvasKit: CanvasKit) {
    this.#ck = canvasKit;
  }

  /**
   * Возвращает Skia-картинку для заданной PIXI-текстуры, декодируя
   * исходный битмап при первом обращении.
   *
   * Возвращает `null`, если битмап ещё недоступен (например, текстура
   * всё ещё загружается) либо если декодирование завершилось неудачей.
   */
  get(texture: PIXI.Texture): SkImage | null {
    const base = texture.baseTexture;
    const uid = base.uid;
    if (this.#byBaseUid.has(uid)) return this.#byBaseUid.get(uid) ?? null;

    const source = (base.resource as PIXI.BaseImageResource | undefined)?.source;
    const img = this.#decode(source);
    this.#byBaseUid.set(uid, img);
    return img;
  }

  /** Освобождает все закэшированные Skia-картинки и очищает мапу. */
  dispose(): void {
    for (const img of this.#byBaseUid.values()) {
      img?.delete();
    }
    this.#byBaseUid.clear();
  }

  // ------------------------------------------------------------------ приватные методы

  #decode(source: unknown): SkImage | null {
    if (!source) return null;
    const ck = this.#ck;

    // `HTMLImageElement` / `HTMLCanvasElement` / `ImageBitmap` —
    // CanvasKit умеет напрямую принимать любой CanvasImageSource.
    if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
      // Используем готовый DOM-хелпер: он рисует элемент во временный
      // канвас и заливает пиксели в Skia.
      return ck.MakeImageFromCanvasImageSource(source);
    }
    if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
      return ck.MakeImageFromCanvasImageSource(source);
    }
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
      return ck.MakeImageFromCanvasImageSource(source);
    }
    return null;
  }
}
