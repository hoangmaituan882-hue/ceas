import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { clamp, fitView, zoomAt, type Viewport } from "../viewport";

/* ══ 画布 ════════════════════════════════════════════════════
   规范 v2 §6.1：画布是「搭建」，坐标持久。
   这一版把坐标放在组件内（之后落到 board_item 表）：
   - 拖动空白：平移；滚轮：以指针为锚缩放
   - 拖动素材：移动（世界坐标 = 屏幕位移 / k）
   - 双击：打开详情
   - 素材带 ±5° 的轻微旋转，像摆在桌上而不是贴在墙上
   ------------------------------------------------------------ */

export type Rect = { x: number; y: number; w: number; h: number };

export type CanvasSource = { id: string; aspect: number; color: string; src?: string };

/** 只有坐标进持久化；颜色、比例随时能从素材重新取 */
export type BoardNode = { id: string; x: number; y: number; rot: number };

type Node = CanvasSource & { x: number; y: number; rot: number };

type Props = {
  items: readonly CanvasSource[];
  /** 已存的位置；空则按初始摆放计算 */
  board?: readonly BoardNode[] | null;
  onBoardChange?: (nodes: BoardNode[]) => void;
  onReset?: () => void;
  selected: Set<string>;
  onSelect: (id: string, additive: boolean) => void;
  onClear: () => void;
  onOpen: (id: string, origin?: Rect) => void;
};

const ITEM_H = 240;

/* 画布上的显示尺寸：把极端比例夹到 0.3–3.2，否则 9.5 或 0.09 的图
   会变成一根细长条。真实比例在详情里显示，这里只保证版面好看。 */
function sizeOf(aspect: number, seed = 0) {
  const a = clamp(aspect, 0.3, 3.2);
  const scale = 0.9 + ((seed * 17) % 26) / 100;
  const h = ITEM_H * scale;
  return { w: h * a, h };
}

/* 初始摆放：8 列松散网格 + 抖动 + ±7° 旋转。
   允许轻微重叠 —— 参考铺在桌上本来就会压到边，
   整齐对齐反而像表格。 */
function scatter(items: readonly CanvasSource[]): Node[] {
  const cols = 8;
  const cellW = 330;
  const cellH = 310;
  return items.map((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const jx = ((i * 37) % 140) - 70;
    const jy = ((i * 53) % 130) - 65;
    return {
      id: it.id,
      aspect: it.aspect,
      color: it.color,
      src: it.src,
      x: col * cellW + jx,
      y: row * cellH + jy,
      rot: (((i * 29) % 15) - 7) * 1,
    };
  });
}

/* 存储里的坐标优先；素材换了（id 对不上）就退回初始摆放 */
function merge(base: readonly Node[], board?: readonly BoardNode[] | null): Node[] {
  if (!board || board.length === 0) return [...base];
  const saved = new Map(board.map((b) => [b.id, b]));
  return base.map((n) => {
    const hit = saved.get(n.id);
    return hit ? { ...n, x: hit.x, y: hit.y, rot: hit.rot } : n;
  });
}

