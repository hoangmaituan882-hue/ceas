import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 导入流水线：进度、去重、入库、节点数 */

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
    const req = indexedDB.deleteDatabase("ceas");
    req.onsuccess = req.onerror = req.onblocked = () => res(null);
  });
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".cell");

const before = await page.locator(".cell").count();

/* 第一次导入 */
const t0 = Date.now();
await page.getByRole("button", { name: "导入素材" }).click();
await page.waitForSelector(".import-bar", { timeout: 8000 });
await page.waitForFunction(() => document.querySelector(".import-label")?.textContent?.includes("导入完成"), null, { timeout: 60000 });
const firstMs = Date.now() - t0;
const bar1 = await page.locator(".import-row").textContent();
await page.screenshot({ path: `${OUT}/80-import-done.png` });
await page.waitForTimeout(600);
const after = await page.locator(".cell").count();

/* 第二次导入：应当全部重复 */
await page.getByRole("button", { name: "导入素材" }).click();
await page.waitForFunction(() => {
  const t = document.querySelector(".import-row")?.textContent ?? "";
  return t.includes("导入完成");
}, null, { timeout: 60000 });
await page.waitForTimeout(300);
const bar2 = await page.locator(".import-row").textContent();
const after2 = await page.locator(".cell").count();

const dbCount = await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open("ceas");
  req.onsuccess = () => {
    const db = req.result;
    const t = db.transaction("items", "readonly");
    const c = t.objectStore("items").count();
    c.onsuccess = () => res(c.result);
    c.onerror = () => res(-1);
  };
  req.onerror = () => res(-1);
}));

console.log(JSON.stringify({ before, firstMs, bar1: bar1?.replace(/\s+/g, " ").trim(), after, bar2: bar2?.replace(/\s+/g, " ").trim(), after2, dbCount, errors }, null, 2));
await browser.close();
