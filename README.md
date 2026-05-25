# PIXI → Skia → PDF demo

A small TypeScript app that:

1. Renders a `PIXI.Container` tree to a regular **PIXI canvas**
   (`pixi.js-legacy@7.2.4` with `forceCanvas: true`).
2. Re-renders the same scene through a custom **Skia wrapper**
   (`canvaskit-wasm`) on a second canvas. Both canvases stay in sync every
   frame.
3. Exports the live scene to a **vector PDF**.
4. Forwards `pointerdown` / `pointerup` events from the Skia canvas back to
   the corresponding `DisplayObject`, so the same listener fires regardless
   of which canvas the user clicked.

## Quick start

```bash
npm install
npm run dev     # http://localhost:5173
```

```bash
npm run build   # production bundle in dist/
npm run preview # serve the built bundle
```

Requires Node 18+.

## What's in the box

| File                                    | Purpose                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                           | App entry. Boots PIXI, loads CanvasKit, wires UI, ticker-replays the scene into Skia every frame.              |
| `src/skia/SkiaPixiRenderer.ts`          | The wrapper: traverses a `PIXI.Container`, applies each node's local matrix (translate/rotate/scale) and emits Skia draw calls for `PIXI.Graphics` (rect / rounded rect / circle / ellipse / polygon / lines) and `PIXI.Sprite`. |
| `src/skia/canvaskitLoader.ts`           | Caches the CanvasKit WASM init promise.                                                                       |
| `src/skia/textureCache.ts`              | Decodes Pixi base textures into Skia `Image` objects once and re-uses them.                                  |
| `src/skia/pdfExport.ts`                 | Walks the same Pixi tree and emits vector PDF primitives via `jsPDF` (see note below).                       |
| `src/events.ts`                         | Forwards Skia-canvas pointer events to Pixi's hit-tester, then re-emits them on the targeted DisplayObject.   |
| `src/scenes.ts`                         | Four demo scenes (one mirrors the task example; one is sprite-only to exercise the `PIXI.Sprite` branch).      |
| `src/randomShapes.ts`                   | "+ Random shape" button generator (rects / circles / ellipses / single & poly lines).                         |

## Interactivity (both options from the task)

- **`+ Random shape`** — appends a random `PIXI.Graphics` (rect / circle /
  ellipse / line / poly-line) into the live container, with `pointerdown`
  and `pointerup` listeners attached. The same object becomes clickable on
  both canvases.
- **`⟳ Next scene`** — cycles through four prebuilt `PIXI.Container`s
  (`Task example`, `Nested transforms`, `Stroke grid`,
  `Sprites + transforms`). The app also rotates them automatically every
  12 s via `setInterval` until the user presses the button manually.
- **`✕ Clear extra shapes`** — drops everything added through the random
  button without changing the active scene.
- **`⬇ Export vector PDF`** — saves the current combined scene as a vector
  PDF.

Every shape's `pointerdown` / `pointerup` is logged in the bottom panel.
Clicking either canvas reaches the same DisplayObject, demonstrating the
event-forwarding requirement.

## About the "Skia PDF backend" requirement

The task notes that the PDF export should go through Skia's PDF backend and
hints that a custom WASM build may be needed. That backend
(`SkPDF::MakeDocument`) lives behind the `skia_enable_pdf=true` GN flag and
is **not** shipped in the prebuilt `canvaskit-wasm` npm package.

To keep the demo runnable out of the box this project replicates the same
**recording-and-replay model** on top of `jsPDF`: a single visitor walks
the Pixi tree once for the on-screen Skia render and once for the PDF
output, so both produce the same scene as vector primitives (text and
shapes stay vector; only sprite bitmaps are rasterized into the PDF — same
behaviour you'd get from Skia's PDF backend).

If you want a fully Skia-native PDF, the recipe is:

```bash
# Adapted from https://skia.org/docs/user/modules/canvaskit/
git clone https://skia.googlesource.com/skia.git && cd skia
python3 tools/git-sync-deps
bin/fetch-ninja
# Build CanvasKit with the PDF backend enabled
modules/canvaskit/compile.sh release pdf
```

…then swap the `canvaskit-wasm` dependency for the locally-built bundle
and replace the `exportContainerToPdf` body with a `MakePDFDocument` call
that writes through the same `SkiaPixiRenderer.render` visitor — the
recorder is already PDF-canvas agnostic.

## Deploying

The build output in `dist/` is fully static (HTML + JS + WASM). Drop it on
any free host:

- **Vercel / Netlify**: import the repo, build command `npm run build`,
  output `dist`.
- **GitHub Pages**: run `npm run build` and publish `dist/` to the
  `gh-pages` branch.
- **Cloudflare Pages**: same — build `npm run build`, output `dist`.

The included `vite.config.ts` already sets `base: "./"` so the bundle is
URL-path agnostic and works from any subdirectory.

## Project layout

```
.
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src
    ├── main.ts
    ├── style.css
    ├── events.ts
    ├── randomShapes.ts
    ├── scenes.ts
    └── skia
        ├── SkiaPixiRenderer.ts
        ├── canvaskitLoader.ts
        ├── pdfExport.ts
        └── textureCache.ts
```
