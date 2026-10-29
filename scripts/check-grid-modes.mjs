import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 双排布验收：胶囊存在、切换生效、切换瞬间有 morph、两种模式几何不同 */

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
await page.waitForTimeout(600);

const capsule = await page.locator(".mode-capsule").count();

/* 标准模式的几何：同一行的高度一致 */
const standard = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".cell")).slice(0, 8).map((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }),
);
await page.screenshot({ path: `${OUT}/130-grid-standard.png` });

/* 切换 → 立刻抓 morph 标记 */
await page.getByRole("radio", { name: "瀑布" }).click();
const morphSeen = (await page.locator(".grid[data-morph]").count()) === 1;
await page.waitForTimeout(700);

const masonry = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".cell")).slice(0, 8).map((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }),
);
const gridHeight = await page.locator(".grid").evaluate((el) => Math.round(el.getBoundingClientRect().height));
const checked = await page.getByRole("radio", { name: "瀑布" }).getAttribute("aria-checked");
await page.screenshot({ path: `${OUT}/131-grid-masonry.png` });

/* 切回 */
await page.getByRole("radio", { name: "对齐" }).click();
await page.waitForTimeout(700);
const backTo = await page.getByRole("radio", { name: "对齐" }).getAttribute("aria-checked");

/* 瀑布流特征：列宽恒定（就是列数），高度按比例各不相同；
   对齐模式相反：行高恒定，宽度各不相同。
   先前用「同一行 y 是否一致」判断是错的 —— 瀑布流前 N 张本来就都从 y=0 开始。 */
const standardWidthVariety = new Set(standard.map((c) => c.w)).size;
const standardHeightVariety = new Set(standard.map((c) => c.h)).size;
const masonryWidthVariety = new Set(masonry.map((c) => c.w)).size;
const masonryHeightVariety = new Set(masonry.map((c) => c.h)).size;

console.log(JSON.stringify({
  capsule,
  morphSeen,
  standard: { widths: standardWidthVariety, heights: standardHeightVariety },
  masonry: { widths: masonryWidthVariety, heights: masonryHeightVariety },
  gridHeight,
  checked,
  backTo,
  errors,
}, null, 2));

await browser.close();
