import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 通过 CDP 接管 Tauri 的原生窗口（WebView2），跑一次真实导入，
   验证「原图按内容寻址落盘」在桌面端真的成立。 */

const CDP = process.env.CDP_URL ?? "http://127.0.0.1:9222";
const OUT = ".cache/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes("localhost:5173")) ?? ctx.pages()[0];
if (!page) throw new Error("没找到 Tauri 窗口里的页面");

console.log("page:", page.url());
await page.waitForSelector(".cell, .empty", { timeout: 20000 });

const before = await page.evaluate(() => ({
  desktop: "__TAURI_INTERNALS__" in window,
  cells: document.querySelectorAll(".cell").length,
}));

/* 用与浏览器版相同的入口触发导入 */
await page.getByRole("button", { name: "导入素材" }).click();
await page.waitForSelector(".import-bar", { timeout: 15000 });
await page.waitForFunction(
  () => document.querySelector(".import-label")?.textContent?.includes("导入完成"),
  null,
  { timeout: 120000 },
);
await page.waitForTimeout(1200);

const bar = await page.locator(".import-row").textContent();
const after = await page.evaluate(() => ({
  cells: document.querySelectorAll(".cell").length,
}));
await page.screenshot({ path: `${OUT}/200-desktop-import.png` });

/* 打开设置，读「已落盘」 */
await page.getByRole("button", { name: "设置" }).click();
await page.waitForSelector(".settings");
await page.waitForTimeout(600);
const gen = {
  path: await page.locator(".settings-path").textContent(),
  values: await page.locator(".settings-value").allTextContents(),
};
await page.screenshot({ path: `${OUT}/201-desktop-settings.png` });

console.log(JSON.stringify({ before, bar: bar?.replace(/\s+/g, " ").trim(), after, gen }, null, 2));
await browser.close();
