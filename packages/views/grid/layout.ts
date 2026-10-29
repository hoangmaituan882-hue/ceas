/* ══ 网格布局：justified 行 ══════════════════════════════════
   纯函数，不碰 DOM —— 之后会原样搬进 packages/views。
   规范 v2 §7.2：每行等比撑满，最后一行不缩放、左对齐。
   §6.2：极端比例（> 8:1 或 < 1:8）自成一行，不参与撑满。
   ------------------------------------------------------------ */

export type Box = { x: number; y: number; w: number; h: number };
export type Placed = { index: number; box: Box };
export type Row = { y: number; h: number; items: Placed[] };

type Input = { aspect: number };

const EXTREME = 8;
const MIN_ASPECT = 0.1;

export function layoutJustified(
  items: readonly Input[],
  width: number,
  rowTarget: number,
  gap: number,
): { rows: Row[]; height: number } {
  const rows: Row[] = [];
  const n = items.length;
  if (width <= 0 || n === 0) return { rows, height: 0 };

  let cursor = 0;
  let y = 0;

  while (cursor < n) {
    const rowIndexes: number[] = [];
    let ratioSum = 0;
    let forcedAspect: number | undefined;
    /* 只有「真的填满了」才允许拉伸到整行宽度。
       因为极端比例而被提前切断的行，必须按目标行高收住，
       否则会出现一张图被拉成 800px 高的事故。 */
    let filled = false;

    while (cursor < n) {
      const item = items[cursor];
      if (!item) break;
      const aspect = Math.max(MIN_ASPECT, item.aspect);
      const extreme = aspect > EXTREME || aspect < 1 / EXTREME;

      if (extreme) {
        /* 极端比例：这一行只放它一个 */
        if (rowIndexes.length === 0) {
          rowIndexes.push(cursor);
          ratioSum = aspect;
          forcedAspect = aspect;
          cursor += 1;
        }
        break;
      }

      rowIndexes.push(cursor);
      ratioSum += aspect;
      cursor += 1;

      const gaps = gap * (rowIndexes.length - 1);
      if (ratioSum * rowTarget + gaps >= width) {
        filled = true;
        break;
      }
    }

    const gaps = gap * (rowIndexes.length - 1);
    const available = Math.max(1, width - gaps);

    let h: number;
    if (forcedAspect !== undefined) {
      h = Math.min(rowTarget, available / forcedAspect);
    } else if (filled) {
      h = available / ratioSum;
    } else {
      /* 未填满：目标行高封顶，绝不拉伸（含最后一行） */
      h = Math.min(rowTarget, available / ratioSum);
    }

    const placed: Placed[] = [];
    let x = 0;
    for (const index of rowIndexes) {
      const item = items[index];
      if (!item) continue;
      const aspect = Math.max(MIN_ASPECT, item.aspect);
      const w = aspect * h;
      placed.push({ index, box: { x, y, w, h } });
      x += w + gap;
    }
    rows.push({ y, h, items: placed });
    y += h + gap;
  }

  return { rows, height: Math.max(0, y - gap) };
}

/** 可见行：行数不多，线性扫描即可（每帧几百次比较） */
export function visibleRows(rows: readonly Row[], top: number, height: number, overscan: number): Row[] {
  const from = top - overscan;
  const to = top + height + overscan;
  const out: Row[] = [];
  for (const row of rows) {
    if (row.y + row.h < from) continue;
    if (row.y > to) break;
    out.push(row);
  }
  return out;
}
