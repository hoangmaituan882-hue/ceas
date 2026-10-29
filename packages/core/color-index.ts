export type Rgb = readonly [number, number, number];
export function parseColor(value:string):Rgb|null {
  const hex=/^#([\da-f]{3}|[\da-f]{6})$/iu.exec(value.trim())?.[1];
  if(hex){const expanded=hex.length===3?[...hex].map((part)=>part+part).join(""):hex;return [0,2,4].map((index)=>Number.parseInt(expanded.slice(index,index+2),16)) as [number,number,number];}
  const rgb=/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/iu.exec(value.trim());
  return rgb&&rgb.slice(1).every((part)=>Number(part)<=255)?rgb.slice(1).map(Number) as [number,number,number]:null;
}

/** 有限像素直方图，保留最多九种实际出现的代表色；透明像素不参与。 */
export function indexColors(pixels: ArrayLike<number>): string[] {
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    const alpha = (pixels[offset + 3] ?? 0) / 255;
    if (alpha < 0.1) continue;
    const r = pixels[offset] ?? 0, g = pixels[offset + 1] ?? 0, b = pixels[offset + 2] ?? 0;
    const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
    const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bin.count += alpha; bin.r += r * alpha; bin.g += g * alpha; bin.b += b * alpha;
    bins.set(key, bin);
  }
  const ordered = [...bins.entries()].sort((a, b) => b[1].count - a[1].count || a[0] - b[0]);
  const selected: Rgb[] = [];
  for (const [, bin] of ordered) {
    const rgb: Rgb = [bin.r / bin.count, bin.g / bin.count, bin.b / bin.count];
    if (selected.every((color) => colorDistance(color, rgb) >= 12)) selected.push(rgb);
    if (selected.length === 9) break;
  }
  return selected.map((rgb) => `rgb(${rgb.map(Math.round).join(", ")})`);
}

export function toLab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const f = (value: number) => value > 216 / 24389 ? Math.cbrt(value) : value * 24389 / 3132 + 16 / 116;
  const x = f((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047);
  const y = f(r * 0.2126729 + g * 0.7151522 + b * 0.072175);
  const z = f((r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function colorDistance(a: Rgb, b: Rgb): number {
  const left = toLab(a), right = toLab(b);
  return Math.hypot(...left.map((channel, index) => channel - (right[index] ?? 0)));
}
