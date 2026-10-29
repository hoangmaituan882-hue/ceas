import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 设置面板验收：侧栏入口、通用页、资料库位置、桌面专属按钮在浏览器下禁用 */

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

const sidebar = {
  sections: await page.locator(".rail-section span").allTextContents(),
  items: await page.locator(".rail-item").count(),
};
await page.screenshot({ path: `${OUT}/190-sidebar.png` });

/* 打开设置 */
await page.getByRole("button", { name: "设置" }).click();
await page.waitForSelector(".settings");
await page.waitForTimeout(300);

const gen = {
  title: await page.locator(".settings-head h2").textContent(),
  path: await page.locator(".settings-path").textContent(),
  buttons: await page.locator(".settings-btn").allTextContents(),
  disabled: await page.locator(".settings-btn").evaluateAll((els) => els.map((e) => e.disabled)),
  note: await page.locator(".settings-note").textContent(),
};
await page.screenshot({ path: `${OUT}/191-settings.png` });

/* 切到关于 */
await page.getByRole("button", { name: "关于" }).click();
await page.waitForTimeout(250);
const about = {
  title: await page.locator(".settings-head h2").textContent(),
  values: await page.locator(".settings-value").allTextContents(),
};
await page.screenshot({ path: `${OUT}/192-settings-about.png` });

/* Esc 关闭 */
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const closed = (await page.locator(".settings").count()) === 0;

console.log(JSON.stringify({ sidebar, gen, about, closed, errors }, null, 2));
await browser.close();
