import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createItemIndex, DEFAULT_FILTERS, selectItems, searchTokens } from "../packages/core/item-query.ts";

const items = [
  { id: "red", name: "被截短的显示名", originalName: "02-园景参考完整文件名末尾红狐.png", kind: "image", aspect: 2, color: "rgb(255, 0, 0)", createdAt: 10, bytes: 300, site: "example.com" },
  { id: "blue", name: "10-园景.png", kind: "image", aspect: 0.5, color: "#00f", createdAt: 20, bytes: 100 },
  { id: "video", name: "03-演示.mp4", kind: "video", aspect: 2, color: "#888888", createdAt: 30, bytes: 500, durationSeconds: 30 },
  { id: "unknown", name: "04-未知.jpg", kind: "image", aspect: 1, color: "invalid" },
];
const tags = { red: ["色彩", "建筑"], blue: ["建筑"] };
const index = createItemIndex(items, tags);
const query = (text = "", filters = {}, sort = "created-asc", dates = {}) =>
  selectItems(index, text, { ...DEFAULT_FILTERS, ...filters }, sort, dates).map((item) => item.id);

test("搜索完整文件名、中文 bigram、多词 AND、标签与来源", () => {
  assert.deepEqual(searchTokens("园景参考"), ["园景", "景参", "参考"]);
  assert.deepEqual(query("末尾红狐"), ["red"]);
  assert.deepEqual(query("园景 建筑"), ["red", "blue"]);
  assert.deepEqual(query("园景 色彩"), ["red"]);
  assert.deepEqual(query("EXAMPLE.COM"), ["red"]);
  assert.deepEqual(query("红色"), ["red"]);
  assert.deepEqual(query("不存在"), []);
  assert.deepEqual(query("  "), items.map((item) => item.id));
});

test("类型、比例、标签、来源同时取交集", () => {
  assert.deepEqual(query("", { kind: "image", aspect: "landscape", tag: "建筑", site: "example.com" }), ["red"]);
  assert.deepEqual(query("", { aspect: "square" }), ["unknown"]);
  assert.deepEqual(query("", { kind: "video", tag: "建筑" }), []);
});

test("色名、亮度、饱和度均可筛选，未知颜色不误匹配", () => {
  assert.deepEqual(query("", { color: "blue" }), ["blue"]);
  assert.deepEqual(query("", { color: "neutral", saturation: "muted" }), ["video"]);
  assert.deepEqual(query("", { saturation: "vivid", lightness: "medium" }), ["red", "blue"]);
  assert.deepEqual(query("", { lightness: "dark" }), []);
});

test("视频时长的 30 秒与 5 分钟边界互不重叠", () => {
  const videos = [0, 29.9, 30, 299.9, 300].map((durationSeconds) => ({
    ...items[2], id: String(durationSeconds), durationSeconds,
  }));
  const videoIndex = createItemIndex(videos, {});
  const pick = (duration) => selectItems(videoIndex, "", { ...DEFAULT_FILTERS, duration }, "created-asc").map((item) => item.id);
  assert.deepEqual(pick("short"), ["0", "29.9"]);
  assert.deepEqual(pick("medium"), ["30", "299.9"]);
  assert.deepEqual(pick("long"), ["300"]);
  assert.deepEqual(query("", { duration: "medium" }), ["video"]);
});

test("排序自然比较文件名、缺失元数据置后、不修改原始数组", () => {
  assert.deepEqual(query("", {}, "name-asc"), ["red", "video", "unknown", "blue"]);
  assert.deepEqual(query("", {}, "size-desc"), ["video", "red", "blue", "unknown"]);
  assert.deepEqual(query("", {}, "size-asc"), ["blue", "red", "video", "unknown"]);
  assert.deepEqual(query("", {}, "created-desc"), ["video", "blue", "red", "unknown"]);
  assert.deepEqual(items.map((item) => item.id), ["red", "blue", "video", "unknown"]);
  assert.deepEqual(query("", {}, "aspect-desc"), ["red", "video", "unknown", "blue"]);
});

test("日期范围左闭右开；非法范围无结果，未知时间不参与", () => {
  assert.deepEqual(query("", {}, "created-asc", { from: 10, until: 30 }), ["red", "blue"]);
  assert.deepEqual(query("", {}, "created-asc", { from: 30 }), ["video"]);
  assert.deepEqual(query("", {}, "created-asc", { invalid: true }), []);
});

test("标签更新后重建索引，旧结果不会残留", () => {
  const changed = createItemIndex(items, { blue: ["色彩"] });
  assert.deepEqual(selectItems(changed, "色彩", DEFAULT_FILTERS, "created-asc").map((item) => item.id), ["blue"]);
});

test("一万项组合检索在 100ms 预算内", () => {
  const large = Array.from({ length: 10000 }, (_, i) => ({ ...items[i % items.length], id: String(i) }));
  const largeIndex = createItemIndex(large, {});
  const start = performance.now();
  const result = selectItems(largeIndex, "园景", { ...DEFAULT_FILTERS, kind: "image" }, "name-desc");
  const elapsed = performance.now() - start;
  assert.equal(result.length, 5000);
  assert.ok(elapsed < 100, `查询耗时 ${elapsed.toFixed(1)}ms`);
  console.log(`10,000 项组合检索：${elapsed.toFixed(1)}ms`);
});
