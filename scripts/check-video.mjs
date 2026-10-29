import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 视频验收：导入含视频的素材目录 → 角标时长 → 双击出播放器 → 进度条推进/拖拽 */

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
await page.waitForSelector(".cell");

await page.getByRole("button", { name: "导入素材" }).click();
await page.waitForFunction(() => document.querySelector(".import-label")?.textContent?.includes("导入完成"), null, { timeout: 90000 });
const bar = await page.locator(".import-row").textContent();
await page.waitForTimeout(900);

/* 库里应当有一条视频 */
const db = await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open("ceas");
  req.onsuccess = () => {
    const t = req.result.transaction("items", "readonly");
    const all = t.objectStore("items").getAll();
    all.onsuccess = () => {
      const rows = all.result;
      res({
        total: rows.length,
        videos: rows.filter((r) => r.kind === "video").map((r) => ({ w: r.w, h: r.h, duration: r.duration, thumb: r.thumb?.type, bytes: r.bytes })),
      });
    };
  };
}));

/* 视频卡片 */
const videoCell = page.locator('.cell[aria-label*="视频"]').first();
const hasVideoCell = (await videoCell.count()) > 0;
const badge = hasVideoCell ? await videoCell.locator(".badge").first().textContent() : null;
await page.screenshot({ path: `${OUT}/140-video-grid.png` });

let player = null;
let advanced = null;
let seeked = null;
let timeText = null;
if (hasVideoCell) {
  await videoCell.dblclick();
  await page.waitForSelector(".player", { timeout: 8000 });
  await page.waitForTimeout(800);

  const before = await page.locator(".player-time").textContent();
  await page.locator(".player-toggle").click();
  await page.waitForTimeout(1600);
  const after = await page.locator(".player-time").textContent();
  advanced = before !== after;

  /* 拖到 70% */
  const track = await page.locator(".player-track").boundingBox();
  if (track) {
    await page.mouse.click(track.x + track.width * 0.7, track.y + track.height / 2);
    await page.waitForTimeout(500);
  }
  timeText = await page.locator(".player-time").textContent();
  const fill = await page.locator(".player-fill").evaluate((el) => el.style.width);
  player = { timeText, fill };
  await page.screenshot({ path: `${OUT}/141-video-player.png` });
  seeked = fill;
}

console.log(JSON.stringify({ bar: bar?.replace(/\s+/g, " ").trim(), db, hasVideoCell, badge, advanced, player, errors }, null, 2));
await browser.close();
