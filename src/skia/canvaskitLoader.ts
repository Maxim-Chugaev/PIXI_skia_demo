import CanvasKitInit, { type CanvasKit } from "canvaskit-wasm";
// Vite разрешает wasm-бинарник на этапе сборки и выдаёт хешированный
// URL, который мы передаём в коллбэк `locateFile` CanvasKit.
// eslint-disable-next-line import/no-unresolved
import canvasKitWasmUrl from "canvaskit-wasm/bin/canvaskit.wasm?url";

let cached: Promise<CanvasKit> | null = null;

/**
 * Лениво загружает и кэширует WASM-модуль CanvasKit (Skia).
 *
 * Повторные вызовы возвращают тот же промис — WASM-бинарь скачивается
 * и инициализируется ровно один раз за жизнь страницы.
 */
export function loadCanvasKit(): Promise<CanvasKit> {
  if (!cached) {
    cached = CanvasKitInit({
      locateFile: () => canvasKitWasmUrl,
    });
  }
  return cached;
}
