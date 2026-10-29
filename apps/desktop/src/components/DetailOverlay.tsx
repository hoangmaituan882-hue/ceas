import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { motion } from "motion/react";
import type { Item } from "@/data/items";
import { FileMetadata, type MetadataPatch } from "./FileMetadata";
import { SPRING } from "@ceas/ui/motion-tokens";
import { VideoPlayer } from "@/components/VideoPlayer";

/* ══ 详情浮层 ════════════════════════════════════════════════
   规范 v2 §7.3：遮罩 rgba(20,20,20,0.72)，图片最大 90vw × 82vh，
   保持原始比例，打开从缩略图位置长出来。

   为什么不用 layoutId：
   源缩略图在「虚拟化 + 可滚动」的容器里，滚动或重渲染会让 motion
   反复重算投影目标，动画会卡在中途（实测停在 0.36 倍）。这里改成
   手动 FLIP：打开瞬间记下缩略图矩形，用位移 + 缩放自己补间。
   ------------------------------------------------------------ */

export type Origin = { x: number; y: number; w: number; h: number };

type Props = {
  item: Item;
  index: number;
  total: number;
  origin?: Origin;
  /** 原图地址；没取到时退回首屏缩略图 */
  fullSrc?: string;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  tags?: readonly string[];
  onSaveMetadata?: (patch:MetadataPatch)=>Promise<void>;
  onSimilarColor?: (color:string)=>void;
};

type Flip = { x: number; y: number; scaleX: number; scaleY: number };

export function DetailOverlay({ item, index, total, origin, fullSrc, onClose, onPrev, onNext, tags=[], onSaveMetadata,onSimilarColor }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [flip, setFlip] = useState<Flip | null>(null);

  /* 等比适配：CSS 里同时给 height 和 max-width 会让 aspect-ratio 失效
     （实测 1.78 的图被压成 1.46），所以尺寸在 JS 里算 */
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    /* 扣掉 stage 的 padding，并按规范把高度封在 82vh */
    const availW = Math.max(1, el.clientWidth - padX);
    const availH = Math.max(1, Math.min(el.clientHeight - padY, window.innerHeight * 0.82));
    const ar = item.aspect || 1;
    let w = availW;
    let h = w / ar;
    if (h > availH) {
      h = availH;
      w = h * ar;
    }
    setSize({ w, h });
  }, [item.id, item.aspect]);

  /* 尺寸定下来以后，量出最终矩形，反推起始位移与缩放 */
  useLayoutEffect(() => {
    const el = media.current;
    if (!el || !origin || !size) {
      setFlip(null);
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      setFlip(null);
      return;
    }
    setFlip({
      x: origin.x + origin.w / 2 - (r.x + r.width / 2),
      y: origin.y + origin.h / 2 - (r.y + r.height / 2),
      scaleX: origin.w / r.width,
      scaleY: origin.h / r.height,
    });
  }, [origin, item.id, size]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if(e.key!=="Escape"&&e.target instanceof HTMLElement&&e.target.closest("input,textarea,select"))return;
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); onPrev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); onNext(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  return (
    <motion.div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      initial={{ opacity: 0 }}
      /* 遮罩晚 60ms 才压上来：先让网格里的其他图退场，再盖住 ——
         否则用户只看到「黑屏 + 大图」，看不到「其他图被挤开」 */
      animate={{ opacity: 1, transition: { duration: 0.26, delay: 0.06, ease: [0.2, 0, 0, 1] } }}
      exit={{ opacity: 0, transition: { duration: 0.16, ease: [0.2, 0, 0, 1] } }}
      onClick={onClose}
    >
      {/* 舞台不拦截点击：点空白（舞台留白）就应该关闭 */}
      <div className="overlay-stage" ref={stage}>
        <motion.div
          ref={media}
          key={item.id}
          className="overlay-media"
          style={{
            background: item.color,
            width: size ? `${size.w}px` : undefined,
            height: size ? `${size.h}px` : undefined,
          } as CSSProperties}
          /* 用 keyframes 而不是 initial：initial 只在挂载时生效，
             而那时尺寸还没算出来，会直接以终态出现（FLIP 丢失） */
          initial={false}
          animate={
            flip
              ? {
                  x: [flip.x, 0],
                  y: [flip.y, 0],
                  scaleX: [flip.scaleX, 1],
                  scaleY: [flip.scaleY, 1],
                }
              : { x: 0, y: 0, scaleX: 1, scaleY: 1 }
          }
          transition={SPRING}
          onClick={(e) => e.stopPropagation()}
        >
          {item.kind === "file" ? <span>{item.originalName??item.name}</span> : item.kind === "video" && fullSrc ? (
            <VideoPlayer src={fullSrc} />
          ) : item.src || fullSrc ? (
            <img className="overlay-img" src={fullSrc ?? item.src} alt="" draggable={false} />
          ) : null}
        </motion.div>
      </div>

      <motion.aside
        className="overlay-panel"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 12 }}
        transition={SPRING}
      >
        <div className="panel-head">
          <h2>{item.name}</h2>
          <span className="panel-index">
            {index + 1} / {total}
          </span>
        </div>

        <dl className="panel-meta">
          <div><dt>尺寸</dt><dd>{item.size}</dd></div>
          <div><dt>类型</dt><dd>{item.kind === "video" ? `视频 ${item.duration ?? ""}` : item.kind === "link" ? "链接" : item.kind==="file"?"文件":"图片"}</dd></div>
          {item.site ? <div><dt>来源</dt><dd>{item.site}</dd></div> : null}
        </dl>

        <FileMetadata key={item.id} item={item} tags={tags} onSave={onSaveMetadata} onSimilarColor={onSimilarColor}/>

        <div className="panel-hint">
          <kbd>Esc</kbd> 关闭 · <kbd>←</kbd> <kbd>→</kbd> 切换 · <kbd>Space</kbd> 打开
        </div>
      </motion.aside>
    </motion.div>
  );
}
