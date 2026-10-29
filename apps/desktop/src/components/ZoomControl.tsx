import { clamp } from "@ceas/views/viewport";

/* ══ 缩略图缩放 ══════════════════════════════════════════════
   参考视频里的右下角工具条：`− [滑杆] ×1.4`，拖动时缩略图连续
   变大变小。这里做成「相对当前密度的倍率」，密度仍决定基准行高，
   zoom 只做乘法 —— 这样密度语义不被破坏，滑杆也不会跨档跳。

   拖动时不加过渡：60fps 的重排本身就是动画，再叠 380ms 补间
   只会拖慢手感。
   ------------------------------------------------------------ */

export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 1.8;
const STEP = 0.02;

type Props = { value: number; onChange: (v: number) => void };

export function ZoomControl({ value, onChange }: Props) {
  const set = (v: number) => onChange(Number(clamp(v, ZOOM_MIN, ZOOM_MAX).toFixed(2)));

  return (
    <div className="zoom-control">
      <button type="button" className="zoom-step" onClick={() => set(value - 0.1)} aria-label="缩小缩略图">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M5 12h14" />
        </svg>
      </button>

      <input
        className="zoom-range"
        type="range"
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={STEP}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        aria-label="缩略图大小"
      />

      <button type="button" className="zoom-step" onClick={() => set(value + 0.1)} aria-label="放大缩略图">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      <span className="zoom-value">×{value.toFixed(1)}</span>
    </div>
  );
}
