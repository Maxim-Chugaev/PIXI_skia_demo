import * as PIXI from "pixi.js-legacy";

/**
 * Подключает не-Pixi-канвас (например, Skia-сёрфейс) так, чтобы события
 * `pointerdown` и `pointerup` на нём пробрасывались на соответствующий
 * интерактивный `DisplayObject` внутри переданного Pixi-приложения.
 *
 * Хит-тест выполняется самим Pixi через `rootBoundary.hitTest` из его
 * системы событий — это гарантирует одинаковое поведение на обоих
 * канвасах: один и тот же DisplayObject получает событие независимо
 * от того, по какому канвасу пользователь кликнул.
 */
export function attachSkiaPointerForwarding(
  skiaCanvas: HTMLCanvasElement,
  app: PIXI.Application,
): () => void {
  const handler = (type: "pointerdown" | "pointerup") => (ev: PointerEvent) => {
    const rect = skiaCanvas.getBoundingClientRect();
    // CSS-пиксели → пиксели рендерера (учитываем CSS-масштаб и DPR).
    const sx = skiaCanvas.width / rect.width;
    const sy = skiaCanvas.height / rect.height;
    const x = ((ev.clientX - rect.left) * sx) / app.renderer.resolution;
    const y = ((ev.clientY - rect.top) * sy) / app.renderer.resolution;

    const point = new PIXI.Point(x, y);
    const events = app.renderer.events;
    const target = events.rootBoundary.hitTest(point.x, point.y);
    if (!target) return;

    // Собираем минимальный FederatedPointerEvent — этого достаточно,
    // чтобы сработали слушатели, зарегистрированные через
    // `.on('pointerdown' | 'pointerup', …)`.
    const fe = new PIXI.FederatedPointerEvent(events.rootBoundary);
    fe.type = type;
    fe.pointerType = ev.pointerType || "mouse";
    fe.pointerId = ev.pointerId;
    fe.button = ev.button;
    fe.buttons = ev.buttons;
    fe.global.set(x, y);
    fe.target = target;
    fe.currentTarget = target;
    target.emit(type, fe);
  };

  const onDown = handler("pointerdown");
  const onUp = handler("pointerup");

  skiaCanvas.style.touchAction = "none";
  skiaCanvas.addEventListener("pointerdown", onDown);
  skiaCanvas.addEventListener("pointerup", onUp);

  return () => {
    skiaCanvas.removeEventListener("pointerdown", onDown);
    skiaCanvas.removeEventListener("pointerup", onUp);
  };
}
