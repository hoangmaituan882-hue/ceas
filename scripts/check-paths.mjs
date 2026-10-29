#!/usr/bin/env node
/**
 * 路径守卫：确认没有任何缓存 / 配置把文件写到 C 盘。
 *
 * 检查三类东西：
 *   1. 当前会话的环境变量（TEMP、CARGO_HOME、PLAYWRIGHT_BROWSERS_PATH…）
 *   2. .npmrc 里的 cache / store-dir / state-dir
 *   3. 仓库内的配置文件是否出现 C:\ 或 file:///C: 这类绝对路径
 *
 * 用法：node scripts/check-paths.mjs
 * 退出码：0 通过，1 发现问题
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FORBIDDEN = /(?:^|[^A-Za-z])(?:C:\\|C:\/|file:\/\/\/C:)/i;

const ENV_KEYS = [
  "TEMP",
  "TMP",
  "TMPDIR",
  "npm_config_cache",
  "npm_config_store_dir",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "PIP_CACHE_DIR",
  "PLAYWRIGHT_BROWSERS_PATH",
];

const CONFIG_FILES = [
  "package.json",
  ".npmrc",
  "tsconfig.json",
  "pnpm-workspace.yaml",
  "vite.config.ts",
  "tauri.conf.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  ".cargo/config.toml",
  "components.json",
  "biome.json",
];

const problems = [];
const info = [];

/* ── 1. 环境变量 ─────────────────────────────── */
for (const key of ENV_KEYS) {
  const value = process.env[key];
  if (!value) continue;
  if (FORBIDDEN.test(value)) {
    problems.push(`环境变量 ${key} 指向 C 盘：${value}`);
  } else {
    info.push(`${key} = ${value}`);
  }
}

/* ── 2. .npmrc ──────────────────────────────── */
const npmrc = join(ROOT, ".npmrc");
if (existsSync(npmrc)) {
  const text = readFileSync(npmrc, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const [rawKey, ...rest] = line.split("=");
    const key = rawKey.trim();
    const value = rest.join("=").trim();
    if (!["cache", "store-dir", "state-dir", "prefix"].includes(key)) continue;
    if (!value) continue;
    const resolved = resolve(ROOT, value);
    if (FORBIDDEN.test(value) || FORBIDDEN.test(resolved)) {
      problems.push(`.npmrc 的 ${key} 指向 C 盘：${value}`);
    } else {
      info.push(`.npmrc ${key} = ${resolved}`);
    }
  }
}

/* ── 3. 配置里的绝对路径 ─────────────────────── */
for (const rel of CONFIG_FILES) {
  const file = join(ROOT, rel);
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  const hit = text.match(FORBIDDEN);
  if (hit) problems.push(`${rel} 里出现 C 盘绝对路径（${hit[0].trim()}）`);
}

/* ── 结果 ───────────────────────────────────── */
console.log("路径守卫 · 项目根目录：", ROOT);
if (info.length) {
  console.log("\n已确认的重定向：");
  for (const line of info) console.log("  ok  " + line);
}

if (problems.length) {
  console.log("\n发现 " + problems.length + " 个问题：");
  for (const p of problems) console.log("  !!  " + p);
  console.log("\n修法：先执行  . .\\scripts\\env.ps1  （PowerShell）或 call scripts\\env.cmd（cmd）");
  process.exit(1);
}

console.log("\n通过：没有发现指向 C 盘的缓存或配置。");
