import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

/* 把参考视频逐帧抽出来观察交互。
   坑一：直接截图 <video> 在 headless 下合成层不更新，13 帧全一样 → 改用 canvas 取像素。
   坑二：about:blank 里加载 http 视频会被跨源挡住 → 必须先 goto 到同源页面再建 video。 */

const ORIGIN = process.env.APP_URL ?? "http://localhost:5173";
const VIDEO_PATH = process.env.VIDEO_PATH ?? "/__fixtures/video_proxy.mp4";
const OUT = process.env.FRAME_DIR ?? ".cache/shots/frames";
const STEP = Number(process.env.FRAME_STEP ?? 1);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text().slice(0, 120)); });

await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });

await page.evaluate((src) => {
  document.body.innerHTML = "";
  const v = document.createElement("video");
  v.id = "v";
  v.src = src;
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.style.width = "100%";
  document.body.appendChild(v);
}, VIDEO_PATH);

await page.waitForFunction(() => {
  const v = document.getElementById("v");
  return v && v.readyState >= 2 && v.videoWidth > 0;
}, null, { timeout: 20000 });

const meta = await page.evaluate(() => {
  const v = document.getElementById("v");
  return { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
});

const stamps = [];
for (let t = 0; t < meta.duration - 0.05; t += STEP) stamps.push(Number(t.toFixed(2)));

let saved = 0;
const hashes = new Set();
for (const t of stamps) {
  const out = await page.evaluate(
    ({ time, w, h }) =>
      new Promise((res) => {
        const v = document.getElementById("v");
        const grab = () => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          c.getContext("2d").drawImage(v, 0, 0, w, h);
          res({ url: c.toDataURL("image/png"), at: Number(v.currentTime.toFixed(2)) });
        };
        v.onseeked = grab;
        v.currentTime = time;
        setTimeout(grab, 2000);
      }),
    { time: t, w: meta.w, h: meta.h },
  );

  const base64 = String(out.url).split(",")[1];
  if (!base64) continue;
  const buf = Buffer.from(base64, "base64");
  writeFileSync(`${OUT}/f${String(saved).padStart(2, "0")}_${String(out.at).replace(".", "-")}.png`, buf);
  hashes.add(buf.length + ":" + buf.subarray(0, 64).toString("hex"));
  saved += 1;
}

console.log(JSON.stringify({ ...meta, requested: stamps.length, saved, distinct: hashes.size, dir: OUT }));
await browser.close();
