import { chromium } from "playwright";

/* 光标语义检查：网格放大镜、画布抓手、拖动中抓住、详情空白缩小镜 */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".cell");
await page.waitForTimeout(400);

const cursorAt = (x, y) =>
  page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    return el ? getComputedStyle(el).cursor : null;
  }, [x, y]);

/* 网格 */
const cellBox = await page.locator(".cell").first().boundingBox();
const grid = cellBox ? await cursorAt(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2) : null;

/* 详情 */
await page.locator(".cell").first().dblclick();
await page.waitForTimeout(900);
const overlayBlank = await cursorAt(40, 820);
const overlayMedia = await page.evaluate(() => {
  const m = document.querySelector(".overlay-media");
  return m ? getComputedStyle(m).cursor : null;
});
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

/* 画布 */
await page.keyboard.press("Alt+2");
await page.waitForSelector(".cv-item");
await page.waitForTimeout(600);
const itemBox = await page.locator(".cv-item").nth(3).boundingBox();
let canvasIdle = null;
let canvasDragging = null;
let canvasAfter = null;
let emptyCursor = null;
if (itemBox) {
  const cx = itemBox.x + Math.min(itemBox.width / 2, 30);
  const cy = itemBox.y + Math.min(itemBox.height / 2, 30);
  await page.mouse.move(cx, cy);
  canvasIdle = await cursorAt(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 30, { steps: 6 });
  canvasDragging = await cursorAt(cx + 40, cy + 30);
  await page.mouse.up();
  await page.waitForTimeout(200);
  canvasAfter = await cursorAt(cx + 40, cy + 30);
}
const empty = await page.evaluate(() => {
  const host = document.querySelector(".cv");
  for (let y = 140; y < 800; y += 40) {
    for (let x = 320; x < 1400; x += 40) {
      if (document.elementFromPoint(x, y) === host) return { x, y };
    }
  }
  return null;
});
if (empty) emptyCursor = await cursorAt(empty.x, empty.y);

console.log(JSON.stringify({ grid, overlayBlank, overlayMedia, canvasIdle, canvasDragging, canvasAfter, emptyCursor, errors }, null, 2));
await browser.close();
