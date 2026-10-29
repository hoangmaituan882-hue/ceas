import { useEffect, useState } from "react";
import type { Item } from "./items";

/* ══ 素材来源 ════════════════════════════════════════════════
   只有开发模式才有本地素材目录（Vite 插件提供 manifest）。
   **拿不到就是空** —— 绝不退回合成占位数据：
   打包版首屏出现 1800 条假素材，比空态糟糕得多。
   ------------------------------------------------------------ */

type Fixture = { name: string; url: string; w: number; h: number };

export function useItems(): Item[] {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let alive = true;

    fetch("/__fixtures/manifest.json")
      .then((r) => (r.ok ? (r.json() as Promise<Fixture[]>) : null))
      .then((list) => {
        if (!alive || !list || list.length === 0) return;
        setItems(
          list.map((f, i) => {
            /* 目录里可能混着视频；尺寸拿不到就当正方形，导入时会用
               <video> 探出真实宽高，这里只影响导入前的临时展示 */
            const video = /\.(mp4|m4v|webm|ogv|mov)$/i.test(f.name);
            return {
              id: `fx_${String(i + 1).padStart(3, "0")}`,
              aspect: f.w > 1 && f.h > 1 ? f.w / f.h : 1,
              color: "#e6e2db",
              kind: video ? ("video" as const) : ("image" as const),
              name: f.name.replace(/\.[^.]+$/, "").slice(0, 18),
              originalName: f.name,
              size: `${f.w} × ${f.h}`,
              src: f.url,
            };
          }),
        );
      })
      .catch(() => {
        /* 没有素材目录：保持空，交给空态 */
      });

    return () => {
      alive = false;
    };
  }, []);

  return items;
}
