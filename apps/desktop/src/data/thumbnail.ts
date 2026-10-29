import { indexColors } from "@ceas/core/color-index";
const THUMB_EDGE = 512;
export function imagePalette(image: CanvasImageSource): string[] {
  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 64;
  const context = canvas.getContext("2d", {willReadFrequently:true});
  if (!context) return [];
  context.drawImage(image,0,0,64,64);
  return indexColors(context.getImageData(0,0,64,64).data);
}

/** 画到 1×1 取平均色，用作加载占位 */
export function dominantColor(bmp: ImageBitmap): string {
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d");
  if (!ctx) return "#d9d5cd";
  ctx.drawImage(bmp, 0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r ?? 0}, ${g ?? 0}, ${b ?? 0})`;
}

/** 长边缩到 512，产出 WebP —— 网格只用小图，原图另存 */
export async function makeThumb(bmp: ImageBitmap): Promise<Blob> {
  const scale = Math.min(1, THUMB_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d 不可用");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  if (!blob) throw new Error("缩略图编码失败");
  return blob;
}
