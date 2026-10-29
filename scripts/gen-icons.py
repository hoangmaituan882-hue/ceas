#!/usr/bin/env python3
"""生成品牌图标（纯标准库，无需 Pillow）。

几何：100 单位坐标系，由 SVG 同款路径参数换算。
输出：
  assets/brand/app-icon-*.png   512 / 256 / 128 / 64 / 48 / 32 / 24 / 16
  src-tauri/icons/icon.ico      多尺寸（16..256，BMP + PNG）
  src-tauri/icons/*.png         Tauri 约定名

小尺寸（<32px）自动切换成圆点眼型，避免细长眼在高缩放下糊掉。
"""

import math
import os
import struct
import zlib

BODY = (0x1A, 0x1A, 0x1A, 255)
EYE = (0xFA, 0xFA, 0xFA, 255)
RIM = (255, 255, 255, 30)

MASTER = 1024
OUT_PNG = [512, 256, 128, 64, 48, 32, 24, 16]
SMALL = 32  # 小于该尺寸使用圆点眼


def rr_alpha(px, py, x0, y0, w, h, r):
    """圆角矩形覆盖度，1px 解析抗锯齿。"""
    cx, cy = x0 + w / 2.0, y0 + h / 2.0
    dx = abs(px - cx) - (w / 2.0 - r)
    dy = abs(py - cy) - (h / 2.0 - r)
    ox, oy = max(dx, 0.0), max(dy, 0.0)
    d = math.hypot(ox, oy) + min(max(dx, dy), 0.0) - r
    return 0.0 if d > 0.5 else (1.0 if d < -0.5 else 0.5 - d)


def render(size, eye_w, eye_h, eye_off, margin=0.06, rim=True):
    """返回 size*size 的 RGBA bytes（预乘合成后反预乘）。"""
    pad = size * margin
    bx, by = pad, pad
    bw = bh = size - 2 * pad
    br = bw * 0.26

    cx, cy = size / 2.0, size / 2.0
    ew = bw * eye_w
    eh = bw * eye_h
    er = min(ew, eh) / 2.0
    ex = bw * eye_off

    inset = bw * 0.007

    out = bytearray(size * size * 4)
    i = 0
    for y in range(size):
        py = y + 0.5
        for x in range(size):
            px = x + 0.5
            a_body = rr_alpha(px, py, bx, by, bw, bh, br)
            if a_body <= 0.0:
                out[i:i + 4] = b"\0\0\0\0"
                i += 4
                continue

            a_in = rr_alpha(px, py, bx + inset, by + inset,
                            bw - 2 * inset, bh - 2 * inset, max(br - inset, 0.0))
            a_rim = max(0.0, a_body - a_in) * (RIM[3] / 255.0) if rim else 0.0

            r = BODY[0]
            g = BODY[1]
            b = BODY[2]
            if a_rim > 0:
                r = r * (1 - a_rim) + 255 * a_rim
                g = g * (1 - a_rim) + 255 * a_rim
                b = b * (1 - a_rim) + 255 * a_rim

            a_eye = max(
                rr_alpha(px, py, cx - ex - ew / 2, cy - eh / 2, ew, eh, er),
                rr_alpha(px, py, cx + ex - ew / 2, cy - eh / 2, ew, eh, er),
            )
            if a_eye > 0:
                r = r * (1 - a_eye) + EYE[0] * a_eye
                g = g * (1 - a_eye) + EYE[1] * a_eye
                b = b * (1 - a_eye) + EYE[2] * a_eye

            out[i] = int(round(r))
            out[i + 1] = int(round(g))
            out[i + 2] = int(round(b))
            out[i + 3] = int(round(a_body * 255))
            i += 4
    return bytes(out)


def downsample(src, ssize, dsize):
    if ssize == dsize:
        return src
    k = ssize // dsize
    out = bytearray(dsize * dsize * 4)
    o = 0
    for y in range(dsize):
        for x in range(dsize):
            r = g = b = a = 0
            for yy in range(k):
                base = ((y * k + yy) * ssize + x * k) * 4
                for xx in range(k):
                    j = base + xx * 4
                    al = src[j + 3]
                    r += src[j] * al
                    g += src[j + 1] * al
                    b += src[j + 2] * al
                    a += al
            n = k * k
            if a:
                out[o] = min(255, int(round(r / a)))
                out[o + 1] = min(255, int(round(g / a)))
                out[o + 2] = min(255, int(round(b / a)))
                out[o + 3] = int(round(a / n))
            o += 4
    return bytes(out)


def png(px, size):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)
        raw += px[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def bmp_entry(px, size):
    rows = []
    stride = size * 4
    for y in range(size - 1, -1, -1):
        row = bytearray()
        base = y * stride
        for x in range(size):
            j = base + x * 4
            row += bytes((px[j + 2], px[j + 1], px[j], px[j + 3]))
        rows.append(bytes(row))
    pixels = b"".join(rows)
    mask_row = ((size + 31) // 32) * 4
    mask = b"\0" * (mask_row * size)
    header = struct.pack("<IiiHHIIiiII", 40, size, size * 2, 1, 32, 0,
                         len(pixels), 0, 0, 0, 0)
    return header + pixels + mask


def ico(entries):
    count = len(entries)
    head = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    dirs = b""
    blobs = b""
    for size, data in entries:
        w = 0 if size >= 256 else size
        dirs += struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    return head + dirs + blobs


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    brand = os.path.join(root, "assets", "brand")
    tauri = os.path.join(root, "src-tauri", "icons")
    os.makedirs(brand, exist_ok=True)
    os.makedirs(tauri, exist_ok=True)

    # 每档按目标尺寸原生渲染（SDF 抗锯齿），避免大图降采样把小尺寸糊掉
    def art(size):
        if size < 32:
            return render(size, 0.22, 0.22, 0.170, margin=0.045, rim=False)
        return render(size, 0.115, 0.20, 0.185, margin=0.06)

    sizes = {}
    for s in OUT_PNG:
        sizes[s] = art(s)
        name = f"app-icon-{s}.png"
        with open(os.path.join(brand, name), "wb") as f:
            f.write(png(sizes[s], s))
        print("wrote", os.path.join("assets", "brand", name))

    entries = []
    for s in (16, 24, 32, 48, 64, 128, 256):
        data = png(sizes[s], s) if s >= 256 else bmp_entry(sizes[s], s)
        entries.append((s, data))
    with open(os.path.join(tauri, "icon.ico"), "wb") as f:
        f.write(ico(entries))
    print("wrote src-tauri/icons/icon.ico")

    for s, name in {32: "32x32.png", 128: "128x128.png", 256: "128x128@2x.png", 512: "icon.png"}.items():
        with open(os.path.join(tauri, name), "wb") as f:
            f.write(png(sizes[s], s))
        print("wrote", os.path.join("src-tauri", "icons", name))


if __name__ == "__main__":
    main()
