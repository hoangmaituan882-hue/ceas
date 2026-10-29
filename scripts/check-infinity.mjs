import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 无限视图：渲染数量、滚轮漂移、惯性、双击打开、视口记忆 */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const OUT = ".cache/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
page.on("pageerror", (e) => errors.push("ERR " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".cell");

await page.keyboard.press("Alt+3");
await page.waitForSelector(".inf-item", { timeout: 8000 });
await page.waitForTimeout(600);
const count = await page.locator(".inf-item").count();
const pos0 = await page.locator(".inf-pos").textContent();
await page.screenshot({ path: `${OUT}/70-infinity.png` });

/* 滚轮漂移 */
await page.mouse.move(720, 450);
await page.mouse.wheel(0, 400);
await page.waitForTimeout(120);
const pos1 = await page.locator(".inf-pos").textContent();
await page.waitForTimeout(700);
const pos2 = await page.locator(".inf-pos").textContent();
const inertiaMoved = pos1 !== pos2;
await page.waitForTimeout(900);
const pos3 = await page.locator(".inf-pos").textContent();
const settled = pos2 === pos3;

/* 双击打开：必须挑一个真正在视口内的 */
const target = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll(".inf-item"));
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (r.width > 40 && r.x > 300 && r.x + r.width < 1420 && r.y > 120 && r.y + r.height < 860) {
      return { i, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }
  }
  return null;
});
let detailOpen = false;
if (target) {
  await page.mouse.dblclick(target.x, target.y);
  await page.waitForTimeout(900);
  detailOpen = (await page.locator(".overlay").count()) === 1;
  await page.screenshot({ path: `${OUT}/71-infinity-detail.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

/* 视口记忆：刷新后应停在原处 */
const beforeReload = await page.locator(".inf-pos").textContent();
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".inf-item", { timeout: 8000 });
await page.waitForTimeout(800);
const afterReload = await page.locator(".inf-pos").textContent();

console.log(JSON.stringify({ count, pos0, pos1, pos2, inertiaMoved, settled, detailOpen, beforeReload, afterReload, restored: beforeReload === afterReload, errors }, null, 2));
await browser.close();
