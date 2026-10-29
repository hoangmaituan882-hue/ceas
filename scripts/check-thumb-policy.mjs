import { chromium } from "playwright";

/* 缩略图 / 原图策略断言（真实素材）：
   - 缩略图长边一律 ≤ 512
   - 原图长边 > 512 的才留 originals 记录，否则直接复用原图
   - 两种 Blob 都带 MIME */

const URL = process.env.APP_URL ?? "http://localhost:5173";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("ERR " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  await new Promise((res) => {
    const r = indexedDB.deleteDatabase("ceas");
    r.onsuccess = r.onerror = r.onblocked = () => res(null);
  });
});
await page.reload({ waitUntil: "networkidle" });

await page.getByRole("button", { name: "导入素材" }).click();
await page.waitForFunction(() => document.querySelector(".import-label")?.textContent?.includes("导入完成"), null, { timeout: 60000 });
await page.waitForTimeout(800);

const result = await page.evaluate(async () => {
  const db = await new Promise((res) => {
    const req = indexedDB.open("ceas");
    req.onsuccess = () => res(req.result);
  });
  const readAll = (store) =>
    new Promise((res) => {
      const t = db.transaction(store, "readonly");
      const all = t.objectStore(store).getAll();
      all.onsuccess = () => res(all.result);
      all.onerror = () => res([]);
    });

  const rows = await readAll("items");
  const originals = await readAll("originals");
  const hashes = new Set(originals.map((o) => o.hash));

  let maxThumbEdge = 0;
  let missingMime = 0;
  const downscaled = [];

  for (const r of rows) {
    const bmp = await createImageBitmap(r.thumb);
    const edge = Math.max(bmp.width, bmp.height);
    maxThumbEdge = Math.max(maxThumbEdge, edge);
    bmp.close();
    if (!r.thumb.type) missingMime++;
    if (Math.max(r.w, r.h) > 512) {
      downscaled.push({ native: [r.w, r.h], thumb: edge, hasOriginal: hashes.has(r.hash), thumbMime: r.thumb.type });
    }
  }

  return {
    items: rows.length,
    originals: originals.length,
    maxThumbEdge,
    missingMime,
    downscaled,
    originalMime: originals[0]?.blob?.type ?? "",
    originalBytes: originals.reduce((s, o) => s + (o.blob?.size ?? 0), 0),
  };
});

console.log(JSON.stringify({ ...result, errors }, null, 2));
await browser.close();
