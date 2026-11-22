import { useEffect, useRef } from "react";

/**
 * "Constellation" backdrop behind every screen: warm glowing dots drift slowly and are
 * joined by fine lines when close; dots near the cursor are gently pulled towards it and
 * link to it. Decorative only – aria-hidden, no pointer events, pauses when the tab is
 * hidden and draws a single still frame when the user prefers reduced motion.
 */
export function AnimatedBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <ConstellationBackground />
    </div>
  );
}

export const isDark = () => document.documentElement.classList.contains("dark");
export const prefersStill = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Run a draw(t, dt) loop that pauses when hidden and draws once under reduced motion. */
export function useLoop(draw: (t: number, dt: number) => void, setup: () => void, deps: unknown[] = []) {
  useEffect(() => {
    let raf = 0, last = performance.now();
    const start = last;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      draw((now - start) / 1000, dt);
      if (!prefersStill()) raf = requestAnimationFrame(frame);
    };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !prefersStill()) { last = performance.now(); raf = requestAnimationFrame(frame); }
    };
    const onResize = () => { setup(); if (prefersStill()) draw(0, 0); };
    setup();
    frame(performance.now());
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); document.removeEventListener("visibilitychange", onVis); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`;

export function Grain({ strength = 1 }: { strength?: number }) {
  return <div className="absolute inset-0 mix-blend-overlay" style={{ backgroundImage: GRAIN, opacity: 0.06 * strength }} />;
}

export function Vignette() {
  return <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_20%,transparent_45%,rgba(255,250,245,.6)_100%)] dark:bg-[radial-gradient(ellipse_at_50%_20%,transparent_40%,rgba(22,11,20,.8)_100%)]" />;
}

/** Track canvas size with devicePixelRatio scaling. */
function fitCanvas(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  c.width = w * dpr; c.height = h * dpr;
  c.style.width = `${w}px`; c.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

const mouse = { x: -9999, y: -9999 };
if (typeof window !== "undefined") {
  window.addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  window.addEventListener("pointerleave", () => { mouse.x = -9999; mouse.y = -9999; });
}

/* ---------------------------------------------------------------- constellation */
export function ConstellationBackground() {
  const ref = useRef<HTMLCanvasElement>(null);
  const s = useRef({ w: 0, h: 0, pts: [] as { x: number; y: number; vx: number; vy: number; r: number; hue: number }[] });
  useLoop((_t, dt) => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d")!; const st = s.current; const dark = isDark();
    ctx.clearRect(0, 0, st.w, st.h);
    const glow = ctx.createRadialGradient(st.w * 0.5, st.h * 0.15, 0, st.w * 0.5, st.h * 0.15, Math.max(st.w, st.h) * 0.7);
    glow.addColorStop(0, dark ? "rgba(236,72,153,.16)" : "rgba(251,146,60,.14)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, st.w, st.h);
    const link = Math.min(190, Math.max(120, st.w / 8));
    for (const p of st.pts) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < -20) p.x = st.w + 20; if (p.x > st.w + 20) p.x = -20;
      if (p.y < -20) p.y = st.h + 20; if (p.y > st.h + 20) p.y = -20;
      // gentle pull towards the cursor
      const dx = mouse.x - p.x, dy = mouse.y - p.y, d = Math.hypot(dx, dy);
      if (d < 180 && d > 1) { p.x += (dx / d) * 12 * dt; p.y += (dy / d) * 12 * dt; }
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < st.pts.length; i++) {
      const a = st.pts[i];
      for (let j = i + 1; j < st.pts.length; j++) {
        const b = st.pts[j]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < link) {
          ctx.strokeStyle = `hsla(${(a.hue + b.hue) / 2}, 90%, ${dark ? 70 : 50}%, ${(1 - d / link) * (dark ? 0.55 : 0.42)})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      const dm = Math.hypot(a.x - mouse.x, a.y - mouse.y);
      if (dm < 200) {
        ctx.strokeStyle = `rgba(249,115,22,${(1 - dm / 200) * 0.5})`;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
      }
    }
    for (const p of st.pts) {
      const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
      halo.addColorStop(0, `hsla(${p.hue}, 95%, ${dark ? 72 : 55}%, ${dark ? 0.5 : 0.35})`); halo.addColorStop(1, `hsla(${p.hue}, 95%, 60%, 0)`);
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `hsla(${p.hue}, 95%, ${dark ? 75 : 52}%, ${dark ? 0.95 : 0.85})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  }, () => {
    const c = ref.current; if (!c) return;
    const r = fitCanvas(c);
    const n = Math.round(Math.min(90, (r.w * r.h) / 16000));
    s.current = { w: r.w, h: r.h, pts: Array.from({ length: n }, () => ({
      x: Math.random() * r.w, y: Math.random() * r.h, vx: (Math.random() - 0.5) * 22, vy: (Math.random() - 0.5) * 22,
      r: 1.6 + Math.random() * 2, hue: Math.random() < 0.35 ? 330 : 18 + Math.random() * 25 })) };
  });
  return <><canvas ref={ref} className="absolute inset-0" /><Grain /><Vignette /></>;
}
