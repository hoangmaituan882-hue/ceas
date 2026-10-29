import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = ["CollectionManager.tsx", "FileStatus.tsx", "FileIssues.tsx", "TrashRestore.tsx", "file-status.css", "LibraryHeader.tsx", "LibraryManager.tsx", "LibraryGuide.tsx", "LibraryTask.tsx", "library-manager.css", "Settings.tsx", "LibraryTools.tsx", "QueryFilters.tsx", "QueryStatus.tsx", "LibraryBoundary.tsx", "LibraryOrganization.tsx", "FileMetadata.tsx", "library-organization.css", "library-tools.css"];
files.push("AcquisitionStatus.tsx", "acquisition.css");
for (const name of files) {
  const raw = readFileSync(new URL(`../apps/desktop/src/components/${name}`, import.meta.url), "utf8");
  /* 注释里出现 "300ms"、"15px" 是在解释规范，不是在写视觉值；
     先剥掉注释再判断，否则守卫会逼着大家把注释写得更含糊。
     `[^:]` 避免误删 https:// 这类字符串里的 //。 */
  const source = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.ok(!/(?:#[\da-f]{3,8}\b|rgba?\(|\b\d+(?:\.\d+)?(?:px|ms)\b)/i.test(source), `${name} 新增了裸视觉值`);
  assert.ok(!/transition\s*:\s*all|framer-motion|from ["'](?:akar-icons|lucide-react)/.test(source), `${name} 违反样式或依赖约束`);
}
const core = ["item-query.ts", "file-reconcile.ts", "collection-model.ts", "acquisition.ts"].map(name => readFileSync(new URL(`../packages/core/${name}`, import.meta.url), "utf8")).join("\n");
assert.ok(!/from ["'](?:react|@tauri)|\b(?:window|document|localStorage)\b/.test(core), "core 越过纯 TS 边界");
console.log("查询工具设计断言通过：视觉值来自现有 token；图标出口与 core 边界合规。");
