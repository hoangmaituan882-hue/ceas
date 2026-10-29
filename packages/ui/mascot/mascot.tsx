import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";

/* ══ 吉祥物 · 眼珠球 ═══════════════════════════════════════════
   一颗带两只眼睛的球，会跟着光标看。

   眼睛贴在球面上，不是浮在球前面的贴纸：视线转向左边，
   整颗球跟着转，一只眼睛沿球面滑出去、被压窄，另一只反向
   张开。这个透视收缩是它看起来"圆"的全部原因，不是装饰。

   姿态（yaw/pitch）是唯一状态，两只眼睛都从它算出来，所以
   永远不会自相矛盾；指针离开窗口就回正，隔几秒自己眨一下。

   每帧直接写 DOM，不走 state —— 指针移动不是一次渲染。
   ------------------------------------------------------------ */

const R = 50; // 100 单位 viewBox 里的球半径
const TILT = 64; // 看向斜角时这一对眼睛的倾斜度数

type EyeSize = { w: number; h: number; r: number };

const EYE_STYLES: Record<string, EyeSize> = {
  Slant: { w: 9, h: 15, r: 4.5 },
  Dots: { w: 11, h: 11, r: 5.5 },
  Squares: { w: 12, h: 12, r: 3.5 },
};

const SHAPES: Record<string, string> = {
  Cube:
    "M30 6 H70 A24 24 0 0 1 94 30 V70 A24 24 0 0 1 70 94 H30 A24 24 0 0 1 6 70 V30 A24 24 0 0 1 30 6 Z",
  Ball: "M50 0 A50 50 0 1 1 49.99 0 Z",
  Pitch: "M34 17 H66 A33 33 0 0 1 66 83 H34 A33 33 0 0 1 34 17 Z",
};

const LINES = [
  "嘿，我看见你了。",
  "啵。",
  "痒。",
  "又存素材呀。",
  "别戳了。",
  "我在看着你。",
  "找到我了。",
];

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const stillMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export type MascotProps = {
  /** 边长，px，16–180 */
  size?: number;
  /** 身体轮廓 */
  shape?: "Cube" | "Ball" | "Pitch";
  /** 眼型；auto 会在 32px 以下自动换成圆点眼，避免糊成一条线 */
  eyes?: "auto" | "Slant" | "Dots" | "Squares";
  /** 追随指针的强度 0–100 */
  follow?: number;
  /** 回弹的松紧 0–100 */
  bounce?: number;
  /** 不跟随指针：直视前方，每 5 秒瞥一眼，每 2 秒眨一次 */
  idle?: boolean;
  /** 点一下会说一句 */
  chatter?: boolean;
  /** ink = 近黑身体白眼；paper = 浅色身体墨眼 */
  tone?: "ink" | "paper";
  /** 只在哪个容器内注视，默认 [data-mascot-frame]，再退回自身 */
  within?: string;
};

