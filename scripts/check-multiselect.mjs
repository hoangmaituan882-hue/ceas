import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 多选验收：Shift 连选、Ctrl 加减、拖拽框选、框选后不被 click 清空 */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const OUT = ".cache/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
page.on("pageerror", (e) => errors.push("ERR " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".cell");
await page.waitForTimeout(500);

const count = () => page.locator(".cell[data-selected]").count();

/* 1) Shift 连选：点第 1 张 → Shift 点第 5 张 → 应为 5 张 */
await page.locator(".cell").nth(0).click();
await page.locator(".cell").nth(4).click({ modifiers: ["Shift"] });
await page.waitForTimeout(300);
const shiftRange = await count();

/* 2) Ctrl 点第 8 张 → 6 张；再 Ctrl 点一次 → 5 张 */
await page.locator(".cell").nth(7).click({ modifiers: ["Control"] });
await page.waitForTimeout(200);
const ctrlAdd = await count();
await page.locator(".cell").nth(7).click({ modifiers: ["Control"] });
await page.waitForTimeout(200);
const ctrlRemove = await count();

/* 3) 拖拽框选：从空白处拖过前两行 */
const empty = await page.evaluate(() => {
  const grid = document.querySelector(".grid");
  if (!grid) return null;
  const r = grid.getBoundingClientRect();
  // 网格顶部左侧的留白（第一张之前）
  for (let y = Math.round(r.top) + 4; y < r.top + 200; y += 8) {
    for (let x = Math.round(r.left); x < r.left + 40; x += 8) {
      if (document.elementFromPoint(x, y) === grid) return { x, y };
    }
  }
  return null;
});

let marqueeCount = 0;
let keptAfterDrag = 0;
if (empty) {
  const gridBox = await page.locator(".grid").boundingBox();
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await page.mouse.move(empty.x + 520, empty.y + 260, { steps: 12 });
  const bandVisible = (await page.locator(".marquee").count()) === 1;
  await page.mouse.up();
  await page.waitForTimeout(400);
  marqueeCount = await count();
  keptAfterDrag = bandVisible ? marqueeCount : -1;
  await page.screenshot({ path: `${OUT}/120-marquee.png` });
  void gridBox;
}

console.log(JSON.stringify({ shiftRange, ctrlAdd, ctrlRemove, emptyPoint: empty, marqueeCount, keptAfterDrag, errors }, null, 2));
await browser.close();
