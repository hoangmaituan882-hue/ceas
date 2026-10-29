#!/usr/bin/env node
/**
 * 从 akar-icons 提取指定图标的 SVG 路径，生成 packages/ui/icons.generated.tsx
 *
 * 为什么不用 npm 依赖：
 * akar-icons 是 CJS 单文件包（main: dist/index.js，无 ESM、无 exports），
 * 十个图标会把 434 个全打进产物（实测 343KB → 683KB）。这里在构建期把
 * 用到的图标渲染成静态 SVG 抄进源码，运行时零依赖，视觉完全一致。
 *
 * 用法：node scripts/gen-icons.mjs
 */

import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const reqApp = createRequire(join(ROOT, "apps/desktop/package.json"));
const reqUi = createRequire(join(ROOT, "packages/ui/package.json"));

const React = reqApp("react");
const { renderToStaticMarkup } = reqApp("react-dom/server");
const akar = reqUi("akar-icons");

/* 需要抄进来的图标：以 akar 的名字为键，以我们的语义名为值 */
const PICK = {
  Search: "Search",
  Inbox: "Inbox",
  Folder: "Folder",
  Tag: "Tag",
  Plus: "Plus",
  ChevronRight: "ChevronRight",
  Filter: "Filter",
  ArrowUpDown: "Sort",
  Ascending: "SortAsc",
  Descending: "SortDesc",
  ThreeLineHorizontal: "Menu",
  Check: "Check",
  Gear: "Settings",
  TrashCan: "TrashCan",
};

const ATTR = {
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-dasharray": "strokeDasharray",
  "stroke-opacity": "strokeOpacity",
  "fill-opacity": "fillOpacity",
};

function toJsx(html) {
  return html.replace(/\s([a-z]+(?:-[a-z]+)+)=/g, (m, name) => ` ${ATTR[name] ?? name}=`);
}

const parts = [];
for (const [name, ours] of Object.entries(PICK)) {
  const C = akar[name];
  if (!C) {
    console.warn(`[gen-icons] akar 里找不到 ${name}，跳过`);
    continue;
  }
  const markup = renderToStaticMarkup(React.createElement(C, { size: 24 }));
  const inner = markup.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  const viewBox = /viewBox="([^"]+)"/.exec(markup)?.[1] ?? "0 0 24 24";
  parts.push({ ours, viewBox, inner: toJsx(inner) });
}

const body = parts
  .map(
    (p) => `/** akar:${p.ours} */
export const ${p.ours} = (p: IconProps) => (
  <Icon viewBox="${p.viewBox}" {...p}>
    ${p.inner}
  </Icon>
);`,
  )
  .join("\n\n");

const file = `/* 由 scripts/gen-icons.mjs 生成，不要手改。
   来源：akar-icons（MIT）· ${parts.length} 个图标
   重新生成：node scripts/gen-icons.mjs */

import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

${body}
`;

writeFileSync(join(ROOT, "packages/ui/icons.generated.tsx"), file, "utf-8");
console.log(`[gen-icons] 写入 ${parts.length} 个图标 → packages/ui/icons.generated.tsx`);
