import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* Pixcall 支持验收（在原生窗口里跑）：
   1) 直接调 pixcall_scan，看条目数 / 可读数 / 标签还原
   2) 取前 6 条走真实的导入入口，验证标签写进标签库
   3) 磁盘上应出现对应 blob */

const CDP = process.env.CDP_URL ?? "http://127.0.0.1:9222";
const LIB = process.env.PIXCALL_ROOT;
if (!LIB) throw new Error("请先设置 PIXCALL_ROOT，明确选择只读验收来源。");
const OUT = ".cache/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("localhost:5173")) ?? ctx.pages()[0];
if (!page) throw new Error("没找到 Tauri 窗口");
await page.waitForSelector(".cell, .empty", { timeout: 20000 });

/* 1) 扫描 */
const scan = await page.evaluate(async (root) => {
  const api = window.__TAURI_INTERNALS__;
  const res = await api.invoke("pixcall_scan", { root, limit: 0 });
  return {
    total: res.total,
    readable: res.readable,
    tagCount: res.tag_count,
    sample: res.entries.slice(0, 3).map((e) => ({ rel: e.rel_path, tags: e.tags, ct: e.content_type })),
    tagged: res.entries.filter((e) => e.tags.length > 0).length,
    /* 优先挑「带标签的图片」，这样能同时验证两条链路 */
    firstSix: res.entries
      .filter((e) => e.content_type.startsWith("image/"))
      .sort((a, b) => b.tags.length - a.tags.length)
      .slice(0, 6)
      .map((e) => ({ name: e.name, path: e.path, tags: e.tags, content_type: e.content_type })),
  };
}, LIB);

/* 2) 走真实导入入口（只取前 6 条，避免一次吞掉 5806 个） */
await page.evaluate(async (entries) => {
  const fn = window.__ceasImportPixcall;
  if (!fn) throw new Error("没有暴露 __ceasImportPixcall");
  fn(entries);
}, scan.firstSix);

await page.waitForSelector(".import-bar", { timeout: 15000 });
await page.waitForFunction(
  () => document.querySelector(".import-label")?.textContent?.includes("导入完成"),
  null,
  { timeout: 90000 },
);
await page.waitForTimeout(800);

const bar = await page.locator(".import-row").textContent();
const tags = await page.evaluate(() => {
  const raw = localStorage.getItem("ceas.tags.v1");
  return raw ? JSON.parse(raw) : null;
});
const taggedItems = tags ? Object.values(tags).filter((v) => Array.isArray(v) && v.length > 0).length : 0;

await page.screenshot({ path: `${OUT}/210-pixcall-import.png` });

console.log(JSON.stringify({
  scan: { total: scan.total, readable: scan.readable, tagCount: scan.tagCount, tagged: scan.tagged },
  sample: scan.sample,
  bar: bar?.replace(/\s+/g, " ").trim(),
  taggedItems,
  tagSample: tags ? Object.entries(tags).slice(0, 3) : null,
}, null, 2));

await browser.close();
