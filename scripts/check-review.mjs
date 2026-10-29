import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 审查项验收：导入完成可关闭、批量删除、空态 */

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

/* 导入 */
await page.getByRole("button", { name: "导入素材" }).click();
await page.waitForFunction(() => document.querySelector(".import-label")?.textContent?.includes("导入完成"), null, { timeout: 60000 });
const closeBtn = await page.getByRole("button", { name: "关闭" }).count();
await page.getByRole("button", { name: "关闭" }).click();
await page.waitForTimeout(1000);
const barGone = (await page.locator(".import-bar").count()) === 0;

/* 多选 → 批量条 */
const cells = page.locator(".cell");
await cells.nth(0).click();
await cells.nth(2).click({ modifiers: ["Control"] });
await page.waitForTimeout(400);
const batchVisible = (await page.locator(".batch-bar").count()) === 1;
const before = await cells.count();
await page.screenshot({ path: `${OUT}/100-batch.png` });

await page.getByRole("button", { name: "删除" }).click();
await page.waitForTimeout(900);
const after = await page.locator(".cell").count();
const batchGone = (await page.locator(".batch-bar").count()) === 0;
const dbAfter = await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open("ceas");
  req.onsuccess = () => {
    const t = req.result.transaction("items", "readonly");
    const c = t.objectStore("items").count();
    c.onsuccess = () => res(c.result);
  };
}));

/* 清空库 → 空态 */
await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open("ceas");
  req.onsuccess = () => {
    const db = req.result;
    const t = db.transaction(["items", "originals"], "readwrite");
    t.objectStore("items").clear();
    t.objectStore("originals").clear();
    t.oncomplete = () => res(null);
  };
}));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const empty = await page.evaluate(() => ({
  hasEmpty: !!document.querySelector(".empty"),
  hasMascot: !!document.querySelector(".empty svg"),
  title: document.querySelector(".empty-title")?.textContent ?? null,
}));
await page.screenshot({ path: `${OUT}/101-empty.png` });

console.log(JSON.stringify({ closeBtn, barGone, batchVisible, batchGone, before, after, dbAfter, deleted: before - after, empty, errors }, null, 2));
await browser.close();
