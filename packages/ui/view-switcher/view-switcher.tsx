"use client";

import { motion } from "motion/react";
import { useId, useRef } from "react";
import { SPRING } from "../motion-tokens";

/* ══ 顶部胶囊 · 三视图切换 ═══════════════════════════════════
   规范 §7.1：240×36，圆角 18，三段等分 76×28。
   滑块用 layoutId 做共享元素 —— 它是同一个元素在两个位置
   之间移动，这是 layoutId 唯一无可替代的用法。

   注意：只有「当前项」渲染滑块，其余项不渲染。这样同一时刻
   只有一个滑块存在，motion 会自动从旧位置飞到新位置。
   ------------------------------------------------------------ */

export type ViewMode = "grid" | "canvas" | "infinity";

const OPTIONS: { id: ViewMode; label: string; hint: string }[] = [
  { id: "grid", label: "网格", hint: "扫描与检索" },
  { id: "canvas", label: "画布", hint: "比较与搭建" },
  { id: "infinity", label: "无限", hint: "漂移与偶遇" },
];

type Props = {
  value: ViewMode;
  onChange: (next: ViewMode) => void;
};

export function ViewSwitcher({ value, onChange }: Props) {
  /* useId 里带冒号，直接进 layoutId 会在选择器里出问题 */
  const pillId = `view-pill-${useId().replace(/:/g, "")}`;
  const segs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (dir: 1 | -1) => {
    const from = OPTIONS.findIndex((o) => o.id === value);
    const next = (from + dir + OPTIONS.length) % OPTIONS.length;
    const target = OPTIONS[next];
    if (!target) return;
    onChange(target.id);
    segs.current[next]?.focus();
  };

  return (
    <div className="vs" role="tablist" aria-label="视图切换">
      {OPTIONS.map((opt, i) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            ref={(n) => { segs.current[i] = n; }}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`${opt.label}视图 · ${opt.hint}`}
            tabIndex={active ? 0 : -1}
            data-active={active || undefined}
            className="vs-seg"
            onClick={() => onChange(opt.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
              if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
            }}
          >
            {active ? <motion.span layoutId={pillId} className="vs-pill" transition={SPRING} /> : null}
            <span className="vs-label">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
