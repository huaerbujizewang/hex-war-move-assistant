import OBR, { buildShape } from "@owlbear-rodeo/sdk";
import "./style.css";

const EXT = "com.example.hex-war-move";
const UNIT_KEY = `${EXT}/unit`;
const TERRAIN_KEY = `${EXT}/terrain`;
const HIGHLIGHT_KEY = `${EXT}/highlight`;

type Vec2 = { x: number; y: number };
type Axial = { q: number; r: number };

type UnitData = {
  atk: number;
  def: number;
  mov: number;
  stat: string;
  moved: boolean;
};

type TerrainMap = Record<string, number>;

type ReachCell = {
  q: number;
  r: number;
  cost: number;
  remaining: number;
  previous?: string;
};

type MoveState = {
  unitId: string;
  unitName: string;
  start: Axial;
  mov: number;
  reachable: Map<string, ReachCell>;
};

let activeMove: MoveState | null = null;
let gridType: string = "HEX_VERTICAL";
let gridDpi = 100;

function keyOf(hex: Axial): string {
  return `${hex.q},${hex.r}`;
}

function parseKey(key: string): Axial {
  const [q, r] = key.split(",").map(Number);
  return { q, r };
}

function parseStat(stat: string): UnitData {
  const parts = stat.trim().split("-").map((x) => Number(x.trim()));
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) {
    throw new Error("属性格式必须是 14-6-3 这种 A-D-M 格式。");
  }
  return {
    atk: parts[0],
    def: parts[1],
    mov: parts[2],
    stat: `${parts[0]}-${parts[1]}-${parts[2]}`,
    moved: false,
  };
}

function isHexGrid(type: string): boolean {
  return type === "HEX_VERTICAL" || type === "HEX_HORIZONTAL";
}

function hexNeighbors(hex: Axial): Axial[] {
  return [
    { q: hex.q + 1, r: hex.r },
    { q: hex.q + 1, r: hex.r - 1 },
    { q: hex.q, r: hex.r - 1 },
    { q: hex.q - 1, r: hex.r },
    { q: hex.q - 1, r: hex.r + 1 },
    { q: hex.q, r: hex.r + 1 },
  ];
}

/**
 * Owlbear:
 * HEX_VERTICAL: 文档说明 dpi 是单格宽度。
 * HEX_HORIZONTAL: 文档说明 dpi 是单格高度。
 *
 * 这里采用常见 axial 坐标：
 * - HEX_VERTICAL 约等于 pointy-top：width = sqrt(3) * size
 * - HEX_HORIZONTAL 约等于 flat-top：height = sqrt(3) * size
 *
 * 如果你后面发现和某张地图偏半格，先别改算法，优先确认 Owlbear 场景的网格是否对齐。
 */
function pixelToAxial(pos: Vec2, type: string, dpi: number): Axial {
  const size = dpi / Math.sqrt(3);

  let qf: number;
  let rf: number;

  if (type === "HEX_HORIZONTAL") {
    qf = (2 / 3 * pos.x) / size;
    rf = (-1 / 3 * pos.x + Math.sqrt(3) / 3 * pos.y) / size;
  } else {
    qf = (Math.sqrt(3) / 3 * pos.x - 1 / 3 * pos.y) / size;
    rf = (2 / 3 * pos.y) / size;
  }

  return cubeRound(qf, rf);
}

function axialToPixel(hex: Axial, type: string, dpi: number): Vec2 {
  const size = dpi / Math.sqrt(3);

  if (type === "HEX_HORIZONTAL") {
    return {
      x: size * (3 / 2 * hex.q),
      y: size * (Math.sqrt(3) * (hex.r + hex.q / 2)),
    };
  }

  return {
    x: size * (Math.sqrt(3) * (hex.q + hex.r / 2)),
    y: size * (3 / 2 * hex.r),
  };
}

function cubeRound(qf: number, rf: number): Axial {
  let x = qf;
  let z = rf;
  let y = -x - z;

  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return { q: rx, r: rz };
}

function terrainCost(terrain: TerrainMap, hex: Axial): number {
  const value = terrain[keyOf(hex)];
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return value;
}

