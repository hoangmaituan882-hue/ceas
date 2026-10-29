/* ══ @ceas/views ═════════════════════════════════════════════
   三个渲染内核：网格（在 app 里先用着）、画布、无限（待做）。
   共同底座是 viewport.ts 的坐标数学。
   ------------------------------------------------------------ */

export { layoutJustified, visibleRows } from "./grid/layout";
export type { Box, Placed, Row } from "./grid/layout";
export { layoutMasonry } from "./grid/masonry";
export { Canvas } from "./canvas/canvas";
export { InfinityView } from "./infinity/infinity";
export type { CanvasSource, Rect } from "./canvas/canvas";
export { clamp, fitView, toScreen, toWorld, zoomAt, MIN_K, MAX_K } from "./viewport";
export type { Viewport } from "./viewport";
