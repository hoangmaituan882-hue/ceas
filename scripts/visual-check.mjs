import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 真实浏览器走查：滚轮、浮层尺寸、控制台错误。
   用法：node scripts/visual-check.mjs */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const OUT = ".cache/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".cell", { timeout: 10000 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/01-grid.png` });

/* ── 滚轮 ───────────────────────────────────────────── */
const scroller = page.locator(".grid-scroll");
const before = await scroller.evaluate((el) => el.scrollTop);
await page.mouse.move(760, 520);
await page.mouse.wheel(0, 1500);
await page.waitForTimeout(400);
const after = await scroller.evaluate((el) => el.scrollTop);
const hud = await page.locator(".perf-hud").textContent().catch(() => null);
await page.screenshot({ path: `${OUT}/02-scrolled.png` });

/* ── 详情浮层（双击）────────────────────────────────── */
const cell = page.locator(".cell").nth(3);
await cell.dblclick();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/03-overlay.png` });

const media = await page.locator(".overlay-media").boundingBox();
const panel = await page.locator(".overlay-panel").boundingBox();
const title = await page.locator(".overlay-panel h2").textContent();
const selectedCount = await page.locator(".cell[data-selected]").count();

/* ── 关闭后回到网格 ─────────────────────────────────── */
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/04-closed.png` });
const overlayGone = (await page.locator(".overlay").count()) === 0;

/* ── Space 打开（空格是比双击更快的路径）──────────── */
await page.locator(".cell").nth(2).click();
await page.keyboard.press(" ");
await page.waitForTimeout(700);
const spaceOpened = (await page.locator(".overlay").count()) === 1;
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

console.log(
  JSON.stringify(
    {
      wheel: { before, after, moved: after - before },
      hud,
      overlay: {
        media: media && { w: Math.round(media.width), h: Math.round(media.height) },
        panel: panel && { w: Math.round(panel.width), h: Math.round(panel.height) },
        title,
        ratio: media ? Number((media.width / media.height).toFixed(2)) : null,
      },
      selectedCount,
      overlayGone,
      errors,
    },
    null,
    2,
  ),
);

await browser.close();