function computeReachable(start: Axial, mov: number, terrain: TerrainMap): Map<string, ReachCell> {
  const reachable = new Map<string, ReachCell>();
  const startKey = keyOf(start);

  reachable.set(startKey, {
    ...start,
    cost: 0,
    remaining: mov,
  });

  const queue: ReachCell[] = [{ ...start, cost: 0, remaining: mov }];

  while (queue.length > 0) {
    queue.sort((a, b) => b.remaining - a.remaining);
    const current = queue.shift()!;

    for (const next of hexNeighbors(current)) {
      const enterCost = terrainCost(terrain, next);
      if (enterCost >= 99999) continue;

      const nextCost = current.cost + enterCost;
      const nextRemaining = mov - nextCost;
      if (nextRemaining < 0) continue;

      const nextKey = keyOf(next);
      const known = reachable.get(nextKey);
      if (!known || nextRemaining > known.remaining) {
        const cell: ReachCell = {
          ...next,
          cost: nextCost,
          remaining: nextRemaining,
          previous: keyOf(current),
        };
        reachable.set(nextKey, cell);
        queue.push(cell);
      }
    }
  }

  return reachable;
}

async function getTerrain(): Promise<TerrainMap> {
  const metadata = await OBR.scene.getMetadata();
  const raw = metadata[TERRAIN_KEY];
  if (raw && typeof raw === "object") return raw as TerrainMap;
  return {};
}

async function setTerrainCost(hex: Axial, cost: number) {
  const terrain = await getTerrain();
  const k = keyOf(hex);
  if (cost === 1) {
    delete terrain[k];
  } else {
    terrain[k] = cost;
  }
  await OBR.scene.setMetadata({ [TERRAIN_KEY]: terrain });
}

async function refreshGridInfo() {
  gridType = await OBR.scene.grid.getType();
  gridDpi = await OBR.scene.grid.getDpi();
}

async function getSelectedItem(): Promise<any | null> {
  const ids = await OBR.player.getSelection();
  if (!ids || ids.length === 0) return null;
  const items = await OBR.scene.items.getItems([ids[0]]);
  return items[0] ?? null;
}

async function bindSelectedUnit(stat: string) {
  const item = await getSelectedItem();
  if (!item) throw new Error("请先选中一个 token。");

  const unit = parseStat(stat);

  await OBR.scene.items.updateItems([item], (items) => {
    items[0].metadata[UNIT_KEY] = unit;
  });

  await OBR.notification.show(`已绑定单位：${item.name} = ${unit.stat}`);
}

async function clearMovedSelectedUnit() {
  const item = await getSelectedItem();
  if (!item) throw new Error("请先选中一个 token。");

  await OBR.scene.items.updateItems([item], (items) => {
    const unit = items[0].metadata[UNIT_KEY] as UnitData | undefined;
    if (unit) {
      items[0].metadata[UNIT_KEY] = { ...unit, moved: false };
    }
  });

  await OBR.notification.show("已清除移动标记。");
}

async function clearHighlights() {
  const highlights = await OBR.scene.items.getItems(
    (item) => Boolean(item.metadata?.[HIGHLIGHT_KEY])
  );
  if (highlights.length > 0) {
    await OBR.scene.items.deleteItems(highlights.map((x) => x.id));
  }
}

