import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 画布走查：缩放、平移、拖动素材、双击打开。
   关键：平移要拖「空白处」，拖动要拖「视口内可见的那一个」，
   否则测出来的失败是测试的错，不是代码的错。 */

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
await page.keyboard.press("Alt+2");
await page.waitForSelector(".cv-item");
await page.waitForTimeout(400);
await page.locator(".cv-fit").click();
await page.waitForTimeout(400);

const world = () => page.locator(".cv-world").evaluate((el) => getComputedStyle(el).transform);
const zoom = () => page.locator(".cv-zoom").textContent();

const t0 = await world();
const z0 = await zoom();
const itemCount = await page.locator(".cv-item").count();
await page.screenshot({ path: `${OUT}/20-canvas.png` });

/* ── 缩放 ─────────────────────────────────────────── */
await page.mouse.move(720, 450);
await page.mouse.wheel(0, -500);
await page.waitForTimeout(350);
const t1 = await world();
const z1 = await zoom();

/* ── 找一块真正的空白，用来平移 ────────────────────── */
const empty = await page.evaluate(() => {
  const host = document.querySelector(".cv");
  if (!host) return null;
  for (let y = 120; y < 820; y += 40) {
    for (let x = 320; x < 1360; x += 40) {
      if (document.elementFromPoint(x, y) === host) return { x, y };
    }
  }
  return null;
});

let panMoved = false;
if (empty) {
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await page.mouse.move(empty.x + 90, empty.y + 50, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  panMoved = (await world()) !== t1;
}

/* ── 找一个视口内、完整可见的素材 ──────────────────── */
const pick = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".cv-item"));
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    if (r.width > 40 && r.x > 320 && r.x + r.width < 1400 && r.y > 120 && r.y + r.height < 860) {
      return { index: i, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }
  }
  return null;
});

let itemMoved = false;
if (pick) {
  const target = page.locator(".cv-item").nth(pick.index);
  const before = await target.evaluate((el) => el.style.left);
  await page.mouse.move(pick.x, pick.y);
  await page.mouse.down();
  await page.mouse.move(pick.x + 70, pick.y + 40, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  itemMoved = (await target.evaluate((el) => el.style.left)) !== before;
}

/* ── 双击打开详情 ─────────────────────────────────── */
let detailOpen = false;
if (pick) {
  await page.mouse.dblclick(pick.x + 70, pick.y + 40);
  await page.waitForTimeout(900);
  detailOpen = (await page.locator(".overlay").count()) === 1;
  await page.screenshot({ path: `${OUT}/22-canvas-detail.png` });
}

await page.screenshot({ path: `${OUT}/21-canvas-moved.png` });

console.log(JSON.stringify({
  itemCount,
  zoom: { before: z0, after: z1, changed: z0 !== z1 },
  worldChangedOnZoom: t0 !== t1,
  emptyPoint: empty,
  panMoved,
  pickedItem: pick && pick.index,
  itemMoved,
  detailOpen,
  errors,
}, null, 2));

await browser.close();