export function Mascot({
  size = 96,
  shape = "Cube",
  eyes = "auto",
  follow = 60,
  bounce = 30,
  idle = false,
  chatter = false,
  tone = "ink",
  within,
}: MascotProps) {
  const s = clamp(size, 16, 180);
  const eyeStyle = eyes === "auto" ? (s < 32 ? "Dots" : "Slant") : eyes;
  const base: EyeSize = EYE_STYLES[eyeStyle] ?? { w: 9, h: 15, r: 4.5 };

  const still = stillMotion();
  const box = useRef<HTMLDivElement>(null);
  const eyes0 = useRef<(SVGGElement | null)[]>([]);
  const knobs = useRef({ follow, bounce });
  knobs.current = { follow, bounce };

  const [line, setLine] = useState("");
  const [talking, setTalking] = useState(false);
  const run = useRef(0);

  useEffect(() => () => void run.current++, []);

  /* ── 点一下说一句：逐字打出来，读一会儿，收起来 ───────── */
  const poke = async () => {
    if (idle || !chatter) return;
    const mine = ++run.current;
    const text = LINES[Math.floor(Math.random() * LINES.length)] ?? "啵。";
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    setLine("");
    setTalking(true);
    for (let k = 1; k <= text.length; k++) {
      await wait(38 + Math.random() * 30);
      if (mine !== run.current) return;
      setLine(text.slice(0, k));
    }
    await wait(1500);
    if (mine !== run.current) return;
    setTalking(false);
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;

    /* 脸在球面上的位置（半径的比例）、速度、目标 —— 一条弹簧，
       画的时候换算成转角 */
    const t = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
    let raf = 0;
    let prev = 0;
    let parked = false;
    let wakeIn = 0;
    let seen = true;
    let nextBlink = performance.now() + 2200;
    let blinkAt = -1e9;

    const draw = (now: number) => {
      /* 眨眼 160ms 一闭一开，靠压扁眼睛实现 */
      if (now > nextBlink) {
        blinkAt = now;
        nextBlink = now + (idle ? 2000 : 2600 + Math.random() * 3200);
      }
      const since = now - blinkAt;
      const lid = since < 160 ? 1 - 0.9 * Math.sin((since / 160) * Math.PI) : 1;

      const as = (v: number) => Math.asin(clamp(v, -0.92, 0.92));
      const yaw = as(t.x);
      const pitch = -as(t.y);
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);
      /* 斜着看时这一对眼睛会侧倾，正着看时是平的 */
      const tilt = TILT * t.x * t.y;
      const gap = 0.19;

      [-gap, gap].forEach((x0, i) => {
        const g = eyes0.current[i];
        if (!g) return;
        /* 把眼睛当成球面上的一个点，跟着球一起转 */
        const z0 = Math.sqrt(1 - x0 * x0);
        const x1 = x0 * cy + z0 * sy;
        const z1 = -x0 * sy + z0 * cy;
        const y2 = -z1 * sp;
        const z2 = z1 * cp;
        /* 靠近边缘的那只离你更远：整体更小，横向上更窄 */
        const near = clamp(z2, 0, 1);
        const k = 0.45 + 0.55 * near;
        const sx = k * (0.7 + 0.3 * near);

        /* 尺寸直接写成宽高，不用 scale —— scale 会把圆角也拉成
           椭圆，眨眼和透视时两只眼的圆角会不一致 */
        const w = base.w * sx;
        const h = Math.max(0.6, base.h * k * lid);
        const rect = g.firstElementChild as SVGRectElement | null;
        if (rect) {
          rect.setAttribute("x", (-w / 2).toFixed(2));
          rect.setAttribute("y", (-h / 2).toFixed(2));
          rect.setAttribute("width", w.toFixed(2));
          rect.setAttribute("height", h.toFixed(2));
          rect.setAttribute("rx", Math.min(base.r, w / 2, h / 2).toFixed(2));
        }
        g.setAttribute(
          "transform",
          `translate(${(50 + x1 * R).toFixed(2)} ${(50 + y2 * R).toFixed(2)}) rotate(${tilt.toFixed(2)})`,
        );
        g.style.opacity = z2 < 0.05 ? "0" : "1";
      });
    };

    /* ── 停帧 ───────────────────────────────────────────────
       原实现里 tick 每帧都重新排一次 rAF，等于一颗常驻 60fps
       的动画。这里在收敛后真正停下来，只在下一次眨眼之前把自
       己唤醒；指针一动也会唤醒。 */
    const settled = () =>
      Math.abs(t.x - t.tx) < 0.002 &&
      Math.abs(t.y - t.ty) < 0.002 &&
      Math.abs(t.vx) < 0.002 &&
      Math.abs(t.vy) < 0.002;

    const tick = (now: number) => {
      if (!seen || document.hidden) {
        raf = 0;
        prev = 0;
        return;
      }
      const dt = prev ? Math.min(2.5, (now - prev) / 16.67) : 1;
      prev = now;

      if (still) {
        t.x = t.tx;
        t.y = t.ty;
      } else {
        const k = 0.06;
        const d = 0.34 - (clamp(knobs.current.bounce, 0, 100) / 100) * 0.22;
        t.vx += ((t.tx - t.x) * k - t.vx * d) * dt;
        t.vy += ((t.ty - t.y) * k - t.vy * d) * dt;
        t.x += t.vx * dt;
        t.y += t.vy * dt;
      }

      draw(now);

      /* 降低动效：画出一帧就停，指针变化时由 wake 再唤醒一次 */
      if (still) {
        raf = 0;
        prev = 0;
        return;
      }

      const blinkingSoon = now > nextBlink - 48;
      if (!still && settled() && !blinkingSoon) {
        parked = true;
        prev = 0;
        raf = 0;
        wakeIn = window.setTimeout(wake, Math.max(80, nextBlink - now));
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const wake = () => {
      window.clearTimeout(wakeIn);
      if (raf || !seen || document.hidden) return;
      parked = false;
      prev = 0;
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    /* 离开视口或切到后台就停，回来立刻续上 */
    const resume = () => { if (!raf && !parked && seen && !document.hidden) wake(); };
    const io = new IntersectionObserver((entries) => {
      seen = !!entries[0]?.isIntersecting;
      if (seen) wake(); else { cancelAnimationFrame(raf); raf = 0; prev = 0; }
    });
    io.observe(el);
    document.addEventListener("visibilitychange", resume);

    /* ── 脸跟着你走 ─────────────────────────────────────────
       指针在哪个容器里，就在哪个容器里追；离开容器立刻回正 ——
       一墙的吉祥物同时跟着一个路过的光标会变成噪音。 */
    const frame =
      (within ? el.closest<HTMLElement>(within) : null) ??
      el.closest<HTMLElement>("[data-mascot-frame]") ??
      el;

    const aim = (e: PointerEvent) => {
      const f = frame.getBoundingClientRect();
      if (e.clientX < f.left || e.clientX > f.right || e.clientY < f.top || e.clientY > f.bottom) {
        t.tx = 0;
        t.ty = 0;
        wake();
        return;
      }
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.max(60, Math.min(f.width, f.height) * 0.28);
      const far = Math.min(
        0.85,
        Math.tanh(dist / reach) * (clamp(knobs.current.follow, 0, 100) / 100) * 1.5,
      );
      t.tx = (dx / dist) * far;
      t.ty = (dy / dist) * far;
      wake();
    };
    const rest = () => { t.tx = 0; t.ty = 0; wake(); };

    /* ── idle：直视前方，每 5 秒瞥一眼 ──────────────────── */
    let glance = 0;
    if (idle) {
      const look = () => {
        const a = Math.random() * Math.PI * 2;
        const far = 0.45 + Math.random() * 0.25;
        t.tx = Math.cos(a) * far;
        t.ty = Math.sin(a) * far;
        wake();
        glance = window.setTimeout(() => {
          rest();
          glance = window.setTimeout(look, 4100);
        }, 900);
      };
      glance = window.setTimeout(look, 5000);
    } else {
      window.addEventListener("pointermove", aim, { passive: true });
      document.documentElement.addEventListener("pointerleave", rest);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(wakeIn);
      window.clearTimeout(glance);
      io.disconnect();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pointermove", aim);
      document.documentElement.removeEventListener("pointerleave", rest);
    };
  }, [still, idle, within, base.h, base.r, base.w]);

  const clipId = `eyt-${useId().replace(/:/g, "")}`;
  const body = SHAPES[shape] ?? SHAPES.Cube;

  return (
    <div className="eyt" ref={box} data-tone={tone} style={{ "--eyt-size": `${s}px` } as CSSProperties}>
      <svg
        className="eyt-ball"
        viewBox="0 0 100 100"
        role="img"
        aria-label="会跟着光标看的吉祥物"
        data-poke={!idle && chatter ? true : undefined}
        onClick={poke}
      >
        <defs>
          <clipPath id={clipId}>
            <path d={body} />
          </clipPath>
        </defs>
        <path className="eyt-body" d={body} />
        <g clipPath={`url(#${clipId})`}>
          {[0, 1].map((i) => (
            <g key={i} ref={(n) => { eyes0.current[i] = n; }}>
              <rect
                className="eyt-eye"
                x={-base.w / 2}
                y={-base.h / 2}
                width={base.w}
                height={base.h}
                rx={base.r}
              />
            </g>
          ))}
        </g>
      </svg>
      {chatter && !idle ? (
        <span className="eyt-say" data-on={talking || undefined} aria-live="polite">
          <span>{line}</span>
          <span className="eyt-caret" />
        </span>
      ) : null}
    </div>
  );
}