async function showReachableForSelected() {
  const item = await getSelectedItem();
  if (!item) throw new Error("请先选中一个已绑定的单位。");

  const unit = item.metadata?.[UNIT_KEY] as UnitData | undefined;
  if (!unit) throw new Error("这个 token 还没有绑定 14-6-3 单位 JSON。");

  await refreshGridInfo();

  if (!isHexGrid(gridType)) {
    throw new Error(`当前不是六角格：${gridType}`);
  }

  await clearHighlights();

  const terrain = await getTerrain();
  const snapped = await OBR.scene.grid.snapPosition(item.position, 1, false);
  const start = pixelToAxial(snapped, gridType, gridDpi);
  const reachable = computeReachable(start, unit.mov, terrain);

  activeMove = {
    unitId: item.id,
    unitName: item.name,
    start,
    mov: unit.mov,
    reachable,
  };

  const shapes: any[] = [];
  for (const cell of reachable.values()) {
    const pos = axialToPixel(cell, gridType, gridDpi);
    const snappedPos = await OBR.scene.grid.snapPosition(pos, 1, false);

    const isStart = cell.q === start.q && cell.r === start.r;
    const shape = buildShape()
      .name(isStart ? "Hex Move Start" : "Hex Move Reachable")
      .width(gridDpi * 0.92)
      .height(gridDpi * 0.92)
      .shapeType("HEXAGON")
      .position(snappedPos)
      .layer("CONTROL")
      .locked(true)
      .disableHit(true)
      .fillColor(isStart ? "#facc15" : "#38bdf8")
      .fillOpacity(isStart ? 0.25 : 0.18)
      .strokeColor(isStart ? "#eab308" : "#0ea5e9")
      .strokeOpacity(0.75)
      .strokeWidth(2)
      .metadata({
        [HIGHLIGHT_KEY]: {
          unitId: item.id,
          q: cell.q,
          r: cell.r,
          cost: cell.cost,
          remaining: cell.remaining,
        },
      })
      .build();

    shapes.push(shape);
  }

  await OBR.scene.items.addItems(shapes);
  await OBR.tool.activateMode(`${EXT}/tool`, `${EXT}/move-mode`);
  writeStatus(
    `已计算 ${item.name} 的移动范围。\n` +
    `属性：${unit.stat}\n` +
    `移动力：${unit.mov}\n` +
    `可达格：${reachable.size}\n` +
    `现在点击一个高亮格，单位会自动移动并标记 moved=true。`
  );
}

async function moveActiveUnitTo(hex: Axial) {
  if (!activeMove) return;

  const targetKey = keyOf(hex);
  const cell = activeMove.reachable.get(targetKey);
  if (!cell) {
    await OBR.notification.show("目标格不在可移动范围内。");
    return;
  }

  const items = await OBR.scene.items.getItems([activeMove.unitId]);
  const item = items[0];
  if (!item) return;

  const targetPixel = axialToPixel(hex, gridType, gridDpi);
  const snapped = await OBR.scene.grid.snapPosition(targetPixel, 1, false);

  await OBR.scene.items.updateItems([item], (draft) => {
    const token = draft[0];
    token.position = snapped;
    const unit = token.metadata[UNIT_KEY] as UnitData | undefined;
    if (unit) {
      token.metadata[UNIT_KEY] = {
        ...unit,
        moved: true,
      };
    }
  });

  await clearHighlights();

  writeStatus(
    `已移动：${activeMove.unitName}\n` +
    `目标格：${targetKey}\n` +
    `消耗：${cell.cost} / ${activeMove.mov}\n` +
    `剩余：${cell.remaining}\n` +
    `已标记 moved=true。`
  );

  activeMove = null;
}

async function installTools() {
  await OBR.tool.create({
    id: `${EXT}/tool`,
    icons: [
      {
        icon: "/icon.svg",
        label: "Hex Move",
      },
    ],
    defaultMode: `${EXT}/move-mode`,
  });

  await OBR.tool.createMode({
    id: `${EXT}/move-mode`,
    icons: [
      {
        icon: "/icon.svg",
        label: "移动到高亮格",
      },
    ],
    cursors: [{ cursor: "pointer" }],
    async onToolClick(_, event) {
      if (!activeMove) return true;

      await refreshGridInfo();
      const snapped = await OBR.scene.grid.snapPosition(event.pointerPosition, 1, false);
      const hex = pixelToAxial(snapped, gridType, gridDpi);
      await moveActiveUnitTo(hex);
      return false;
    },
  });

  await OBR.tool.createMode({
    id: `${EXT}/terrain-mode`,
    icons: [
      {
        icon: "/icon.svg",
        label: "设置地形消耗",
        filter: {
          roles: ["GM"],
        },
      },
    ],
    cursors: [{ cursor: "crosshair" }],
    async onToolClick(context, event) {
      await refreshGridInfo();
      const costRaw = context.metadata?.terrainBrush;
      const cost = typeof costRaw === "number" ? costRaw : 1;
      const snapped = await OBR.scene.grid.snapPosition(event.pointerPosition, 1, false);
      const hex = pixelToAxial(snapped, gridType, gridDpi);
      await setTerrainCost(hex, cost);
      await OBR.notification.show(`地形 ${keyOf(hex)} = ${cost}`);
      return false;
    },
  });
}

