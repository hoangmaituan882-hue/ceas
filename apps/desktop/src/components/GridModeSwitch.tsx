import { motion } from "motion/react";
import type { GridMode } from "@/components/Grid";

/* ══ 网格排布切换 ════════════════════════════════════════════
   右下角胶囊，两个选项：对齐 / 瀑布。
   滑块用 layoutId 在两个选项间滑动 —— 这是唯一用共享布局
   动画的地方（不在虚拟列表里，安全）。
   ------------------------------------------------------------ */

type Props = { value: GridMode; onChange: (mode: GridMode) => void };

const OPTIONS: { id: GridMode; label: string }[] = [
  { id: "standard", label: "对齐" },
  { id: "masonry", label: "瀑布" },
];

export function GridModeSwitch({ value, onChange }: Props) {
  return (
    <div className="mode-capsule" role="radiogroup" aria-label="网格排布">
      {OPTIONS.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            className="mode-option"
            data-active={active || undefined}
            onClick={() => onChange(o.id)}
          >
            {active ? (
              <motion.span
                layoutId="grid-mode-thumb"
                className="mode-thumb"
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
              />
            ) : null}
            <span className="mode-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
