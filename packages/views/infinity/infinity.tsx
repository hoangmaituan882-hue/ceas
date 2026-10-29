import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { clamp } from "../viewport";

/* ══ 无限视图 ════════════════════════════════════════════════
   规范 v2 §6.1：没有边界，位置不持久，靠视口漫游。

   与画布的区别：
   - 画布：位置由人决定、可持久、可叠
   - 无限：位置由格子算法决定、永不重复、只能漂

   布局是「无限平面切成格子，每格用哈希挑一张素材」：
   不需要预先算总高度，也不需要虚拟列表 —— 只渲染视口内的格子。
   ------------------------------------------------------------ */

export type InfinitySource = { id: string; aspect: number; color: string; src?: string };
export type Rect = { x: number; y: number; w: number; h: number };

type Props = {
  items: readonly InfinitySource[];
  offset?: { x: number; y: number } | null;
  onOffsetChange?: (o: { x: number; y: number }) => void;
  selected: Set<string>;
  onSelect: (id: string, additive: boolean) => void;
  onClear: () => void;
  onOpen: (id: string, origin?: Rect) => void;
};

const CELL_W = 300;
const CELL_H = 260;
const PAD = 12;
const FRICTION = 0.9;

/** 格子坐标 → 素材下标：同一格永远同一张，滚动不会跳变 */
function pickAt(col: number, row: number, n: number): number {
  let h = Math.imul(col, 374761393) ^ Math.imul(row, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return Math.abs(h) % n;
}

/** 素材在格子里的位置：等比塞进内边距，居中。
    加错位与尺寸扰动 —— 严格对齐会让人一眼看出这是「表格」，
    而无限视图要的是「铺开、看不到边」。 */
function boxIn(col: number, row: number, aspect: number, seed: number) {
  const a = clamp(aspect, 0.4, 2.6);
  /* 奇数行右移 1/3 格，形成砖缝错位 */
  const stagger = (row & 1) === 1 ? CELL_W * 0.34 : 0;
  /* 每个格子 ±3% 的尺寸扰动 */
  const scale = 0.86 + (seed % 5) * 0.035;
  const maxW = (CELL_W - PAD * 2) * scale;
  const maxH = (CELL_H - PAD * 2) * scale;
  let w = maxW;
  let h = w / a;
  if (h > maxH) {
    h = maxH;
    w = h * a;
  }
  return {
    x: col * CELL_W + stagger + (CELL_W - w) / 2,
    y: row * CELL_H + (CELL_H - h) / 2,
    w,
    h,
  };
}

export function InfinityView({ items, offset, onOffsetChange, selected, onSelect, onClear, onOpen }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState(() => ({ x: offset?.x ?? 0, y: offset?.y ?? 0 }));
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const vel = useRef({ x: 0, y: 0 });
  const raf = useRef(0);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const armed = useRef(false);

  /* 容器尺寸：决定渲染多少格 */
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* 惯性：松手/滚轮之后自己继续漂，摩擦衰减到静止 */
  const glide = useCallback(() => {
    if (raf.current) return;
    const step = () => {
      const v = vel.current;
      /* 阈值 0.5px/帧：再小就是肉眼看不见的爬行，只会让「停下来」变成永远停不下来 */
      if (Math.abs(v.x) < 0.5 && Math.abs(v.y) < 0.5) {
        vel.current = { x: 0, y: 0 };
        raf.current = 0;
        return;
      }
      setView((prev) => ({ x: prev.x + v.x, y: prev.y + v.y }));
      vel.current = { x: v.x * FRICTION, y: v.y * FRICTION };
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /* 滚轮：累积成速度，交给惯性循环 */
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      vel.current = {
        x: clamp(vel.current.x - e.deltaX * 0.6, -70, 70),
        y: clamp(vel.current.y - e.deltaY * 0.6, -70, 70),
      };
      glide();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [glide]);

  /* 位置变化时上报（外部做防抖持久化） */
  useEffect(() => {
    /* 第一帧只是初始位置，不上报；之后每次移动都上报（外部防抖落盘） */
    if (!armed.current) {
      armed.current = true;
      return;
    }
    onOffsetChange?.(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    host.current?.setPointerCapture(e.pointerId);
    vel.current = { x: 0, y: 0 };
    drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    setDragging(true);
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setView({ x: d.ox + dx, y: d.oy + dy });
  };

  const up = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d && !d.moved) onClear();
  };

  /* 只算视口内的格子，外加一圈缓冲 */
  const CELLS: { col: number; row: number; item: InfinitySource; box: Rect }[] = [];
  if (size.w > 0 && items.length > 0) {
    const c0 = Math.floor(-view.x / CELL_W) - 1;
    const c1 = Math.floor((size.w - view.x) / CELL_W) + 1;
    const r0 = Math.floor(-view.y / CELL_H) - 1;
    const r1 = Math.floor((size.h - view.y) / CELL_H) + 1;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const idx = pickAt(col, row, items.length);
        const item = items[idx];
        if (!item) continue;
        CELLS.push({ col, row, item, box: boxIn(col, row, item.aspect, idx) });
      }
    }
  }

  return (
    <div
      className="inf"
      ref={host}
      data-drag={dragging || undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <div className="inf-world" style={{ transform: `translate(${view.x}px, ${view.y}px)` }}>
        {CELLS.map(({ col, row, item, box }) => (
          <div
            key={`${col}:${row}`}
            className="inf-item"
            data-selected={selected.has(item.id) || undefined}
            style={{ left: box.x, top: box.y, width: box.w, height: box.h, background: item.color } as CSSProperties}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              onSelect(item.id, e.ctrlKey || e.metaKey);
            }}
            onDoubleClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onOpen(item.id, { x: r.x, y: r.y, w: r.width, h: r.height });
            }}
          >
            {item.src ? <img src={item.src} alt="" loading="lazy" decoding="async" draggable={false} /> : null}
          </div>
        ))}
      </div>

      <div className="inf-hud">
        <button
          type="button"
          className="inf-btn"
          onClick={() => {
            vel.current = { x: 0, y: 0 };
            setView({ x: 0, y: 0 });
          }}
        >
          回到起点
        </button>
        <span className="inf-pos">
          {Math.round(view.x)}, {Math.round(view.y)}
        </span>
      </div>

      <div className="inf-hint">滚轮或拖动漂移 · 双击打开 · 没有尽头</div>
    </div>
  );
}
