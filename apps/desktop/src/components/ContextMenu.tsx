import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight, TrashCan } from "@ceas/ui/icons";

/* ══ 右键菜单 ════════════════════════════════════════════════
   结构：打开 / 标签 ▸ / 删除。
   标签子菜单里：已应用的（带勾）在前，最常用的在后，最后是
   「添加标签…」。点一下切换，菜单不关 —— 连着打几个标签是常规操作。

   位置钳制在视口内；子菜单不够宽时向左展开。
   ------------------------------------------------------------ */

type Props = {
  x: number;
  y: number;
  applied: string[];
  frequent: { tag: string; count: number }[];
  onOpenItem: () => void;
  onToggleTag: (tag: string) => void;
  onAddTag: (tag: string) => void;
  onDelete: () => void;
  onClose: () => void;
};

export function ContextMenu({ x, y, applied, frequent, onOpenItem, onToggleTag, onAddTag, onDelete, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const sub = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [tagsOpen, setTagsOpen] = useState(false);
  const [subLeft, setSubLeft] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  /* 主菜单不出界 */
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);

  /* 子菜单放右边会出界时，改放左边 */
  useLayoutEffect(() => {
    if (!tagsOpen || !sub.current || !box.current) return;
    const b = box.current.getBoundingClientRect();
    const s = sub.current.getBoundingClientRect();
    setSubLeft(b.right + s.width > window.innerWidth - 8);
  }, [tagsOpen, applied.length, frequent.length, adding]);

  /* 外部点击 / Esc / 滚动都关掉 */
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = () => onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose]);

  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);

  const rest = frequent.filter((f) => !applied.includes(f.tag));

  return (
    <div className="ctx" ref={box} style={{ left: pos.x, top: pos.y }} role="menu">
      <button type="button" className="ctx-item" role="menuitem" onClick={onOpenItem}>
        打开
        <kbd>↵</kbd>
      </button>

      <div
        className="ctx-item ctx-parent"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={tagsOpen}
        data-open={tagsOpen || undefined}
        tabIndex={0}
        onClick={() => setTagsOpen(true)}
        onPointerEnter={() => setTagsOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "ArrowRight") {
            e.preventDefault();
            setTagsOpen(true);
          }
        }}
      >
        标签
        <ChevronRight size={14} />
      </div>

      {tagsOpen ? (
        <div className="ctx-sub" ref={sub} style={subLeft ? { right: "calc(100% + 4px)" } : undefined} role="menu">
          {applied.length > 0 ? (
            <>
              <div className="ctx-label">已添加</div>
              {applied.map((t) => (
                <button key={t} type="button" className="ctx-item ctx-tag" role="menuitemcheckbox" aria-checked onClick={() => onToggleTag(t)}>
                  <Check size={13} />
                  {t}
                </button>
              ))}
            </>
          ) : null}

          {rest.length > 0 ? (
            <>
              <div className="ctx-label">{applied.length > 0 ? "常用" : "常用标签"}</div>
              {rest.map((f) => (
                <button key={f.tag} type="button" className="ctx-item ctx-tag" role="menuitemcheckbox" aria-checked={false} onClick={() => onToggleTag(f.tag)}>
                  <span className="ctx-check-slot" />
                  {f.tag}
                  <span className="ctx-count">{f.count}</span>
                </button>
              ))}
            </>
          ) : null}

          <div className="ctx-sep" />

          {adding ? (
            <form
              className="ctx-add"
              onSubmit={(e) => {
                e.preventDefault();
                const t = draft.trim();
                if (t) onAddTag(t);
                setDraft("");
                setAdding(false);
              }}
            >
              <input
                ref={input}
                value={draft}
                placeholder="标签名，回车确认"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setAdding(false);
                  }
                }}
              />
            </form>
          ) : (
            <button type="button" className="ctx-item" role="menuitem" onClick={() => setAdding(true)}>
              添加标签…
            </button>
          )}
        </div>
      ) : null}

      <div className="ctx-sep" />

      <button type="button" className="ctx-item ctx-danger" role="menuitem" onClick={onDelete}>
        <TrashCan size={14} />
        删除
        <kbd>Del</kbd>
      </button>
    </div>
  );
}
