import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 1) 顶部小胶囊的图标是否来自 akar（形状/尺寸）
   2) 详情浮层点空白是否关闭
   3) 点图片本身是否不关闭 */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const OUT = ".cache/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".cell");
await page.waitForTimeout(500);

const icons = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll(".mini-capsule .icon-btn"));
  return btns.map((b) => {
    const svg = b.querySelector("svg");
    const r = svg?.getBoundingClientRect();
    return { hasSvg: !!svg, paths: svg?.querySelectorAll("path, circle, rect, line").length ?? 0, size: r ? [Math.round(r.width), Math.round(r.height)] : null };
  });
});
await page.locator(".topbar").screenshot({ path: `${OUT}/40-topbar.png` });

/* 打开详情 */
await page.locator(".cell").first().dblclick();
await page.waitForTimeout(900);
const opened = (await page.locator(".overlay").count()) === 1;

/* 点图片本身不应关闭 */
const media = await page.locator(".overlay-media").boundingBox();
if (media) {
  await page.mouse.click(media.x + media.width / 2, media.y + media.height / 2);
  await page.waitForTimeout(400);
}
const stillOpenAfterImageClick = (await page.locator(".overlay").count()) === 1;

/* 点空白（舞台左上角留白）应关闭 */
await page.mouse.click(60, 780);
await page.waitForTimeout(500);
const closedByBlank = (await page.locator(".overlay").count()) === 0;

console.log(JSON.stringify({ icons, opened, stillOpenAfterImageClick, closedByBlank, errors }, null, 2));
await browser.close();
