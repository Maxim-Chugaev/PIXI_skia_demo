import type { CanvasKit } from "./canvaskit-pdf.d.ts";
// CJS-модуль Emscripten; Vite делает interop на default export.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error vendor bundle без типов
import CanvasKitInit from "../vendor/canvaskit-pdf.js";

let cached: Promise<CanvasKit> | null = null;

/** Абсолютный URL статики из `public/` (WASM лежит там, не в бандле). */
function publicUrl(relativePath: string): string {
  return new URL(`${import.meta.env.BASE_URL}${relativePath}`, window.location.href).href;
}

/**
 * Лениво загружает и кэширует CanvasKit (Skia) WASM с включённым PDF backend.
 *
 * JS-бандл — `src/vendor/canvaskit-pdf.js`, WASM — `public/canvaskit-pdf/canvaskit-pdf.wasm`.
 * Пересборка WASM: `npm run build:canvaskit-pdf`.
 */
export function loadCanvasKit(): Promise<CanvasKit> {
  if (!cached) {
    cached = (async () => {
      const init = CanvasKitInit as (opts?: {
        locateFile?: (file: string) => string;
      }) => Promise<CanvasKit>;

      const ck = await init({
        locateFile: (file) =>
          file === "canvaskit.wasm"
            ? publicUrl("canvaskit-pdf/canvaskit-pdf.wasm")
            : publicUrl(`canvaskit-pdf/${file}`),
      });

      if (!ck.pdf) {
        throw new Error(
          "CanvasKit загружен без PDF backend. Пересоберите WASM: npm run build:canvaskit-pdf",
        );
      }
      return ck;
    })();
  }
  return cached;
}
