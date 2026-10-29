import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { Plugin } from "vite";

/* ══ 本地真实素材（仅开发模式）═══════════════════════════════
   从磁盘某个目录直接提供图片，不拷贝进仓库、不写 public/。
   - GET /__fixtures/manifest.json  → [{ name, url, w, h }]
   - GET /__fixtures/<name>         → 原图

   尺寸从文件头解析（JPEG / PNG / GIF / WebP），不引入依赖。
   ------------------------------------------------------------ */

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  /* 视频：尺寸由导入时的 <video> 探测，不靠文件头解析 */
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mov": "video/quicktime",
};

export function jpegSize(buf: Buffer): { w: number; h: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1] ?? 0;
    /* SOF0 / SOF1 / SOF2 … 带尺寸的帧头（跳过 C4 DHT、C8 JPG、CC DAC） */
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

export function headSize(buf: Buffer, ext: string): { w: number; h: number } | null {
  if (ext === ".png" && buf.length > 24 && buf.toString("ascii", 1, 4) === "PNG") {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if ((ext === ".gif") && buf.toString("ascii", 0, 3) === "GIF") {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  if (ext === ".webp" && buf.toString("ascii", 0, 4) === "RIFF") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X") {
      const w = 1 + buf.readUIntLE(24, 3);
      const h = 1 + buf.readUIntLE(27, 3);
      return { w, h };
    }
    if (kind === "VP8 ") {
      return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    }
    if (kind === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  return jpegSize(buf);
}

async function readHead(file: string, bytes = 65536): Promise<Buffer> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export function fixtures(dir: string | undefined, mount = "/__fixtures"): Plugin {
  let cache: { name: string; url: string; w: number; h: number }[] | null = null;

  return {
    name: "ceas-fixtures",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith(mount)) return next();
        if (!dir) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.statusCode = url === `${mount}/manifest.json` ? 200 : 404;
          res.end(url === `${mount}/manifest.json` ? "[]" : "{}");
          return;
        }

        if (url === `${mount}/manifest.json`) {
          try {
            if (!cache) {
              const names = (await readdir(dir)).filter((n) => MIME[extname(n).toLowerCase()]);
              names.sort();
              cache = [];
              for (const name of names) {
                const full = join(dir, name);
                const ext = extname(name).toLowerCase();
                try {
                  const info = await stat(full);
                  if (!info.isFile()) continue;
                  const dim = headSize(await readHead(full), ext) ?? { w: 1, h: 1 };
                  cache.push({ name, url: `${mount}/${encodeURIComponent(name)}`, ...{ w: dim.w, h: dim.h } });
                } catch {
                  /* 单个文件读不了就跳过 */
                }
              }
            }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify(cache));
          } catch {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: `fixtures dir not readable: ${dir}` }));
          }
          return;
        }

        const name = decodeURIComponent(url.slice(mount.length + 1));
        const root = resolve(dir);
        const full = resolve(join(root, name));
        const ext = extname(full).toLowerCase();
        const type = MIME[ext];
        /* resolve 之后才能比较：Windows 下 join 出来的分隔符与配置里的不一样 */
        if (!type || !full.startsWith(root)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        server.config.logger.info(`[fixtures] ${name}`);
        res.setHeader("Content-Type", type);
        res.setHeader("Cache-Control", "no-cache");

        /* 必须支持 Range：否则浏览器无法 seek，视频的 currentTime 永远是 0。
           视频播放、拖进度条、抽帧全都依赖它。 */
        const info = await stat(full);
        const size = info.size;
        res.setHeader("Accept-Ranges", "bytes");

        const range = req.headers.range;
        const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
        if (m) {
          const start = m[1] ? Number(m[1]) : 0;
          const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
          if (start >= size || start > end) {
            res.statusCode = 416;
            res.setHeader("Content-Range", `bytes */${size}`);
            res.end();
            return;
          }
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
          res.setHeader("Content-Length", String(end - start + 1));
          createReadStream(full, { start, end }).pipe(res);
          return;
        }

        res.setHeader("Content-Length", String(size));
        createReadStream(full).pipe(res);
      });
    },
  };
}
