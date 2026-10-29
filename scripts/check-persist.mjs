import { chromium } from "playwright";

/* 持久化走查：画布坐标切视图/刷新不丢，界面偏好也能记住 */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".cell");
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".cell");

/* 切到画布，拖一个素材 */
await page.keyboard.press("Alt+2");
await page.waitForSelector(".cv-item");
await page.waitForTimeout(500);
await page.getByRole("button", { name: "适配" }).click();
await page.waitForTimeout(400);

const pick = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".cv-item"));
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    if (r.width > 40 && r.x > 320 && r.x + r.width < 1400 && r.y > 120 && r.y + r.height < 860) {
      return { index: i, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), left: items[i].style.left, top: items[i].style.top };
    }
  }
  return null;
});

let moved = null;
if (pick) {
  await page.mouse.move(pick.x, pick.y);
  await page.mouse.down();
  await page.mouse.move(pick.x - 120, pick.y - 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  moved = await page.locator(".cv-item").nth(pick.index).evaluate((el) => ({ left: el.style.left, top: el.style.top }));
}

/* 切到网格再切回来 */
await page.keyboard.press("Alt+1");
await page.waitForTimeout(400);
await page.keyboard.press("Alt+2");
await page.waitForSelector(".cv-item");
await page.waitForTimeout(500);
const afterSwitch = pick ? await page.locator(".cv-item").nth(pick.index).evaluate((el) => ({ left: el.style.left, top: el.style.top })) : null;

/* 刷新 */
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(900);
const viewAfterReload = await page.evaluate(() => ({
  hasCanvas: !!document.querySelector(".cv"),
  density: document.documentElement.dataset.density,
}));
const afterReload = pick ? await page.locator(".cv-item").nth(pick.index).evaluate((el) => ({ left: el.style.left, top: el.style.top })).catch(() => null) : null;

/* 重排 */
let afterReset = null;
let afterResetReload = null;
if (pick) {
  await page.getByRole("button", { name: "重排" }).click();
  await page.waitForTimeout(500);
  afterReset = await page.locator(".cv-item").nth(pick.index).evaluate((el) => ({ left: el.style.left, top: el.style.top }));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  afterResetReload = await page.locator(".cv-item").nth(pick.index).evaluate((el) => ({ left: el.style.left, top: el.style.top })).catch(() => null);
}

console.log(JSON.stringify({ pick: pick && { left: pick.left, top: pick.top }, moved, afterSwitch, viewAfterReload, afterReload, afterReset, afterResetReload, errors }, null, 2));
await browser.close();
