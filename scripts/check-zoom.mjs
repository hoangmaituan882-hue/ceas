import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 缩放滑杆验收：拖动改变缩略图尺寸、读数跟随、刷新后保留 */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const OUT = ".cache/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 140)); });
page.on("pageerror", (e) => errors.push("ERR " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".cell");
await page.waitForTimeout(500);

const avgWidth = async () =>
  page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll(".cell")).slice(0, 10);
    if (cells.length === 0) return 0;
    return Math.round(cells.reduce((s, el) => s + el.getBoundingClientRect().width, 0) / cells.length);
  });

const gridHeight = async () =>
  page.locator(".grid").evaluate((el) => Math.round(el.getBoundingClientRect().height));

const before = { value: await page.locator(".zoom-value").textContent(), width: await avgWidth(), height: await gridHeight() };

/* 拖到最大：React 受控 input 必须用原生 setter，
   直接赋 el.value 不会触发 onChange（React 会忽略） */
const range = page.locator(".zoom-range");
await range.evaluate((el) => {
  const input = el;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, input.max);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(600);
const max = { value: await page.locator(".zoom-value").textContent(), width: await avgWidth(), height: await gridHeight() };
await page.screenshot({ path: `${OUT}/150-zoom-max.png` });

/* 点两次缩小按钮（每次之间等一下，避免连点被批处理） */
await page.locator(".zoom-step").first().click();
await page.waitForTimeout(350);
await page.locator(".zoom-step").first().click();
await page.waitForTimeout(600);
const smaller = {
  value: await page.locator(".zoom-value").textContent(),
  width: await avgWidth(),
  height: await gridHeight(),
};

/* 刷新后是否保留 */
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".cell");
await page.waitForTimeout(700);
const afterReload = { value: await page.locator(".zoom-value").textContent(), width: await avgWidth() };

console.log(JSON.stringify({ before, max, smaller, afterReload, errors }, null, 2));
await browser.close();