async function activateTerrainBrush(cost: number) {
  await OBR.tool.setMetadata(`${EXT}/tool`, { terrainBrush: cost });
  await OBR.tool.activateMode(`${EXT}/tool`, `${EXT}/terrain-mode`);
  writeStatus(`地形刷已启用：进入该格消耗 = ${cost}\n点击六角格即可写入场景 metadata。\n1 会清除特殊地形，恢复默认消耗。`);
}

function writeStatus(text: string) {
  const box = document.querySelector<HTMLDivElement>("#status");
  if (box) box.textContent = text;
}

function renderApp() {
  document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
    <h1>Hex War Move Assistant</h1>

    <div class="card">
      <h2>1. Token 绑定单位 JSON</h2>
      <label>单位属性，格式：攻-防-移</label>
      <input id="stat" value="14-6-3" />
      <div class="row">
        <button id="bind">绑定到当前选中 Token</button>
      </div>
      <div class="row">
        <button id="clearMoved" class="secondary">清除当前 Token 的 moved 标记</button>
      </div>
      <p class="small">
        写入 token metadata：atk / def / mov / stat / moved。第一版只使用 mov。
      </p>
    </div>

    <div class="card">
      <h2>2. 自动移动</h2>
      <button id="showMove">高亮当前单位可移动范围</button>
      <div class="row">
        <button id="clearHighlights" class="secondary">清除高亮</button>
      </div>
      <p class="small">
        点击高亮格后，插件会把 token 自动移动到格心，并标记 moved=true。
      </p>
    </div>

    <div class="card">
      <h2>3. GM 地形移动消耗</h2>
      <div class="inline">
        <button class="terrain" data-cost="1">1 默认</button>
        <button class="terrain" data-cost="2">2 困难</button>
        <button class="terrain" data-cost="3">3 极难</button>
      </div>
      <div class="row">
        <button class="terrain danger" data-cost="99999">99999 不可进入</button>
      </div>
      <p class="small">
        默认消耗为 1。特殊地形存在 scene metadata 里。移动消耗按“进入目标格”计算。
      </p>
    </div>

    <div class="card">
      <h2>状态</h2>
      <div id="status" class="status">等待 Owlbear SDK 初始化……</div>
    </div>
  `;

  document.querySelector("#bind")!.addEventListener("click", async () => {
    try {
      const stat = (document.querySelector<HTMLInputElement>("#stat")!).value;
      await bindSelectedUnit(stat);
      writeStatus(`已绑定：${stat}`);
    } catch (err: any) {
      writeStatus(`错误：${err.message ?? err}`);
    }
  });

  document.querySelector("#clearMoved")!.addEventListener("click", async () => {
    try {
      await clearMovedSelectedUnit();
      writeStatus("已清除当前单位 moved 标记。");
    } catch (err: any) {
      writeStatus(`错误：${err.message ?? err}`);
    }
  });

  document.querySelector("#showMove")!.addEventListener("click", async () => {
    try {
      await showReachableForSelected();
    } catch (err: any) {
      writeStatus(`错误：${err.message ?? err}`);
    }
  });

  document.querySelector("#clearHighlights")!.addEventListener("click", async () => {
    await clearHighlights();
    activeMove = null;
    writeStatus("已清除高亮。");
  });

  for (const el of document.querySelectorAll<HTMLButtonElement>(".terrain")) {
    el.addEventListener("click", async () => {
      const cost = Number(el.dataset.cost);
      await activateTerrainBrush(cost);
    });
  }
}

renderApp();

OBR.onReady(async () => {
  try {
    const ready = await OBR.scene.isReady();
    if (!ready) {
      writeStatus("请先打开一个 Owlbear 场景。");
      return;
    }

    await refreshGridInfo();
    await installTools();

    writeStatus(
      `已初始化。\n` +
      `当前网格：${gridType}\n` +
      `DPI：${gridDpi}\n` +
      `下一步：选中 token，绑定 14-6-3，然后点击“高亮当前单位可移动范围”。`
    );
  } catch (err: any) {
    writeStatus(`初始化失败：${err.message ?? err}`);
  }
});
