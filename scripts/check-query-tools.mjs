import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const url = process.env.APP_URL ?? "http://127.0.0.1:5174";
const out = ".cache/shots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
const checked = [];
const ids = async () => page.locator(".cell").evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-id")));
const expectIds = async (expected) => {
  await page.waitForFunction((list) => JSON.stringify([...document.querySelectorAll(".cell")].map((cell) => cell.getAttribute("data-id"))) === JSON.stringify(list), expected);
  assert.deepEqual(await ids(), expected);
};
const filterPanel = () => page.getByRole("dialog", { name: "筛选素材", exact: true });
const openFilters = async () => {
  if (!await filterPanel().count()) await page.getByRole("button", { name: "筛选", exact: true }).click();
};
const clear = async () => {
  await page.keyboard.press("Escape");
  const button = page.getByRole("button", { name: "清除搜索与筛选", exact: true });
  if (await button.count()) await button.click();
};

try {
  await page.goto(url, { waitUntil: "networkidle" });
  // 独立浏览器上下文只写测试库，不触碰用户的浏览器或桌面资料库。
  await page.evaluate(async () => {
    localStorage.clear();
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("ceas");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 240;
    canvas.getContext("2d").fillRect(0, 0, 320, 240);
    const thumb = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const rows = [
      { id: "a", name: "02-园景参考完整文件名末尾红狐.png", w: 640, h: 320, color: "rgb(255, 0, 0)", bytes: 300, site: "example.com" },
      { id: "b", name: "10-园景蓝图.png", w: 320, h: 640, color: "rgb(0, 0, 255)", bytes: 100 },
      { id: "c", name: "03-演示视频.mp4", w: 640, h: 320, color: "rgb(128, 128, 128)", bytes: 500, kind: "video", duration: 45 },
      { id: "d", name: "04-方形素材.png", w: 320, h: 320, color: "rgb(0, 255, 0)", bytes: 200 },
      { id: "e", name: "05-夜景.png", w: 640, h: 320, color: "rgb(20, 20, 20)", bytes: 400 },
      { id: "f", name: "06-白色素材.png", w: 320, h: 320, color: "rgb(240, 240, 240)", bytes: 600 },
    ];
    await new Promise((resolve, reject) => {
      const tx = db.transaction("items", "readwrite");
      tx.objectStore("items").clear();
      rows.forEach((row, i) => tx.objectStore("items").put({
        hash: `test-${row.id}`, kind: "image", ext: "png", ...row, thumb,
        createdAt: new Date(2026, 9, 20 + i, 12).getTime(),
      }));
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
    localStorage.setItem("ceas.mode", "library");
    localStorage.setItem("ceas.tags.v1", JSON.stringify({ a: ["建筑", "色彩"], b: ["建筑"], c: ["演示"] }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await expectIds(["a", "b", "c", "d", "e", "f"]);

  const alignment = [];
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    const measured = await page.locator(".mini-capsule .icon-btn").evaluateAll((buttons) => ({
      density: document.documentElement.dataset.density,
      offsets: buttons.map((button) => {
        const a = button.getBoundingClientRect();
        const b = button.querySelector("svg").getBoundingClientRect();
        return { label: button.getAttribute("aria-label"), dx: b.left + b.width / 2 - a.left - a.width / 2, dy: b.top + b.height / 2 - a.top - a.height / 2 };
      }),
    }));
    for (const offset of measured.offsets) {
      assert.ok(Math.abs(offset.dx) < 0.5 && Math.abs(offset.dy) < 0.5, `${measured.density} ${offset.label} 未居中`);
    }
    alignment.push(measured);
    await page.locator(".mini-capsule").screenshot({ path: `${out}/query-toolbar-${measured.density}.png` });
    if (i === 0) await page.screenshot({ path: `${out}/query-density-alignment.png` });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^密度：/ }).click();
  }
  checked.push("三档密度下四个工具按钮的图标与选中背景同心");

  await page.keyboard.press("Control+k");
  const search = page.getByRole("searchbox", { name: "搜索素材" });
  await search.waitFor();
  assert.equal(await search.evaluate((input) => input === document.activeElement), true);
  await search.fill("末尾红狐");
  await expectIds(["a"]);
  await search.fill("园景 建筑");
  await expectIds(["a", "b"]);
  await search.fill("EXAMPLE.COM");
  await expectIds(["a"]);
  await search.fill("园景 建筑");
  await expectIds(["a", "b"]);
  await page.screenshot({ path: `${out}/query-search.png` });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", { name: "搜索", exact: true }).evaluate((button) => button === document.activeElement), true);
  checked.push("Ctrl+K 自动聚焦、完整文件名、中文标签 AND、Esc 回焦");

  await page.locator('.cell[data-id="a"]').dblclick();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Control+k");
  assert.equal(await page.getByRole("searchbox").count(), 0);
  assert.match(await page.locator(".panel-index").textContent(), /1\s*\/\s*2/);
  await page.keyboard.press("ArrowRight");
  assert.match(await page.locator(".panel-index").textContent(), /2\s*\/\s*2/);
  await page.keyboard.press("Escape");
  await page.locator(".overlay").waitFor({ state: "detached" });
  await clear();
  checked.push("详情按当前结果翻页、模态内不打开后台搜索");

  await page.getByRole("button", { name: "排序", exact: true }).click();
  await page.getByRole("combobox", { name: "排序方式", exact: true }).selectOption("size-desc");
  await expectIds(["f", "c", "e", "a", "d", "b"]);
  await page.screenshot({ path: `${out}/query-sort.png` });
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "networkidle" });
  await expectIds(["f", "c", "e", "a", "d", "b"]);
  checked.push("大小排序、刷新保留排序偏好");

  await openFilters();
  await page.getByLabel("素材类型", { exact: true }).selectOption("video");
  await expectIds(["c"]);
  await page.getByLabel("视频时长", { exact: true }).selectOption("medium");
  await expectIds(["c"]);
  await page.getByLabel("视频时长", { exact: true }).selectOption("short");
  await page.getByText("没有匹配的素材", { exact: true }).waitFor();
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await page.getByLabel("标签", { exact: true }).selectOption("建筑");
  await page.getByLabel("宽高比", { exact: true }).selectOption("landscape");
  await expectIds(["a"]);
  await page.screenshot({ path: `${out}/query-filter.png` });
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await page.getByLabel("主色", { exact: true }).selectOption("neutral");
  await page.getByLabel("亮度", { exact: true }).selectOption("dark");
  await expectIds(["e"]);
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await page.getByLabel("导入日期：从", { exact: true }).fill("2026-10-21");
  await page.getByLabel("导入日期：至（含当天）", { exact: true }).fill("2026-10-22");
  await expectIds(["c", "b"]);
  await clear();
  checked.push("类型、比例、标签、颜色、亮度、时长、日期范围与重置");

  await page.locator('.cell[data-id="a"]').click();
  await page.getByRole("button", { name: "排序", exact: true }).focus();
  await page.keyboard.press("Space");
  await page.getByRole("dialog", { name: "排序方式", exact: true }).waitFor();
  assert.equal(await page.locator(".overlay").count(), 0);
  await page.keyboard.press("Escape");
  await page.locator('.cell[data-id="a"]').click();
  await page.locator('.cell[data-id="b"]').click({ modifiers: ["Control"] });
  await page.getByRole("toolbar", { name: "已选 2 张" }).waitFor();
  await page.keyboard.press("Control+k");
  await search.fill("夜景");
  await page.keyboard.press("Space");
  assert.equal(await page.locator(".overlay").count(), 0);
  assert.equal(await page.getByRole("toolbar", { name: "已选 2 张" }).count(), 0);
  await search.fill("不存在");
  await page.keyboard.press("Escape");
  for (const view of ["画布", "无限", "网格"]) {
    await page.getByRole("tab", { name: new RegExp(`^${view}视图`) }).click();
    await page.getByText("没有匹配的素材", { exact: true }).waitFor();
  }
  await clear();
  await page.getByRole("toolbar", { name: "已选 2 张" }).waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  checked.push("输入空格不穿透、隐藏选择不进入批量操作、三视图共享空结果");

  const videoThumb = await page.locator('.cell[data-id="c"] img').getAttribute("src");
  await page.getByRole("tab", { name: /^画布视图/ }).click();
  await page.locator(".cv-item").first().waitFor();
  const item = page.locator('.cv-item[data-item="a"]');
  const box = await item.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 45, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(350);
  const positions = await page.evaluate(() => JSON.parse(localStorage.getItem("ceas.board.v1")));
  const moved = positions.find((node) => node.id === "a");
  await openFilters();
  await page.getByLabel("素材类型", { exact: true }).selectOption("video");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelectorAll(".cv-item").length === 1);
  await page.waitForTimeout(350);
  const hidden = await page.evaluate(() => JSON.parse(localStorage.getItem("ceas.board.v1")));
  assert.deepEqual(hidden.find((node) => node.id === "a"), moved);
  await clear();
  await page.waitForFunction(() => document.querySelectorAll(".cv-item").length === 6);
  await page.waitForTimeout(350);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("ceas.board.v1")));
  assert.deepEqual(restored.find((node) => node.id === "a"), moved);
  await page.getByRole("tab", { name: /^无限视图/ }).click();
  await openFilters();
  await page.getByLabel("素材类型", { exact: true }).selectOption("video");
  await page.keyboard.press("Escape");
  const infinityImages = await page.locator(".inf-item img").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("src")));
  assert.ok(infinityImages.length > 0);
  assert.ok(infinityImages.every((src) => src === videoThumb));
  checked.push("三视图共享筛选、画布隐藏再恢复保持移动坐标");

  await page.getByRole("tab", { name: /^网格视图/ }).click();
  await clear();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.keyboard.press("Control+k");
  const focus = await search.evaluate((input) => ({
    focused: input === document.activeElement,
    outline: getComputedStyle(input).outlineWidth,
  }));
  assert.equal(focus.focused, true);
  assert.equal(focus.outline, "2px");
  await page.screenshot({ path: `${out}/query-dark-focus.png` });
  await page.keyboard.press("Escape");
  await page.locator('.cell[data-id="a"]').click({button:"right"});
  await page.getByRole("menuitem",{name:/^删除/}).click();
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===5);
  await page.reload({waitUntil:"networkidle"});
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===5);
  const physical=await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const request=indexedDB.open("ceas");request.onsuccess=()=>resolve(request.result);});
    return new Promise(resolve=>{const request=db.transaction("items").objectStore("items").getAll();request.onsuccess=()=>{db.close();resolve(request.result.map(row=>({id:row.id,deletedSeq:row.deletedSeq})));};});
  });
  assert.equal(physical.length,6);assert.ok(physical.find(row=>row.id==="a").deletedSeq>0);
  await page.getByRole("button",{name:"回收站",exact:true}).click();
  await page.locator('.cell[data-id="a"]').waitFor();await page.locator('.cell[data-id="a"]').click();
  await page.getByRole("button",{name:"恢复",exact:true}).click();await page.getByText("回收站为空",{exact:true}).waitFor();
  await page.getByRole("button",{name:"资料库",exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll(".cell").length===6);
  checked.push("浏览器端同样软删除，刷新后可从回收站恢复，物理记录保留");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checked, alignment, focus, errors, screenshots: ["query-search.png", "query-sort.png", "query-filter.png", "query-dark-focus.png", "query-density-alignment.png"] }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/query-failure.png` }).catch(() => {});
  console.error("失败时弹层：", await page.locator(".query-panel").allTextContents());
  throw error;
} finally {
  await context.close();
  await browser.close();
}
