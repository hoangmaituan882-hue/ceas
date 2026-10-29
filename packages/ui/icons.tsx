/* ══ 图标唯一出口 ════════════════════════════════════════════
   来源：akar-icons（MIT，2px 圆角描边）。
   做法是「构建期抄进来」而不是运行时依赖 —— akar 是 CJS 单文件包，
   直接 import 会把 434 个图标全打进产物（实测 343KB → 683KB）。
   抄进来后零运行时依赖，图形完全一致。

   新增图标：在 scripts/gen-icons.mjs 的 PICK 里加一行，重新生成。
   缺口（docs/03-图标缺口核对.md）：Density / 色板 / 画布视图 /
   套索 / 成组 / 解组 / 图层 / 分布 —— 自绘。
   ------------------------------------------------------------ */

export * from "./icons.generated";
export type { IconProps } from "./icons.generated";

import type { IconProps } from "./icons.generated";

/* ── 自绘：akar 没有「密度」这个语义（缺口 1/8）──────────────
   三条横线、粗细递减。与 Menu 的三条等粗线区分开。 */
export const Density = ({ size = 20, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M4 7h16" strokeWidth={2.6} />
    <path d="M4 12h16" strokeWidth={1.8} />
    <path d="M4 17h16" strokeWidth={1.2} />
  </svg>
);
