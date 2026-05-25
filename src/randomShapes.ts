import * as PIXI from "pixi.js-legacy";

const PALETTE = [
  0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0x073b4c, 0xf78c6b, 0x8d99ae,
  0x9d4edd, 0xff70a6, 0x70d6ff,
];

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const rand = (min: number, max: number): number =>
  min + Math.random() * (max - min);

/**
 * Возвращает свежую случайную `PIXI.Graphics` (или линию),
 * расположенную где-то внутри заданных границ. Используется
 * кнопкой «+ Random shape» на тулбаре.
 */
export function makeRandomShape(
  log: (msg: string) => void,
  bounds: { width: number; height: number },
): PIXI.Graphics {
  const g = new PIXI.Graphics();
  const color = pick(PALETTE);
  const alpha = rand(0.6, 1);
  const cx = rand(60, bounds.width - 60);
  const cy = rand(60, bounds.height - 60);

  const kind = pick(["rect", "circle", "ellipse", "line", "polyline"] as const);
  switch (kind) {
    case "rect": {
      const w = rand(40, 160);
      const h = rand(40, 160);
      g.beginFill(color, alpha).drawRect(-w / 2, -h / 2, w, h).endFill();
      break;
    }
    case "circle": {
      g.beginFill(color, alpha).drawCircle(0, 0, rand(30, 80)).endFill();
      break;
    }
    case "ellipse": {
      g.beginFill(color, alpha)
        .drawEllipse(0, 0, rand(40, 100), rand(20, 60))
        .endFill();
      break;
    }
    case "line": {
      g.lineStyle(rand(3, 10), color, alpha)
        .moveTo(0, 0)
        .lineTo(rand(-120, 120), rand(-120, 120));
      break;
    }
    case "polyline": {
      g.lineStyle(rand(2, 6), color, alpha);
      g.moveTo(0, 0);
      let x = 0;
      let y = 0;
      for (let i = 0; i < 4; i++) {
        x += rand(-50, 50);
        y += rand(-50, 50);
        g.lineTo(x, y);
      }
      break;
    }
  }

  g.position.set(cx, cy);
  g.angle = rand(-45, 45);
  g.scale.set(rand(0.6, 1.4));

  g.eventMode = "static";
  g.cursor = "pointer";
  const id = Math.floor(Math.random() * 9999).toString(16);
  g.on("pointerdown", () => log(`random[${id}] pointerdown (${kind})`));
  g.on("pointerup", () => log(`random[${id}] pointerup (${kind})`));

  return g;
}
