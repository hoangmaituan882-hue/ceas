import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 展开动效验收：
   1) 双击后 .grid 带 data-recede，其他格子透明并缩小
   2) 退场有错峰（不同时刻透明度不同）
   3) 关闭后格子回到不透明
   4) 浮层仍在 */

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
await page.waitForTimeout(600);

const stats = () =>
  page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll(".cell"));
    const ops = cells.map((el) => Number(getComputedStyle(el).opacity));
    const scales = cells.map((el) => {
      const t = getComputedStyle(el).transform;
      if (!t || t === "none") return 1;
      const m = /matrix\(([^)]+)\)/.exec(t);
      return m ? Number(m[1].split(",")[0]) : 1;
    });
    return {
      recede: !!document.querySelector(".grid[data-recede]"),
      count: cells.length,
      minOpacity: Math.min(...ops),
      maxOpacity: Math.max(...ops),
      minScale: Math.min(...scales),
      overlay: !!document.querySelector(".overlay"),
    };
  });

const idle = await stats();

/* 点第一张空白位置双击打开 */
const box = await page.locator(".cell").first().boundingBox();
await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

/* 立刻抓一帧中间的退场状态 */
await page.waitForTimeout(70);
const mid = await stats();
await page.screenshot({ path: `${OUT}/160-recede-mid.png` });

await page.waitForTimeout(700);
const open = await stats();
await page.screenshot({ path: `${OUT}/161-recede-open.png` });

/* 关闭 */
await page.keyboard.press("Escape");
await page.waitForTimeout(700);
const closed = await stats();

console.log(JSON.stringify({ idle, mid, open, closed, errors }, null, 2));
await browser.close();