export function Canvas({ items, board, onBoardChange, onReset, selected, onSelect, onClear, onOpen }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<Node[]>(() => merge(scatter(items), board));
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, k: 0.6 });
  const [ready, setReady] = useState(false);
  /* 拖动中要把指针换成「抓住」，:active 在指针捕获后不可靠 */
  const [dragMode, setDragMode] = useState<"pan" | "item" | null>(null);
  const drag = useRef<
    | { mode: "pan"; sx: number; sy: number; ox: number; oy: number; moved: boolean }
    | { mode: "item"; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
    | null
  >(null);

  /* 只在素材集合变化时采用外部坐标，筛选再恢复才能找回隐藏项的位置；
     不随 board 本身触发 setNodes，避免持久化回写形成循环。 */
  const seed = useRef(board);
  seed.current = board;

  /* 素材换了（占位数据 → 真实图片）必须整体重建：
     否则会拿着旧 id 的坐标去合并，存下来的位置永远对不上 */
  const lastItems = useRef(items);
  useEffect(() => {
    if (lastItems.current === items) return;
    lastItems.current = items;
    setNodes(merge(scatter(items), seed.current));
  }, [items]);

  /* 位置变化就通知外部（外部做防抖落盘） */
  useEffect(() => {
    onBoardChange?.(nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, rot: n.rot })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  /* 首次进入把整块画布装进视口 */
  useLayoutEffect(() => {
    const el = host.current;
    if (!el || ready) return;
    const boxes = nodes.map((n, i) => {
      const { w, h } = sizeOf(n.aspect, i + 1);
      return { x: n.x, y: n.y, w, h };
    });
    setView(fitView(boxes, el.clientWidth, el.clientHeight));
    setReady(true);
  }, [nodes, ready]);

  /* 滚轮缩放：必须非 passive 才能 preventDefault */
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      setView((v) => zoomAt(v, sx, sy, v.k * Math.exp(-e.deltaY * 0.0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const startPan = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    host.current?.setPointerCapture(e.pointerId);
    setDragMode("pan");
    drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
  };

  const startItem = (e: ReactPointerEvent<HTMLDivElement>, node: Node) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    /* 捕获必须落在素材自己身上：捕获到容器会把后续的 click/dblclick
       一并重定向过去，素材就再也收不到双击了 */
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMode("item");
    drag.current = { mode: "item", id: node.id, sx: e.clientX, sy: e.clientY, ox: node.x, oy: node.y, moved: false };
    onSelect(node.id, e.ctrlKey || e.metaKey);
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;

    if (d.mode === "pan") {
      setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    } else {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === d.id ? { ...n, x: d.ox + dx / view.k, y: d.oy + dy / view.k } : n,
        ),
      );
    }
  };

  const end = () => {
    const d = drag.current;
    drag.current = null;
    setDragMode(null);
    if (d?.mode === "pan" && !d.moved) onClear();
  };

  const fit = useCallback(() => {
    const el = host.current;
    if (!el) return;
    const boxes = nodes.map((n, i) => {
      const { w, h } = sizeOf(n.aspect, i + 1);
      return { x: n.x, y: n.y, w, h };
    });
    setView(fitView(boxes, el.clientWidth, el.clientHeight));
  }, [nodes]);

  return (
    <div
      className="cv"
      ref={host}
      data-drag={dragMode ?? undefined}
      onPointerDown={startPan}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className="cv-world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        {nodes.map((n, i) => {
          const { w, h } = sizeOf(n.aspect, i + 1);
          return (
            <div
              key={n.id}
              className="cv-item"
              data-item={n.id}
              data-selected={selected.has(n.id) || undefined}
              style={
                {
                  left: n.x,
                  top: n.y,
                  width: w,
                  height: h,
                  transform: `rotate(${n.rot}deg)`,
                  background: n.color,
                } as CSSProperties
              }
              onPointerDown={(e) => startItem(e, n)}
              onDoubleClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onOpen(n.id, { x: r.x, y: r.y, w: r.width, h: r.height });
              }}
            >
              {n.src ? <img className="cv-img" src={n.src} alt="" loading="lazy" decoding="async" draggable={false} /> : null}
            </div>
          );
        })}
      </div>

      <div className="cv-hud" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="cv-btn" onClick={() => setView((v) => zoomAt(v, 400, 300, v.k / 1.2))} aria-label="缩小">−</button>
        <span className="cv-zoom">{Math.round(view.k * 100)}%</span>
        <button type="button" className="cv-btn" onClick={() => setView((v) => zoomAt(v, 400, 300, v.k * 1.2))} aria-label="放大">+</button>
        <button type="button" className="cv-fit" onClick={fit}>适配</button>
        <button
          type="button"
          className="cv-fit"
          onClick={() => {
            setNodes(scatter(items));
            onReset?.();
          }}
        >
          重排
        </button>
      </div>

      <div className="cv-hint">拖动空白平移 · 滚轮缩放 · 拖动素材移动 · 双击打开</div>
    </div>
  );
}
