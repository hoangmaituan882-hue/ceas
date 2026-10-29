import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Item } from "@/data/items";

/* ══ 收件箱过片 ══════════════════════════════════════════════
   排版参照「大图 + 两侧箭头 + 底部胶片条」：
   - 图片是主角，信息压成左下角一枚角标
   - 胶片条让用户知道自己在队列的哪个位置，也能直接跳
   - 操作行收在胶片条下面，键位提示压到最底、最轻

   键位：← → 切换 · 1–4 归档 · T 标签 · Delete 丢弃
        Ctrl+Z 撤销 · Esc 退出
   ------------------------------------------------------------ */

type Props = {
  item: Item;
  queue: Item[];
  index: number;
  remaining: number;
  total: number;
  collections: { id: string; label: string }[];
  canUndo: boolean;
  onNext: () => void;
  onPrev: () => void;
  onJump: (index: number) => void;
  onArchive: (collectionId: string, label: string) => void;
  onDiscard: () => void;
  busy?: boolean;
  onTag: (tag: string) => void;
  onUndo: () => void;
  onExit: () => void;
};

export function Triage({
  item,
  queue,
  index,
  remaining,
  total,
  collections,
  canUndo,
  onNext,
  onPrev,
  onJump,
  onArchive,
  onDiscard,
  busy=false,
  onTag,
  onUndo,
  onExit,
}: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagText, setTagText] = useState("");
  const input = useRef<HTMLInputElement>(null);

  /* 等比适配：宽度 82vw / 高度 72vh 取小，扣掉舞台内边距 */
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const availW = Math.max(1, Math.min(el.clientWidth - padX, window.innerWidth * 0.82));
    const availH = Math.max(1, Math.min(el.clientHeight - padY, window.innerHeight * 0.72));
    const ar = item.aspect || 1;
    let w = availW;
    let h = w / ar;
    if (h > availH) {
      h = availH;
      w = h * ar;
    }
    setSize({ w, h });
  }, [item.id, item.aspect]);

  /* 当前项在胶片条里保持居中 */
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-idx="${index}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  useLayoutEffect(() => {
    if (tagOpen) input.current?.focus();
  }, [tagOpen]);

  /* 键位收在组件里：输入框打开时不抢键 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tagOpen || busy) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        onUndo();
        return;
      }

      switch (e.key) {
        case "ArrowRight":
        case "j":
          e.preventDefault();
          onNext();
          return;
        case "ArrowLeft":
        case "k":
          e.preventDefault();
          onPrev();
          return;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          onDiscard();
          return;
        case "Escape":
          e.preventDefault();
          onExit();
          return;
        case "t":
        case "T":
          e.preventDefault();
          setTagOpen(true);
          return;
        default:
          break;
      }

      if (/^[1-9]$/.test(e.key)) {
        const target = collections[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          onArchive(target.id, target.label);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tagOpen, collections, onArchive, onDiscard, onExit, onNext, onPrev, onUndo, busy]);

  return (
    <div className="triage" role="dialog" aria-modal="true" aria-label="收件箱过片" aria-busy={busy} inert={busy||undefined}>
      <div className="triage-top">
        <span className="triage-remaining">
          还剩 {remaining} 张
          <span className="triage-sep">·</span>
          共 {total}
        </span>
        <button type="button" className="triage-exit" onClick={onExit}>
          退出 <kbd>Esc</kbd>
        </button>
      </div>

      <div className="triage-stage" ref={stage}>
        <button type="button" className="triage-nav prev" onClick={onPrev} aria-label="上一张">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>

        <figure className="triage-figure">
          <div
            className="triage-media"
            style={{
              background: item.color,
              width: size ? `${size.w}px` : undefined,
              height: size ? `${size.h}px` : undefined,
            }}
          >
            {item.src ? <img className="triage-img" src={item.src} alt="" draggable={false} /> : null}
            {item.kind === "video" && item.duration ? <span className="triage-badge">{item.duration}</span> : null}
          </div>
          <figcaption className="triage-caption">
            <span className="triage-name">{item.name}</span>
            <span className="triage-meta">{item.size}</span>
          </figcaption>
        </figure>

        <button type="button" className="triage-nav next" onClick={onNext} aria-label="下一张">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <div className="triage-strip" ref={strip}>
        {queue.map((q, i) => (
          <button
            key={q.id}
            type="button"
            data-idx={i}
            className="triage-thumb"
            data-active={i === index || undefined}
            onClick={() => onJump(i)}
            aria-label={`第 ${i + 1} 张 ${q.name}`}
            aria-current={i === index}
          >
            {q.src ? <img src={q.src} alt="" draggable={false} /> : null}
          </button>
        ))}
      </div>

      <div className="triage-actions">
        {collections.map((c, i) => (
          <button key={c.id} type="button" disabled={busy} className="triage-chip" onClick={() => onArchive(c.id, c.label)}>
            <kbd>{i + 1}</kbd>
            {c.label}
          </button>
        ))}
        <button type="button" className="triage-chip" onClick={() => setTagOpen((v) => !v)}>
          <kbd>T</kbd>
          标签
        </button>
        <button type="button" disabled={busy} className="triage-chip" onClick={onDiscard}>
          <kbd>Del</kbd>
          丢弃
        </button>
      </div>

      <div className="triage-keys" aria-hidden="true">
        <span>
          <kbd>←</kbd> <kbd>→</kbd> 切换
        </span>
        <span>
          <kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤销{canUndo ? "" : "（暂无可撤销）"}
        </span>
      </div>

      {tagOpen ? (
        <form
          className="triage-tagbox"
          onSubmit={(e) => {
            e.preventDefault();
            const t = tagText.trim();
            if (t) onTag(t);
            setTagText("");
            setTagOpen(false);
          }}
        >
          <input
            ref={input}
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setTagOpen(false);
              }
            }}
            placeholder="输入标签，回车确认"
            aria-label="标签"
          />
        </form>
      ) : null}
    </div>
  );
}
