import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/* ══ 视频播放器 ══════════════════════════════════════════════
   不用原生 controls：那套 UI 和产品气质完全不搭（灰底、圆角、
   系统字体），而且没法跟随密度。
   这里只做三件事：播放/暂停、进度条拖拽、时间读数。

   播放图标暂用内联 SVG —— 图标生成器（scripts/gen-icons.mjs）
   需要起进程，等环境恢复后把 Play/Pause 加进 PICK 再换成官方图标。
   ------------------------------------------------------------ */

type Props = { src: string };

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VideoPlayer({ src }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onTime = () => setTime(v.currentTime);
    const onMeta = () => setDur(Number.isFinite(v.duration) ? v.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onPause);
    };
  }, [src]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };

  const seekTo = (clientX: number) => {
    const v = ref.current;
    const el = bar.current;
    if (!v || !el || dur <= 0) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    v.currentTime = ratio * dur;
    setTime(v.currentTime);
  };

  const onBarDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  };

  const pct = dur > 0 ? Math.min(100, (time / dur) * 100) : 0;

  return (
    <div className="player" onClick={(e) => e.stopPropagation()}>
      <video
        ref={ref}
        className="player-video"
        src={src}
        playsInline
        preload="metadata"
        onClick={toggle}
      />

      <div className="player-controls">
        <button type="button" className="player-toggle" onClick={toggle} aria-label={playing ? "暂停" : "播放"}>
          {playing ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <rect x="7" y="5" width="3.4" height="14" rx="1" />
              <rect x="13.6" y="5" width="3.4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M8 5.2c0-.8.9-1.3 1.6-.9l9 6.8c.6.4.6 1.4 0 1.8l-9 6.8c-.7.4-1.6-.1-1.6-.9z" />
            </svg>
          )}
        </button>

        <div
          ref={bar}
          className="player-track"
          onPointerDown={onBarDown}
          onPointerMove={(e) => {
            if (e.buttons === 1) seekTo(e.clientX);
          }}
          role="slider"
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(time)}
          tabIndex={0}
          onKeyDown={(e) => {
            const v = ref.current;
            if (!v) return;
            if (e.key === "ArrowRight") { e.preventDefault(); v.currentTime = Math.min(dur, v.currentTime + 2); }
            if (e.key === "ArrowLeft") { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 2); }
          }}
        >
          <span className="player-fill" style={{ width: `${pct}%` }} />
          <span className="player-knob" style={{ left: `${pct}%` }} />
        </div>

        <span className="player-time">
          {fmt(time)} / {fmt(dur)}
        </span>
      </div>
    </div>
  );
}
