import type { Surface as SkSurface } from "canvaskit-wasm";
import * as PIXI from "pixi.js-legacy";

import { attachSkiaPointerForwarding } from "./events";
import { makeRandomShape } from "./randomShapes";
import { SCENES, type Scene } from "./scenes";
import { loadCanvasKit } from "./skia/canvaskitLoader";
import { exportContainerToPdf } from "./skia/pdfExport";
import { SkiaPixiRenderer } from "./skia/SkiaPixiRenderer";

const STAGE_W = 800;
const STAGE_H = 600;

// --- DOM ----------------------------------------------------------------
const pixiHost = document.getElementById("pixi-host") as HTMLDivElement;
const skiaCanvas = document.getElementById("skia-canvas") as HTMLCanvasElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const logEl = document.getElementById("event-log") as HTMLPreElement;
const btnRandom = document.getElementById("btn-random") as HTMLButtonElement;
const btnNextScene = document.getElementById("btn-next-scene") as HTMLButtonElement;
const btnClear = document.getElementById("btn-clear") as HTMLButtonElement;
const btnExportPdf = document.getElementById("btn-export-pdf") as HTMLButtonElement;

// --- Журнал событий -----------------------------------------------------
function log(msg: string): void {
  const ts = new Date().toLocaleTimeString();
  logEl.textContent = `[${ts}] ${msg}\n${logEl.textContent ?? ""}`;
}

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

// --- PIXI ---------------------------------------------------------------
// `forceCanvas: true` требуется по ТЗ; в связке с
// `pixi.js-legacy@7.2.4` PIXI создаёт CanvasRenderer вместо WebGL.
const app = new PIXI.Application({
  width: STAGE_W,
  height: STAGE_H,
  backgroundColor: 0xffffff,
  forceCanvas: true,
  antialias: true,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
});
pixiHost.appendChild(app.view as HTMLCanvasElement);

let currentSceneIdx = 0;
let currentRoot: PIXI.Container = SCENES[currentSceneIdx].build(log);
let extras: PIXI.Container = new PIXI.Container();
let topContainer: PIXI.Container = wrapTop(currentRoot, extras);
app.stage.addChild(topContainer);

function wrapTop(scene: PIXI.Container, extra: PIXI.Container): PIXI.Container {
  // «Верхний» контейнер, который отображается одновременно на PIXI- и
  // Skia-канвасах, хранит активную сцену вместе со случайными фигурами,
  // добавленными пользователем через кнопку. Разделение нужно, чтобы
  // «Очистить» и «Следующая сцена» работали независимо друг от друга.
  const top = new PIXI.Container();
  top.addChild(scene, extra);
  return top;
}

function setScene(idx: number): void {
  currentSceneIdx = idx % SCENES.length;
  app.stage.removeChild(topContainer);
  topContainer.destroy({ children: true });
  currentRoot = SCENES[currentSceneIdx].build(log);
  extras = new PIXI.Container();
  topContainer = wrapTop(currentRoot, extras);
  app.stage.addChild(topContainer);
  log(`scene → ${SCENES[currentSceneIdx].name}`);
  setStatus(`Scene: ${SCENES[currentSceneIdx].name}`);
}

// --- Инициализация Skia -------------------------------------------------
let skiaSurface: SkSurface | null = null;
let skiaRenderer: SkiaPixiRenderer | null = null;

async function initSkia(): Promise<void> {
  setStatus("Загрузка Skia (CanvasKit WASM)…");
  const ck = await loadCanvasKit();

  // Подгоняем размер бэкинг-стора канваса под DPR, чтобы рендер Skia
  // оставался чётким на ретина-дисплеях.
  const dpr = window.devicePixelRatio || 1;
  skiaCanvas.width = Math.floor(STAGE_W * dpr);
  skiaCanvas.height = Math.floor(STAGE_H * dpr);
  skiaCanvas.style.width = `${STAGE_W}px`;
  skiaCanvas.style.height = `${STAGE_H}px`;

  // Сначала пробуем WebGL-ускорение; при неудаче откатываемся на
  // программный (растровый) бекенд.
  skiaSurface =
    ck.MakeWebGLCanvasSurface(skiaCanvas) ?? ck.MakeSWCanvasSurface(skiaCanvas);
  if (!skiaSurface) {
    setStatus("Не удалось создать Skia-сёрфейс.");
    throw new Error("Could not create Skia surface");
  }

  skiaRenderer = new SkiaPixiRenderer(ck);

  // Пробрасываем DOM-события указателя со Skia-канваса в систему событий
  // Pixi, чтобы один и тот же DisplayObject получал их вне зависимости
  // от того, на каком канвасе был клик. Учитываем масштаб DPR.
  attachSkiaPointerForwarding(skiaCanvas, app);

  setStatus("Skia готов · оба канваса синхронизированы");
}

function renderSkiaFrame(): void {
  if (!skiaSurface || !skiaRenderer) return;
  const canvas = skiaSurface.getCanvas();
  const dpr = window.devicePixelRatio || 1;

  canvas.save();
  canvas.clear(skiaRenderer.canvasKit.WHITE);
  // Один раз применяем DPR-масштаб, чтобы дальше визитор мог работать
  // в логических (CSS) координатах, совпадающих со сценой PIXI.
  canvas.scale(dpr, dpr);
  skiaRenderer.render(topContainer, canvas);
  canvas.restore();
  skiaSurface.flush();
}

// На каждом тике PIXI заново «проигрываем» сцену в Skia. Обход дерева
// дешёвый по сравнению с тем, что уже делает Pixi, и так Skia-панель
// всегда остаётся в синхроне с любыми мутациями сцены во время работы.
app.ticker.add(renderSkiaFrame);

// --- Обработчики кнопок -------------------------------------------------
btnRandom.addEventListener("click", () => {
  const shape = makeRandomShape(log, { width: STAGE_W, height: STAGE_H });
  extras.addChild(shape);
  log(`+ random shape (extras: ${extras.children.length})`);
});

btnNextScene.addEventListener("click", () => {
  setScene(currentSceneIdx + 1);
});

btnClear.addEventListener("click", () => {
  if (extras.children.length === 0) return;
  extras.removeChildren().forEach((c) => c.destroy());
  log("extras cleared");
});

btnExportPdf.addEventListener("click", () => {
  setStatus("Сборка PDF…");
  try {
    exportContainerToPdf(topContainer, STAGE_W, STAGE_H);
    log("✓ Vector PDF exported");
    setStatus("PDF сохранён");
  } catch (err) {
    console.error(err);
    log(`✗ PDF export failed: ${(err as Error).message}`);
    setStatus("Ошибка экспорта PDF");
  }
});

// --- Авто-смена сцен каждые 12 с ---------------------------------------
// Закрывает альтернативный вариант интерактивности из ТЗ
// («переключение контейнеров по setTimeout») в дополнение к ручной кнопке.
let autoSwitch: number | null = window.setInterval(() => {
  setScene(currentSceneIdx + 1);
}, 12_000);
btnNextScene.addEventListener("click", () => {
  if (autoSwitch !== null) {
    window.clearInterval(autoSwitch);
    autoSwitch = null;
    log("auto-switch paused (manual navigation)");
  }
});

// --- Старт --------------------------------------------------------------
initSkia()
  .then(() => log(`scene → ${SCENES[currentSceneIdx].name}`))
  .catch((err: unknown) => {
    console.error(err);
    log(`Skia init failed: ${(err as Error).message}`);
  });

// Реэкспортим тип, чтобы TS с `noUnused*` не ругался на неиспользованный
// импорт — пригодится для будущих расширений.
export type { Scene };
