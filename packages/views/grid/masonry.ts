/* ══ 瀑布流布局（Pinterest 风格）═════════════════════════════
   与 justified 的区别：
   - justified：每行高度不同、宽度撑满，行列严格对齐
   - 瀑布流：每列宽度相同、高度自由，按最短列投递

   两者共用同一套「绝对定位 + 内容坐标」，所以切换可以做位置补间。
   ------------------------------------------------------------ */

export type Box = { x: number; y: number; w: number; h: number };
export type Placed = { index: number; box: Box };

type Input = { aspect: number };

/* 极端比例在瀑布流里会被拉成细长条，夹一下 */
const MIN_A = 0.35;
const MAX_A = 3.5;

export function layoutMasonry(
  items: readonly Input[],
  width: number,
  targetCol: number,
  gap: number,
): { placed: Placed[]; height: number; cols: number; colWidth: number } {
  const placed: Placed[] = [];
  if (width <= 0 || items.length === 0) {
    return { placed, height: 0, cols: 0, colWidth: 0 };
  }

  const cols = Math.max(2, Math.min(8, Math.floor((width + gap) / (targetCol + gap))));
  const colWidth = (width - gap * (cols - 1)) / cols;
  const heights = new Array<number>(cols).fill(0);

  items.forEach((item, index) => {
    const a = Math.min(MAX_A, Math.max(MIN_A, item.aspect || 1));
    const h = Math.round(colWidth / a);

    /* 投递到当前最短的列 */
    let col = 0;
    for (let i = 1; i < cols; i++) {
      if ((heights[i] ?? 0) < (heights[col] ?? 0)) col = i;
    }

    const y = heights[col] ?? 0;
    placed.push({ index, box: { x: col * (colWidth + gap), y, w: colWidth, h } });
    heights[col] = y + h + gap;
  });

  const maxH = heights.reduce((m, h) => Math.max(m, h), 0);
  return { placed, height: Math.max(0, maxH - gap), cols, colWidth };
}
