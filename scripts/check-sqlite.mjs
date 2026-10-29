import { chromium } from "playwright";

/* SQLite 影子库验收：同步后核对条数、可见数、标签数，并读回样本 */

const browser = await chromium.connectOverCDP(process.env.CDP_URL ?? "http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find((p) => p.url().includes("localhost:5173"));
await page.waitForSelector(".cell");

const idb = () => page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open("ceas"); q.onsuccess = () => r(q.result); });
  const c = (s) => new Promise((r) => { const t = db.transaction(s, "readonly"); const q = t.objectStore(s).count(); q.onsuccess = () => r(q.result); });
  return { items: await c("items"), originals: await c("originals") };
});

const before = await idb();

await page.getByRole("button", { name: "设置" }).click();
await page.waitForSelector(".settings");
await page.getByRole("button", { name: "同步元数据到 SQLite" }).click();
await page.waitForFunction(() => document.body.innerText.includes("已同步"), null, { timeout: 90000 });
await page.waitForTimeout(600);

const shown = await page.evaluate(() => {
  const vals = Array.from(document.querySelectorAll(".settings-value")).map((e) => e.textContent);
  const sample = Array.from(document.querySelectorAll(".settings-path")).map((e) => e.textContent);
  return { sqlite: vals.find((v) => v?.startsWith("SQLite：")) ?? null, sample: sample.slice(-1)[0] ?? null };
});

const raw = await page.evaluate(async () => {
  const api = window.__TAURI_INTERNALS__;
  const stats = await api.invoke("store_stats");
  const list = await api.invoke("store_list", { limit: 3 });
  return { stats, list: list.map((r) => ({ name: r.name, w: r.w, h: r.h, kind: r.kind })) };
});

await page.screenshot({ path: ".cache/shots/230-sqlite.png" });
await page.keyboard.press("Escape");
const after = await idb();

console.log(JSON.stringify({ before, after, shown, raw }, null, 2));
await browser.close();
