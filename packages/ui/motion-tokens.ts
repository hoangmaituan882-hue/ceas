/* ══ 动效 token ══════════════════════════════════════════════
   规范 §6 里定死的那几个值，只在这里出现一次。
   组件里禁止写 stiffness/damping/duration 字面量。
   ------------------------------------------------------------ */

/** 时长，秒。motion 用秒，CSS 用毫秒，这里只放秒 */
export const DUR = {
  fast: 0.14,
  base: 0.2,
  slow: 0.28,
} as const;

/** 唯一的弹簧：damping 32 / stiffness 320，约 250ms 收敛 */
export const SPRING = { type: "spring", stiffness: 320, damping: 32 } as const;

/** 透明度过渡的标准曲线（快出慢入） */
export const EASE_STANDARD = [0.2, 0, 0, 1] as const;

/** 按压反馈 */
export const PRESS = { scale: 0.97 } as const;
export const HOVER = { scale: 1.015, filter: "brightness(1.03)" } as const;
