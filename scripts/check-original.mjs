import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 原图链路：导入后 originals 有记录、详情取原图而不是缩略图 */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const OUT = ".cache/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
page.on("pageerror", (e) => errors.push("ERR " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  localStorage.clear();
  await new Promise((res) => {
    const r = indexedDB.deleteDatabase("ceas");
    r.onsuccess = r.onerror = r.onblocked = () => res(null);
  });
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".cell");

await page.getByRole("button", { name: "导入素材" }).click();
await page.waitForFunction(() => document.querySelector(".import-label")?.textContent?.includes("导入完成"), null, { timeout: 60000 });
await page.waitForTimeout(800);

const db = await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open("ceas");
  req.onsuccess = () => {
    const db = req.result;
    const t = db.transaction(["items", "originals"], "readonly");
    const items = t.objectStore("items");
    const orig = t.objectStore("originals");
    const out = { items: 0, originals: 0, thumbBytes: 0, origBytes: 0, first: null };
    const c1 = items.count();
    c1.onsuccess = () => { out.items = c1.result; };
    const c2 = orig.count();
    c2.onsuccess = () => { out.originals = c2.result; };
    const cur1 = items.openCursor();
    cur1.onsuccess = () => {
      const cur = cur1.result;
      if (cur) {
        const v = cur.value;
        out.thumbBytes += v.thumb?.size ?? 0;
        if (!out.first) out.first = { id: v.id, w: v.w, h: v.h };
        cur.continue();
      }
    };
    const cur2 = orig.openCursor();
    cur2.onsuccess = () => {
      const cur = cur2.result;
      if (cur) {
        out.origBytes += cur.value.blob?.size ?? 0;
        cur.continue();
      } else {
        setTimeout(() => res(out), 50);
      }
    };
  };
  req.onerror = () => res(null);
}));

/* 打开详情，看 img 用的是哪个地址 */
const cell = page.locator(".cell").first();
await cell.dblclick();
await page.waitForTimeout(1200);
const img = await page.evaluate(() => {
  const el = document.querySelector(".overlay-img");
  if (!el) return null;
  return { src: el.src.slice(0, 24), natural: [el.naturalWidth, el.naturalHeight] };
});
await page.screenshot({ path: `${OUT}/90-original.png` });

console.log(JSON.stringify({ db, img, errors }, null, 2));
await browser.close();
