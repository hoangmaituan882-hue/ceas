const THUMB_EDGE = 512;
type VideoMeta = { w: number; h: number; duration: number; poster: Blob; color: string };

export async function probeVideo(blob: Blob): Promise<VideoMeta> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("视频元数据超时")), 10000);
      video.onloadedmetadata = () => {
        window.clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("视频无法解码"));
      };
      video.load();
    });

    const w = video.videoWidth || 1;
    const h = video.videoHeight || 1;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;

    const target = Math.min(Math.max(0.1, duration * 0.33), Math.max(0.1, duration - 0.05));
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 4000);
      video.onseeked = () => {
        window.clearTimeout(timer);
        resolve();
      };
      try {
        video.currentTime = target;
      } catch {
        window.clearTimeout(timer);
        resolve();
      }
    });

    const scale = Math.min(1, THUMB_EDGE / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d 不可用");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const poster = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("封面编码失败"))), "image/webp", 0.8);
    });

    /* 主色直接从封面缩到 1×1 取，省一次解码 */
    const flat = document.createElement("canvas");
    flat.width = 1;
    flat.height = 1;
    const fctx = flat.getContext("2d");
    let color = "#d9d5cd";
    if (fctx) {
      fctx.drawImage(canvas, 0, 0, 1, 1);
      const [r, g, b] = fctx.getImageData(0, 0, 1, 1).data;
      color = `rgb(${r ?? 0}, ${g ?? 0}, ${b ?? 0})`;
    }

    return { w, h, duration, poster, color };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
