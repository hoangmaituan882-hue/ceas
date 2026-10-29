/* ══ 视口变换 ════════════════════════════════════════════════
   网格与画布共用的一套坐标数学：屏幕 ↔ 世界、以某点为锚缩放。
   纯函数，不碰 DOM。

   世界坐标 = 素材自己的坐标（画布上的 x/y、网格里算出的 x/y）
   屏幕坐标 = 经过 { x, y, k } 平移与缩放之后的位置
   ------------------------------------------------------------ */

export type Viewport = { x: number; y: number; k: number };

/* 下限放到 0.05：画布有 240 个素材时，要装进 900px 需要 0.14 左右，
   原来的 0.15 会让「适配」装不下整块板 */
export const MIN_K = 0.05;
export const MAX_K = 4;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** 世界 → 屏幕 */
export function toScreen(vp: Viewport, wx: number, wy: number) {
  return { x: wx * vp.k + vp.x, y: wy * vp.k + vp.y };
}

/** 屏幕 → 世界 */
export function toWorld(vp: Viewport, sx: number, sy: number) {
  return { x: (sx - vp.x) / vp.k, y: (sy - vp.y) / vp.k };
}

/**
 * 以屏幕上的某一点为锚缩放：锚点下的世界坐标保持不动。
 * 这是滚轮缩放唯一正确的做法 —— 直接改 k 会让画面往左上跑。
 */
export function zoomAt(vp: Viewport, sx: number, sy: number, nextK: number): Viewport {
  const k = clamp(nextK, MIN_K, MAX_K);
  const ratio = k / vp.k;
  return {
    k,
    x: sx - (sx - vp.x) * ratio,
    y: sy - (sy - vp.y) * ratio,
  };
}

/** 把一组世界坐标矩形装进给定视口尺寸，返回居中的 Viewport */
export function fitView(
  boxes: readonly { x: number; y: number; w: number; h: number }[],
  width: number,
  height: number,
  padding = 48,
): Viewport {
  if (boxes.length === 0 || width <= 0 || height <= 0) return { x: 0, y: 0, k: 1 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }

  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const k = clamp(Math.min((width - padding * 2) / bw, (height - padding * 2) / bh), MIN_K, 1);

  return {
    k,
    x: (width - bw * k) / 2 - minX * k,
    y: (height - bh * k) / 2 - minY * k,
  };
}
