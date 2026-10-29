/* ══ 画布坐标与界面偏好持久化 ════════════════════════════════
   现在落 localStorage，接口按「将来换成 SQLite 的 board_items 表」
   设计：只有 load / save 两个出口，调用方不关心实现。

   规范 §6.1：画布 = 搭建，坐标必须持久；网格与无限不存位置。
   ------------------------------------------------------------ */

import { readLibraryState, writeLibraryState } from "./library-state";
export type BoardNode = { id: string; x: number; y: number; rot: number };

/** 筛选只暂时隐藏素材，回写不能覆盖掉隐藏项的坐标。 */
export function mergeBoardPositions(previous: readonly BoardNode[] | null, updates: readonly BoardNode[], validIds: ReadonlySet<string>): BoardNode[] {
  const merged = new Map((previous ?? []).map((node) => [node.id, node]));
  for (const node of updates) merged.set(node.id, node);
  return [...merged.values()].filter((node) => validIds.has(node.id));
}

const BOARD_KEY = "ceas.board.v1";
const VIEW_KEY = "ceas.view.v1";

export function loadBoard(): BoardNode[] | null {
  try {
    const raw = readLibraryState(BOARD_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (n): n is BoardNode =>
        !!n &&
        typeof n === "object" &&
        typeof (n as BoardNode).id === "string" &&
        Number.isFinite((n as BoardNode).x) &&
        Number.isFinite((n as BoardNode).y) &&
        Number.isFinite((n as BoardNode).rot),
    );
  } catch {
    return null;
  }
}

/** 防抖写入：拖动时每帧都会调，不能每次都序列化落盘 */
export function saveBoard(nodes: readonly BoardNode[]) {
  writeLibraryState(BOARD_KEY,JSON.stringify(nodes));
}

export function clearBoard() {
  try {
    writeLibraryState(BOARD_KEY,"null");
  } catch {
    /* 同上 */
  }
}

export type ViewPrefs = { density: string; view: string; collapsed: boolean; grid?: string; zoom?: number };

export function loadViewPrefs(): Partial<ViewPrefs> {
  try {
    const raw = readLibraryState(VIEW_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<ViewPrefs>) : {};
  } catch {
    return {};
  }
}

export function saveViewPrefs(p: ViewPrefs) {
  try {
    writeLibraryState(VIEW_KEY, JSON.stringify(p));
  } catch {
    /* 同上 */
  }
}

/* ── 无限视图的视口记忆 ────────────────────────────────────
   规范：离开再回来要停在原处。存的是偏移，不是位置。 */
const INF_KEY = "ceas.infinity.v1";

export function loadInfinityOffset(): { x: number; y: number } | null {
  try {
    const raw = readLibraryState(INF_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === "object" && Number.isFinite((v as { x: number }).x) && Number.isFinite((v as { y: number }).y)) {
      return { x: (v as { x: number }).x, y: (v as { y: number }).y };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveInfinityOffset(o: { x: number; y: number }) {
  writeLibraryState(INF_KEY,JSON.stringify({x:Math.round(o.x),y:Math.round(o.y)}));
}
