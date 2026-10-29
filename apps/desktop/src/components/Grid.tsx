import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { Item } from "@/data/items";
import type { Density } from "@/App";
import { layoutJustified, type Placed } from "@ceas/views/grid/layout";
import { layoutMasonry } from "@ceas/views/grid/masonry";
import type { Origin } from "@/components/DetailOverlay";

/* ══ 网格 · 虚拟化 ═══════════════════════════════════════════
   只渲染可见行 + 一圈 overscan。行由 justified 布局算出来，
   所以虚拟化的单位是「行」而不是「项」—— 这是 justified 的
   红利：行高已知、位置确定，不需要逐项测量。

   注意 §5.3：虚拟列表里不允许 layout 动画。这里唯一带 layoutId
   的元素是缩略图本身，它只用于「打开详情」的共享元素过渡，
   不参与任何重排动画。
   ------------------------------------------------------------ */

const OVERSCAN = 600;
const MORPH_MS = 480;

export type GridMode = "standard" | "masonry";

/* 开发态打一个加载时间戳：改完代码如果不刷新，
   这个值不会变 —— 一眼就能判断看到的是不是新页面 */
const BOOT = new Date().toLocaleTimeString("zh-CN", { hour12: false });

type Props = {
  items: Item[];
  selected: Set<string>;
  density: Density;
  /** 标准=对齐（justified）／瀑布流=masonry */
  mode: GridMode;
  /** 相对当前密度的缩放倍率 */
  zoom: number;
  /** 详情展开中：其余格子退场 */
  recede?: boolean;
  /** 正在展开的那一张（它自己退得更快，避免和浮层重复） */
  focusId?: string | null;
  onSelect: (id: string, additive: boolean) => void;
  /** 批量选择：Shift 连选与拖拽框选都走这里 */
  onSelectMany: (ids: string[], additive: boolean) => void;
  onClear: () => void;
  onOpen: (id: string, origin?: Origin) => void;
  /** 右键：交给上层弹菜单 */
  onContext?: (id: string, x: number, y: number) => void;
};

