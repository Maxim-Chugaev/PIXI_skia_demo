import * as PIXI from "pixi.js-legacy";

import type { CanvasKit } from "./canvaskit-pdf.d.ts";
import type { SkiaPixiRenderer } from "./SkiaPixiRenderer";

/**
 * Экспортирует дерево `PIXI.Container` в векторный PDF через Skia PDF backend
 * (`SkPDF::MakeDocument` → `beginPage` → отрисовка → `close`).
 *
 * Используется тот же `SkiaPixiRenderer`, что и для on-screen рендера:
 * обход дерева, трансформации, Graphics и Sprite попадают в PDF как векторные
 * примитивы (растровые спрайты — как XObject, как и в нативном Skia PDF).
 */
export function exportContainerToPdf(
  ck: CanvasKit,
  renderer: SkiaPixiRenderer,
  container: PIXI.Container,
  width: number,
  height: number,
  filename = "pixi-skia-scene.pdf",
): void {
  const doc = ck.MakePDFDocument({
    title: "PIXI → Skia scene",
    creator: "pixi-skia-demo",
    rootTag: { id: 1, type: "Document" },
  });

  try {
    const canvas = doc.beginPage(width, height);
    canvas.clear(ck.WHITE);
    renderer.render(container, canvas);
    doc.endPage();

    const bytes = doc.close();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    doc.abort();
    throw err;
  }
}
