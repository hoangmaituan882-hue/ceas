import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 读路径验收（原生窗口）：
   1) 导一张「还没导入过」的 Pixcall 图片
   2) IndexedDB 的 originals 不应增加（说明原件只在磁盘）
   3) 双击打开详情，图能显示 —— 既然 IndexedDB 没有原件，只能来自磁盘 */

const CDP = process.env.CDP_URL ?? "http://127.0.0.1:9222";
const LIB = process.env.PIXCALL_ROOT;
if (!LIB) throw new Error("请先设置 PIXCALL_ROOT，明确选择只读验收来源。");
const OUT = ".cache/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP(CDP);
const page = browser.contexts()[0].pages().find((p) => p.url().includes("localhost:5173"));
if (!page) throw new Error("没找到 Tauri 窗口");
await page.waitForSelector(".cell, .empty", { timeout: 20000 });

const counts = () =>
  page.evaluate(async () => {
    const db = await new Promise((res) => {
      const r = indexedDB.open("ceas");
      r.onsuccess = () => res(r.result);
    }).then((d) => d);
    const count = (store) =>
      new Promise((res) => {
        const t = db.transaction(store, "readonly");
        const q = t.objectStore(store).count();
        q.onsuccess = () => res(q.result);
      });
    const items = await new Promise((res) => {
      const t = db.transaction("items", "readonly");
      const q = t.objectStore("items").getAll();
      q.onsuccess = () => res(q.result.map((i) => ({ name: i.name, id: i.id, hash: i.hash, ext: i.ext })));
    });
    const blobs = await window.__TAURI_INTERNALS__.invoke("blob_count");
    return { items: await count("items"), originals: await count("originals"), disk: blobs, rows: items };
  });

const before = await counts();

/* 找一张还没导入过的图片 */
const pick = await page.evaluate(async ({ root, seen }) => {
  const scan = await window.__TAURI_INTERNALS__.invoke("pixcall_scan", { root, limit: 0 });
  const seenSet = new Set(seen);
  const e = scan.entries.find(
    (x) => x.content_type.startsWith("image/") && x.tags.length > 0 && !seenSet.has(x.name),
  );
  return e ? { name: e.name, path: e.path, tags: e.tags, content_type: e.content_type } : null;
}, { root: LIB, seen: before.rows.map((r) => r.name) });

if (!pick) throw new Error("没找到可用的新图片条目");

await page.evaluate((entry) => window.__ceasImportPixcall([entry]), pick);
await page.waitForSelector(".import-bar", { timeout: 15000 });
await page.waitForFunction(
  () => document.querySelector(".import-label")?.textContent?.includes("导入完成"),
  null,
  { timeout: 60000 },
);
await page.waitForTimeout(1000);

const after = await counts();
const newRow = after.rows.find((r) => r.name === pick.name);
const originalsHasIt = await page.evaluate(async (hash) => {
  const db = await new Promise((res) => {
    const r = indexedDB.open("ceas");
    r.onsuccess = () => res(r.result);
  });
  return new Promise((res) => {
    const t = db.transaction("originals", "readonly");
    const q = t.objectStore("originals").get(hash);
    q.onsuccess = () => res(!!q.result);
  });
}, newRow?.hash ?? "");

/* 双击打开详情 */
let detail = null;
if (newRow) {
  /* 新条目排在最后，虚拟列表还没渲染；先滚到底 */
  await page.evaluate(() => {
    const el = document.querySelector(".grid-scroll");
    if (el) el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(800);

  const cell = page.locator(`.cell[data-id="${newRow.id}"]`);
  const found = await cell.count();
  if (found > 0) {
    await cell.first().dblclick();
    await page.waitForSelector(".overlay-media", { timeout: 8000 });
    await page.waitForTimeout(1200);
    detail = await page.evaluate(() => {
      const img = document.querySelector(".overlay-img");
      return img ? { loaded: img.complete && img.naturalWidth > 0, w: img.naturalWidth, h: img.naturalHeight, src: img.src.slice(0, 5) } : null;
    });
    await page.screenshot({ path: `${OUT}/220-disk-read.png` });
    await page.keyboard.press("Escape");
  } else {
    detail = { error: "cell 未渲染" };
  }
}

console.log(JSON.stringify({
  picked: pick.name,
  tags: pick.tags,
  before: { items: before.items, originals: before.originals, disk: before.disk },
  after: { items: after.items, originals: after.originals, disk: after.disk },
  originalsHasIt,
  detail,
}, null, 2));

await browser.close();
