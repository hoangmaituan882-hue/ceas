import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

/* 右键菜单验收：弹出、标签子菜单、新增标签、勾选、切换、常用标签、持久化 */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const OUT = ".cache/shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 140)); });
page.on("pageerror", (e) => errors.push("ERR " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("ceas.tags.v1"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".cell");
await page.waitForTimeout(500);

const ctxCell = async (idx) => {
  const b = await page.locator(".cell").nth(idx).boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: "right" });
  await page.waitForTimeout(250);
};

/* 1) 弹出 */
await ctxCell(0);
const opened = (await page.locator(".ctx").count()) === 1;

/* 2) 标签子菜单 */
await page.locator(".ctx-parent").click();
await page.waitForTimeout(250);
const subShown = (await page.locator(".ctx-sub").count()) === 1;
const hasAddRow = (await page.getByRole("menuitem", { name: "添加标签…" }).count()) === 1;
await page.screenshot({ path: `${OUT}/170-ctx-tags-empty.png` });

/* 3) 添加标签 */
await page.getByRole("menuitem", { name: "添加标签…" }).click();
await page.locator(".ctx-add input").fill("参考");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const afterAdd = {
  label: await page.locator(".ctx-label").first().textContent(),
  checked: await page.locator('.ctx-tag[aria-checked="true"]').count(),
  menuStillOpen: (await page.locator(".ctx").count()) === 1,
};
await page.screenshot({ path: `${OUT}/171-ctx-tag-added.png` });

/* 4) 再点一次取消 */
await page.locator('.ctx-tag[aria-checked="true"]').first().click();
await page.waitForTimeout(250);
const afterToggleOff = {
  checked: await page.locator('.ctx-tag[aria-checked="true"]').count(),
  addRowBack: (await page.getByRole("menuitem", { name: "添加标签…" }).count()) === 1,
};

/* 5) 加两个标签，供「常用标签」验证 */
for (const t of ["线稿", "参考"]) {
  await page.getByRole("menuitem", { name: "添加标签…" }).click();
  await page.locator(".ctx-add input").fill(t);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
}

/* 关闭，换一张图右键，应看到「常用标签」而不是「已添加」 */
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
await ctxCell(3);
await page.locator(".ctx-parent").click();
await page.waitForTimeout(300);
const second = {
  labels: await page.locator(".ctx-label").allTextContents(),
  frequentCount: await page.locator(".ctx-sub .ctx-tag").count(),
};
await page.screenshot({ path: `${OUT}/172-ctx-frequent.png` });

/* 点一个常用标签 → 应出现在「已添加」里 */
await page.locator(".ctx-sub .ctx-tag").first().click();
await page.waitForTimeout(250);
const picked = await page.locator('.ctx-tag[aria-checked="true"]').count();

/* 6) 持久化 */
const stored = await page.evaluate(() => localStorage.getItem("ceas.tags.v1"));
await page.keyboard.press("Escape");
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".cell");
await page.waitForTimeout(400);
await ctxCell(0);
await page.locator(".ctx-parent").click();
await page.waitForTimeout(300);
const afterReload = await page.locator('.ctx-tag[aria-checked="true"]').allTextContents();

console.log(JSON.stringify({ opened, subShown, hasAddRow, afterAdd, afterToggleOff, second, picked, stored, afterReload, errors }, null, 2));
await browser.close();
