import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 过片新排版：胶片条数量、点击跳转、当前项高亮、角标、截图 */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const OUT = ".cache/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 120)); });
page.on("pageerror", (e) => errors.push("ERR " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".cell");
await page.getByRole("button", { name: /收件箱/ }).first().click();
await page.waitForSelector(".triage");
await page.waitForTimeout(700);

const info = await page.evaluate(() => {
  const strip = document.querySelector(".triage-strip");
  const thumbs = Array.from(document.querySelectorAll(".triage-thumb"));
  const active = document.querySelector(".triage-thumb[data-active]");
  const media = document.querySelector(".triage-media");
  const caption = document.querySelector(".triage-caption");
  const mr = media?.getBoundingClientRect();
  return {
    thumbs: thumbs.length,
    activeIndex: active?.getAttribute("data-idx") ?? null,
    activeSize: active ? [Math.round(active.getBoundingClientRect().width), Math.round(active.getBoundingClientRect().height)] : null,
    idleSize: thumbs[1] ? [Math.round(thumbs[1].getBoundingClientRect().width), Math.round(thumbs[1].getBoundingClientRect().height)] : null,
    media: mr ? [Math.round(mr.width), Math.round(mr.height)] : null,
    captionText: caption?.textContent?.replace(/\s+/g, " ").trim() ?? null,
    stripScrollable: strip ? strip.scrollWidth > strip.clientWidth : null,
  };
});
await page.screenshot({ path: `${OUT}/110-triage-new.png` });

/* 点第 6 个缩略图跳转 */
await page.locator(".triage-thumb").nth(5).click();
await page.waitForTimeout(500);
const afterJump = await page.evaluate(() => ({
  activeIndex: document.querySelector(".triage-thumb[data-active]")?.getAttribute("data-idx") ?? null,
  name: document.querySelector(".triage-name")?.textContent ?? null,
}));
await page.screenshot({ path: `${OUT}/111-triage-jump.png` });

console.log(JSON.stringify({ info, afterJump, errors }, null, 2));
await browser.close();
