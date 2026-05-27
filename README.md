# PIXI → Skia → PDF demo

TypeScript-приложение по тестовому заданию:

1. Рендерит `PIXI.Container` на **PIXI canvas** (`pixi.js-legacy@7.2.4`, `forceCanvas: true`).
2. Ту же сцену проигрывает через **Skia-обёртку** (`SkiaPixiRenderer`) на втором канвасе.
3. Экспортирует сцену в **векторный PDF** через **Skia PDF backend** (`MakePDFDocument`).
4. Пробрасывает `pointerdown` / `pointerup` с Skia-канваса на те же `DisplayObject`.

## Быстрый старт

```bash
npm install
npm run dev     # http://127.0.0.1:5173
```

```bash
npm run build   # production bundle в dist/
npm run preview
```

Требуется Node 18+.

## Skia WASM с PDF backend

Стандартный npm-пакет `canvaskit-wasm` собран с `skia_enable_pdf=false`.
В проекте используется **собственная сборка** CanvasKit с PDF:

| Файл | Назначение |
|------|------------|
| `public/canvaskit-pdf/canvaskit-pdf.js` | JS-обёртка Emscripten |
| `public/canvaskit-pdf/canvaskit-pdf.wasm` | Skia + PDF backend (~7 МБ) |
| `scripts/build-canvaskit-pdf.sh` | Скрипт пересборки WASM в Docker |
| `src/skia/canvaskit-pdf.d.ts` | TypeScript-типы (включая `MakePDFDocument`) |

### Пересборка WASM

```bash
npm run build:canvaskit-pdf
```

Скрипт в Docker (`emscripten/emsdk`):

1. Клонирует [pushpagarwal/skia](https://github.com/pushpagarwal/skia) (ветка `canvas-kit-pdf`).
2. Включает `skia_enable_pdf=true` в `modules/canvaskit/compile.sh`.
3. Запускает `./modules/canvaskit/compile.sh release`.
4. Копирует результат в `public/canvaskit-pdf/`.

> В репозитории уже лежит готовый `canvaskit-pdf.wasm`, чтобы `npm run dev` работал без Docker.

## Структура кода

| Файл | Назначение |
|------|------------|
| `src/skia/SkiaPixiRenderer.ts` | Обёртка Skia: обход `PIXI.Container`, Graphics + Sprite, трансформации |
| `src/skia/pdfExport.ts` | PDF через `ck.MakePDFDocument()` → `beginPage()` → `SkiaPixiRenderer.render()` → `close()` |
| `src/skia/canvaskitLoader.ts` | Загрузка `canvaskit-pdf.wasm` |
| `src/events.ts` | Проброс pointer-событий со Skia-канваса в Pixi |
| `src/scenes.ts` | 4 демо-сцены |
| `src/randomShapes.ts` | Кнопка «+ Random shape» |

## Интерактивность

- **`+ Random shape`** — случайные `PIXI.Graphics` с событиями.
- **`⟳ Next scene`** — переключение сцен (+ авто-смена каждые 12 с).
- **`✕ Clear extra shapes`** — очистка добавленных фигур.
- **`⬇ Export vector PDF`** — PDF через Skia PDF backend.

## Деплой

GitHub Pages: push в `main` → workflow собирает `dist/` и публикует.

Live: https://maxim-chugaev.github.io/PIXI_skia_demo/
