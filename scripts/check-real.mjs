import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 真实素材走查：图片是否真的解码、布局是否按真实比例、四屏截图 */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const OUT = ".cache/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const failed = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText ?? ""}`));
page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".thumb-img", { timeout: 10000 });
await page.waitForTimeout(600);

const stats = await page.evaluate(() => {
  const imgs = Array.from(document.querySelectorAll(".thumb-img"));
  const loaded = imgs.filter((i) => i.complete && i.naturalWidth > 0);
  const ratios = imgs.slice(0, 6).map((i) => {
    const cell = i.parentElement?.parentElement;
    const r = cell?.getBoundingClientRect();
    return {
      natural: Number((i.naturalWidth / i.naturalHeight).toFixed(2)),
      box: r ? Number((r.width / r.height).toFixed(2)) : null,
    };
  });
  return { total: imgs.length, loaded: loaded.length, ratios };
});

await page.screenshot({ path: `${OUT}/30-real-grid.png` });

/* 详情 */
const first = page.locator(".cell").first();
await first.dblclick();
await page.waitForTimeout(1200);
const detail = await page.evaluate(() => {
  const img = document.querySelector(".overlay-img");
  const m = document.querySelector(".overlay-media");
  if (!img || !m) return null;
  const r = m.getBoundingClientRect();
  return {
    loaded: img.complete && img.naturalWidth > 0,
    natural: [img.naturalWidth, img.naturalHeight],
    rendered: [Math.round(r.width), Math.round(r.height)],
    ratio: Number((r.width / r.height).toFixed(3)),
    naturalRatio: Number((img.naturalWidth / img.naturalHeight).toFixed(3)),
  };
});
await page.screenshot({ path: `${OUT}/31-real-detail.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

/* 画布 */
await page.keyboard.press("Alt+2");
await page.waitForSelector(".cv-img");
await page.waitForTimeout(800);
const canvas = await page.evaluate(() => {
  const imgs = Array.from(document.querySelectorAll(".cv-img"));
  return { total: imgs.length, loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length };
});
await page.screenshot({ path: `${OUT}/32-real-canvas.png` });

/* 过片 */
await page.keyboard.press("Alt+1");
await page.waitForTimeout(300);
await page.getByRole("button", { name: /收件箱/ }).first().click();
await page.waitForSelector(".triage");
await page.waitForTimeout(600);
const triage = await page.evaluate(() => {
  const img = document.querySelector(".triage-img");
  return img ? { loaded: img.complete && img.naturalWidth > 0, natural: [img.naturalWidth, img.naturalHeight] } : null;
});
await page.screenshot({ path: `${OUT}/33-real-triage.png` });

console.log(JSON.stringify({ grid: stats, detail, canvas, triage, failed: failed.slice(0, 5), errors: errors.slice(0, 5) }, null, 2));
await browser.close();
