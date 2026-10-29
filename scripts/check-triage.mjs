import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 过片流程走查：归档、撤销、标签、退出 */

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

const count = async () => Number((await page.locator(".triage-remaining").textContent())?.match(/还剩 (\d+)/)?.[1] ?? -1);

/* 进入过片 */
await page.getByRole("button", { name: /收件箱/ }).first().click();
await page.waitForSelector(".triage");
await page.waitForTimeout(300);
const start = await count();
await page.screenshot({ path: `${OUT}/10-triage.png` });

/* 归档：按 1 */
await page.keyboard.press("1");
await page.waitForTimeout(400);
const afterArchive = await count();
const toast1 = await page.locator(".toast").first().textContent().catch(() => null);
await page.screenshot({ path: `${OUT}/11-triage-archived.png` });

/* 撤销 */
await page.keyboard.press("Control+z");
await page.waitForTimeout(400);
const afterUndo = await count();

/* 标签 */
await page.keyboard.press("t");
await page.waitForTimeout(200);
const inputFocused = await page.evaluate(() => document.activeElement?.tagName === "INPUT");
await page.keyboard.type("测试标签");
await page.keyboard.press("Enter");
await page.waitForTimeout(700);
const toast2 = await page.locator(".toast").last().textContent().catch(() => null);
const stillOpen = (await page.locator(".triage").count()) === 1;

/* 丢弃 */
await page.keyboard.press("Delete");
await page.waitForTimeout(400);
const afterDiscard = await count();

/* 退出 */
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
const closed = (await page.locator(".triage").count()) === 0;

console.log(JSON.stringify({ start, afterArchive, toast1, afterUndo, inputFocused, toast2, stillOpen, afterDiscard, closed, errors }, null, 2));
await browser.close();
