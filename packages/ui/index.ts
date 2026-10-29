/* ══ @ceas/ui ════════════════════════════════════════════════
   设计系统的唯一出口。业务代码从这里取，不直接引用内部文件
   以外的图标库 / 动画库 / 组件库。
   ------------------------------------------------------------ */

export * as Icons from "./icons";
export { Mascot } from "./mascot/mascot";
export { ViewSwitcher } from "./view-switcher/view-switcher";
export type { ViewMode } from "./view-switcher/view-switcher";
export { DUR, SPRING, EASE_STANDARD, PRESS, HOVER } from "./motion-tokens";