function originOf(el: Element): Origin {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

export function Grid({ items, selected, density, mode, zoom, recede, focusId, onSelect, onSelectMany, onClear, onOpen, onContext }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0, top: 0 });
  const [tokens, setTokens] = useState({ rowTarget: 224, gap: 16 });
  const raf = useRef(0);
  /* 框选：起点记在内容坐标系里，滚动时不会错位 */
  const marquee = useRef<{ x0: number; y0: number; additive: boolean; moved: boolean } | null>(null);
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  /* 刚拖完框选时浏览器还会补一个 click，不能让它把刚选好的清掉 */
  const dragged = useRef(false);
  /* Shift 连选的锚点：上一次普通点击的项 */
  const anchor = useRef<number | null>(null);

  const measure = useCallback(() => {
    const scroller = scrollRef.current;
    const grid = gridRef.current;
    if (!scroller || !grid) return;
    const style = getComputedStyle(grid);
    setTokens({
      rowTarget: parseFloat(style.getPropertyValue("--row-target")) || 224,
      gap: parseFloat(style.getPropertyValue("--grid-gap")) || 16,
    });
    setBox({ width: grid.clientWidth, height: scroller.clientHeight, top: scroller.scrollTop });
  }, []);

  useEffect(() => {
    measure();
    const grid = gridRef.current;
    const scroller = scrollRef.current;
    if (!grid || !scroller) return;
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [measure, density]);

  const onScroll = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const scroller = scrollRef.current;
      if (!scroller) return;
      setBox((prev) => (prev.top === scroller.scrollTop ? prev : { ...prev, top: scroller.scrollTop }));
    });
  }, []);

  /* 两种布局返回同构结果：显式标注返回类型，
     避免 TS 把两个分支推成联合类型后 `.filter` 报签名不兼容 */
  const { height, placed } = useMemo<{ height: number; placed: Placed[] }>(() => {
    /* 密度决定基准，滑杆只做倍率 */
    const rowTarget = tokens.rowTarget * zoom;
    if (mode === "masonry") {
      const m = layoutMasonry(items, box.width, Math.max(160, Math.round(rowTarget * 1.12)), tokens.gap);
      return { height: m.height, placed: m.placed };
    }
    const j = layoutJustified(items, box.width, rowTarget, tokens.gap);
    const flat: Placed[] = [];
    for (const row of j.rows) for (const p of row.items) flat.push(p);
    return { height: j.height, placed: flat };
  }, [items, box.width, tokens.rowTarget, tokens.gap, mode, zoom]);

  /* 统一按 y 区间过滤：两种模式只有一份渲染代码 */
  const shown = useMemo(
    () =>
      placed.filter(
        (p) => p.box.y + p.box.h > box.top - OVERSCAN && p.box.y < box.top + box.height + OVERSCAN,
      ),
    [placed, box.top, box.height],
  );

  /* 模式切换时开一次补间：380ms 位置补间 + 每项 6ms 错峰 */
  const [morph, setMorph] = useState(false);
  const lastMode = useRef(mode);
  useEffect(() => {
    if (lastMode.current === mode) return;
    lastMode.current = mode;
    setMorph(true);
    const timer = window.setTimeout(() => setMorph(false), MORPH_MS);
    return () => window.clearTimeout(timer);
  }, [mode]);

  /* 屏幕坐标 → 内容坐标：要扣掉容器 padding、加上滚动量，
     否则框选框会和素材错位 */
  const toContent = (clientX: number, clientY: number) => {
    const el = scrollRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: clientX - r.left + el.scrollLeft - parseFloat(cs.paddingLeft),
      y: clientY - r.top + el.scrollTop - parseFloat(cs.paddingTop),
    };
  };

  const hitsIn = (x0: number, y0: number, x1: number, y1: number) => {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    const ids: string[] = [];
    for (const p of placed) {
      const b = p.box;
      if (b.y + b.h < top || b.y > bottom) continue;
      if (b.x + b.w < left || b.x > right) continue;
      const item = items[p.index];
      if (item) ids.push(item.id);
    }
    return ids;
  };

  const onBandDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const p = toContent(e.clientX, e.clientY);
    dragged.current = false;
    marquee.current = { x0: p.x, y0: p.y, additive: e.shiftKey || e.ctrlKey || e.metaKey, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!marquee.current.additive) onClear();
  };

  const onBandMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const m = marquee.current;
    if (!m) return;
    const p = toContent(e.clientX, e.clientY);
    if (!m.moved && Math.abs(p.x - m.x0) + Math.abs(p.y - m.y0) > 3) m.moved = true;
    if (!m.moved) return;
    setBand({
      x: Math.min(m.x0, p.x),
      y: Math.min(m.y0, p.y),
      w: Math.abs(p.x - m.x0),
      h: Math.abs(p.y - m.y0),
    });
    onSelectMany(hitsIn(m.x0, m.y0, p.x, p.y), m.additive);
  };

  const onBandUp = () => {
    dragged.current = marquee.current?.moved === true;
    marquee.current = null;
    setBand(null);
  };

  /* 展开时的退场：以被点中的那张为中心，越远越晚消失，形成向外扩散 */
  const focusIndex = focusId ? items.findIndex((it) => it.id === focusId) : -1;

  return (
    <div className="grid-scroll" ref={scrollRef} onScroll={onScroll}>
      <div
        className="grid"
        ref={gridRef}
        style={{ height }}
        data-morph={morph || undefined}
        data-recede={recede || undefined}
        onPointerDown={onBandDown}
        onPointerMove={onBandMove}
        onPointerUp={onBandUp}
        onPointerCancel={onBandUp}
        onClick={(e) => {
          /* 点空白处取消选择；刚拖完框选时浏览器补的那次 click 要忽略 */
          if (e.target === e.currentTarget && !dragged.current) onClear();
        }}
      >
        {band ? (
          <div
            className="marquee"
            style={{ left: band.x, top: band.y, width: band.w, height: band.h }}
            aria-hidden="true"
          />
        ) : null}
        {shown.map(({ index, box: b }) => {
            const item = items[index];
            if (!item) return null;
            const isSel = selected.has(item.id);
            const isFocus = focusId === item.id;
            /* 距离焦点越远，退场越晚 —— 像被中间那张「推开」 */
            const recedeDelay = recede && focusIndex >= 0 ? Math.min(Math.abs(index - focusIndex) * 6, 180) : 0;
            return (
              <button
                key={item.id}
                type="button"
                className="cell"
                data-id={item.id}
                data-selected={isSel || undefined}
                data-focus={isFocus || undefined}
                style={{
                  left: b.x,
                  top: b.y,
                  width: b.w,
                  height: b.h,
                  /* 错峰：索引越大越晚一点，形成从左上的铺开感 */
                  transitionDelay: morph ? `${Math.min(index * 6, 150)}ms` : undefined,
                  ["--recede-delay" as string]: `${recedeDelay}ms`,
                } as CSSProperties}
                onClick={(e) => {
                  /* Shift+单击：从锚点到这里的整段；
                     Ctrl/Cmd+单击：加/减单张；
                     普通单击：替换选择（双击时两次都落在同一张，不闪）。 */
                  if (e.shiftKey && anchor.current !== null) {
                    const lo = Math.min(anchor.current, index);
                    const hi = Math.max(anchor.current, index);
                    const ids = items.slice(lo, hi + 1).map((it) => it.id);
                    onSelectMany(ids, e.ctrlKey || e.metaKey);
                    return;
                  }
                  anchor.current = index;
                  onSelect(item.id, e.ctrlKey || e.metaKey);
                }}
                onDoubleClick={(e) => onOpen(item.id, originOf(e.currentTarget))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onContext?.(item.id, e.clientX, e.clientY);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onOpen(item.id, originOf(e.currentTarget));
                  }
                }}
                aria-label={`${item.name}，${item.kind === "video" ? "视频" : item.kind === "link" ? "链接" : item.kind==="file"?"文件":"图片"}`}
                aria-pressed={isSel}
              >
                <span className="thumb" style={{ background: item.color }}>
                  {item.fileState&&item.fileState!=="ready"?<span className="file-state-badge">{item.fileState==="missing"?"原件缺失":item.fileState==="pending"?"更新待处理":item.fileState==="decode"?"无法解码":"原件不可读"}</span>:null}
                  {item.kind==="file"?<span className="thumb-file">{item.originalName??item.name}</span>:null}
                  {item.src ? (
                    <img className="thumb-img" src={item.src} alt="" loading="lazy" decoding="async" draggable={false} />
                  ) : null}
                  {item.kind === "video" && item.duration ? <span className="badge">{item.duration}</span> : null}
                  {item.kind === "link" && item.site ? (
                    <span className="badge" data-kind="link">{item.site}</span>
                  ) : null}
                </span>
              </button>
            );
        })}
      </div>

      {import.meta.env.DEV ? (
        <div className="perf-hud">
          {items.length} 项 · {mode === "masonry" ? "瀑布" : "对齐"} · 渲染 {shown.length} 个 · 加载于 {BOOT}
        </div>
      ) : null}
    </div>
  );
}
