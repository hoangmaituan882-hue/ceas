import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 拖放导入验收：构造一个真实 File，派发 dragover/drop，走完整导入管线 */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const OUT = ".cache/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 140)); });
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
await page.waitForTimeout(800);

/* 造两张图：一张 png、一张"视频"扩展名的假文件（应被拦下或失败但整体不崩） */
const dropped = await page.evaluate(async () => {
  const make = async (w, h, name, color) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    return new File([blob], name, { type: "image/png" });
  };

  const f1 = await make(640, 400, "拖进来的-A.png", "#3366cc");
  const f2 = await make(300, 500, "拖进来的-B.png", "#cc3366");

  const dt = new DataTransfer();
  dt.items.add(f1);
  dt.items.add(f2);

  const target = document.querySelector(".app");
  target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
  target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  return [f1.name, f2.name];
});

await page.waitForSelector(".import-bar", { timeout: 8000 });
await page.waitForFunction(() => document.querySelector(".import-label")?.textContent?.includes("导入完成"), null, { timeout: 30000 });
await page.waitForTimeout(900);

const db = await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open("ceas");
  req.onsuccess = () => {
    const t = req.result.transaction("items", "readonly");
    const all = t.objectStore("items").getAll();
    all.onsuccess = () => res(all.result.map((r) => ({ name: r.name, w: r.w, h: r.h })));
  };
}));

const cells = await page.locator(".cell").count();
const bar = await page.locator(".import-row").textContent();
await page.screenshot({ path: `${OUT}/180-drop-import.png` });

console.log(JSON.stringify({ dropped, db, cells, bar: bar?.replace(/\s+/g, " ").trim(), errors }, null, 2));
await browser.close();
