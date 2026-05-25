import * as PIXI from "pixi.js-legacy";

/**
 * Именованная заранее построенная сцена. Кнопка «Следующая сцена»
 * подменяет ею текущий корневой `PIXI.Container` в приложении.
 */
export interface Scene {
  name: string;
  build: (log: (msg: string) => void) => PIXI.Container;
}

/** Помечаем DisplayObject интерактивным и задаём вид курсора. */
function makeInteractive(obj: PIXI.DisplayObject): void {
  obj.eventMode = "static";
  obj.cursor = "pointer";
}

/** Сцена 1: максимально близко повторяет пример из ТЗ. */
const taskExampleScene: Scene = {
  name: "Task example",
  build: (log) => {
    const main = new PIXI.Container();
    const sub = new PIXI.Container();

    const g1 = new PIXI.Graphics();
    const g2 = new PIXI.Graphics();
    const g3 = new PIXI.Graphics();
    const g4 = new PIXI.Graphics();

    g1.beginFill("#ff0000").drawEllipse(0, 0, 200, 100).endFill();
    g1.position.set(300, 180);
    g1.angle = 30;
    makeInteractive(g1);
    g1.on("pointerdown", () => log("g1 pointerdown!"));

    g2.beginFill("#0000ff").drawRect(-50, -75, 100, 150).endFill();
    g2.position.set(180, 80);
    g2.angle = 15;
    g2.scale.set(1.5, 1.7);
    makeInteractive(g2);
    g2.on("pointerup", () => log("g2 pointerup!"));

    g3.lineStyle(10, "#ffffff", 1).moveTo(0, 0).lineTo(150, 100);
    g3.angle = -20;
    makeInteractive(g3);
    g3.on("pointerdown", () => log("g3 pointerdown (line)"));

    g4.lineStyle(10, "#ffff00", 1).moveTo(0, 70).lineTo(150, -30);
    g4.angle = 20;
    makeInteractive(g4);
    g4.on("pointerup", () => log("g4 pointerup (line)"));

    sub.position.set(120, 80);
    sub.addChild(g3, g4);
    main.addChild(sub, g1, g2);
    return main;
  },
};

/** Сцена 2: вложенные трансформации (поворот + масштаб) с закруглённой карточкой. */
const nestedTransformsScene: Scene = {
  name: "Nested transforms",
  build: (log) => {
    const root = new PIXI.Container();
    root.position.set(80, 60);

    const card = new PIXI.Graphics()
      .beginFill(0x1f8fff)
      .drawRoundedRect(0, 0, 400, 260, 28)
      .endFill();
    makeInteractive(card);
    card.on("pointerdown", () => log("card pointerdown"));

    const ring = new PIXI.Container();
    ring.position.set(200, 130);
    for (let i = 0; i < 12; i++) {
      const dot = new PIXI.Graphics()
        .beginFill(0xffffff)
        .drawCircle(0, 0, 14)
        .endFill();
      const angle = (i / 12) * Math.PI * 2;
      dot.position.set(Math.cos(angle) * 90, Math.sin(angle) * 90);
      makeInteractive(dot);
      const k = i;
      dot.on("pointerup", () => log(`dot ${k} pointerup`));
      ring.addChild(dot);
    }
    ring.rotation = Math.PI / 8;
    ring.scale.set(1.05);

    const triangle = new PIXI.Graphics();
    triangle.lineStyle(6, 0x111111, 1);
    triangle.beginFill(0xffd166)
      .moveTo(0, -60)
      .lineTo(60, 50)
      .lineTo(-60, 50)
      .closePath()
      .endFill();
    triangle.position.set(540, 200);
    triangle.angle = -10;
    makeInteractive(triangle);
    triangle.on("pointerdown", () => log("triangle pointerdown"));

    root.addChild(card, ring, triangle);
    return root;
  },
};

/** Сцена 3: сетка из фигур с разными обводками. */
const grid: Scene = {
  name: "Stroke grid",
  build: (log) => {
    const root = new PIXI.Container();
    const colors = [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0x073b4c];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 6; c++) {
        const cell = new PIXI.Graphics();
        cell.lineStyle(4, 0x222222, 1);
        cell
          .beginFill(colors[(r + c) % colors.length])
          .drawRoundedRect(0, 0, 100, 100, 10)
          .endFill();
        cell.position.set(40 + c * 120, 40 + r * 130);
        cell.angle = (c - r) * 4;
        makeInteractive(cell);
        const tag = `cell(${r},${c})`;
        cell.on("pointerdown", () => log(`${tag} pointerdown`));
        cell.on("pointerup", () => log(`${tag} pointerup`));
        root.addChild(cell);
      }
    }
    return root;
  },
};

/**
 * На лету строит небольшую `PIXI.Texture` на базе PNG-битмапы, чтобы
 * ветка рендера спрайтов в обоих рендерерах работала, не требуя
 * отдельного бинарного ассета в репозитории. Картинка — шахматка
 * в цветной рамке.
 */
function buildCheckerTexture(): PIXI.Texture {
  const SIZE = 64;
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d");
  if (!ctx) return PIXI.Texture.WHITE;
  const tile = 8;
  for (let y = 0; y < SIZE; y += tile) {
    for (let x = 0; x < SIZE; x += tile) {
      const dark = ((x / tile + y / tile) & 1) === 0;
      ctx.fillStyle = dark ? "#073b4c" : "#ffd166";
      ctx.fillRect(x, y, tile, tile);
    }
  }
  ctx.strokeStyle = "#ef476f";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, SIZE - 4, SIZE - 4);
  return PIXI.Texture.from(c);
}

/** Сцена 4: спрайты + графика с трансформациями, проверяет ветку PIXI.Sprite. */
const spritesScene: Scene = {
  name: "Sprites + transforms",
  build: (log) => {
    const root = new PIXI.Container();
    const texture = buildCheckerTexture();

    const cols = 5;
    const rows = 3;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.position.set(120 + c * 130, 110 + r * 140);
        sprite.angle = (c - r) * 8;
        sprite.scale.set(1 + (c + r) * 0.05);
        makeInteractive(sprite);
        const tag = `sprite(${r},${c})`;
        sprite.on("pointerdown", () => log(`${tag} pointerdown`));
        sprite.on("pointerup", () => log(`${tag} pointerup`));
        root.addChild(sprite);
      }
    }

    const badge = new PIXI.Graphics();
    badge.lineStyle(3, 0x111111, 1);
    badge.beginFill(0xffffff, 0.92).drawRoundedRect(-80, -22, 160, 44, 10).endFill();
    badge.position.set(400, 540);
    makeInteractive(badge);
    badge.on("pointerdown", () => log("badge pointerdown"));
    root.addChild(badge);

    return root;
  },
};

export const SCENES: Scene[] = [
  taskExampleScene,
  nestedTransformsScene,
  grid,
  spritesScene,
];
