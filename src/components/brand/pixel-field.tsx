import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

/** Cell roles from the brand's hero shader; colours come from the active theme's --px-* tokens. */
export type Tone = "base" | "light" | "olive" | "trail" | "warm";

const toneVar: Record<Tone, string> = {
  base: "var(--px-base)", light: "var(--px-light)", olive: "var(--px-olive)", trail: "var(--px-olive)", warm: "var(--px-warm)",
};

function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function bump(x: number, y: number, cx: number, cy: number, spread: number) {
  return Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / spread);
}

/** Deterministic mosaic: base columns broken by light runs, olive clusters, a checkered trail and warm blocks. */
export function toneAt(col: number, row: number, cols: number, rows: number, seed: number): Tone {
  const x = col / Math.max(1, cols - 1);
  const y = row / Math.max(1, rows - 1);
  const trail = bump(x, y, 0.6, 0.12, 0.012) + bump(x, y, 0.88, 0.05, 0.012);
  const warm = bump(x, y, 0.06, 0.9, 0.03) + bump(x, y, 0.93, 0.5, 0.025);
  if (hash(col, row, seed + 3) < trail * 0.8) return "trail";
  if (hash(col, row, seed + 7) < warm * 0.8) return "warm";
  if (hash(col, row, seed + 11) < warm * 0.35) return "olive";
  const run = hash(col, Math.floor(row / 3), seed);
  if (run < 0.14 + (1 - y) * 0.18) return "light";
  return "base";
}

const palette: Record<string, string> = { base: "--px-base", light: "--px-light", dark: "--px-dark", olive: "--px-olive", warm: "--px-warm" };

export function PixelField({ cols, rows, seed = 1, cell = 22, className, children }: {
  cols: number; rows: number; seed?: number; cell?: number; className?: string; children?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const base = useMemo(() => Array.from({ length: cols * rows }, (_, index) =>
    toneAt(index % cols, Math.floor(index / cols), cols, rows, seed)), [cols, rows, seed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const tones = [...base];
    let colors = {} as Record<string, string>;
    let width = 0;
    const readColors = () => {
      const style = getComputedStyle(canvas);
      colors = Object.fromEntries(Object.entries(palette).map(([tone, name]) => [tone, style.getPropertyValue(name).trim()]));
    };
    const paintCell = (index: number) => {
      const step = width / cols;
      const x = (index % cols) * step, y = Math.floor(index / cols) * cell;
      const tone = tones[index];
      context.fillStyle = colors[tone === "trail" ? "base" : tone];
      context.fillRect(x, y, step, cell);
      if (tone === "trail") {
        // Trail cells: an olive tile inset from the grid, holding a small dark square.
        const inset = cell * 0.12, inner = cell * 0.42;
        context.fillStyle = colors.olive;
        context.fillRect(x + inset, y + inset, step - inset * 2, cell - inset * 2);
        context.fillStyle = colors.warm;
        context.fillRect(x + (step - inner) / 2, y + (cell - inner) / 2, inner, inner);
      }
      context.fillStyle = colors.olive;
      context.globalAlpha = 0.7;
      context.fillRect(Math.round(x + step) - 1, y, 1, cell);
      context.globalAlpha = 1;
    };
    const paint = () => {
      const ratio = window.devicePixelRatio || 1;
      width = canvas.clientWidth;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(rows * cell * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      readColors();
      for (let index = 0; index < tones.length; index++) paintCell(index);
    };
    paint();
    const resize = new ResizeObserver(() => { if (canvas.clientWidth !== width) paint(); });
    resize.observe(canvas);
    const theme = new MutationObserver(paint);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    let tick = 0;
    const timer = reduce ? 0 : window.setInterval(() => {
      if (document.hidden) return;
      tick++;
      for (let i = 0; i < Math.ceil(tones.length / 60); i++) {
        const index = Math.floor(hash(tick, i, seed) * tones.length);
        const tone = tones[index];
        if (tone !== "base" && tone !== "light") continue;
        tones[index] = tone === "base" ? "light" : "base";
        paintCell(index);
      }
    }, 2400);
    return () => { resize.disconnect(); theme.disconnect(); window.clearInterval(timer); };
  }, [base, cell, cols, reduce, rows, seed]);

  return <div className={cn("relative overflow-hidden", className)} aria-hidden="true">
    <canvas ref={canvasRef} className="block w-full animate-in fade-in duration-150" style={{ height: rows * cell }} />
    {children}
  </div>;
}

export function PixelStrip({ cols = 28, seed = 4, className }: { cols?: number; seed?: number; className?: string }) {
  const tones = useMemo(() => Array.from({ length: cols }, (_, col) => {
    const value = hash(col, 0, seed);
    return value < 0.1 ? "warm" : value < 0.24 ? "olive" : value < 0.42 ? "light" : "base";
  }) as Tone[], [cols, seed]);
  return <div className={cn("flex h-1.5 overflow-hidden", className)} aria-hidden="true">
    {tones.map((tone, index) => <span key={index} className="flex-1 border-r border-[var(--px-olive)]/60" style={{ background: toneVar[tone] }} />)}
  </div>;
}

/** Ronda mark: a ring of pixels with one sky corner, echoing the brand's pixel logo fill. */
export function RondaMark({ className }: { className?: string }) {
  const pattern = [1, 1, 1, 1, 0, 1, 1, 1, 2];
  return <span className={cn("grid size-4 shrink-0 grid-cols-3 gap-px", className)} aria-hidden="true">
    {pattern.map((cell, index) => <span key={index}
      className={cell === 0 ? "" : cell === 2 ? "bg-sky-deep" : "bg-foreground"} />)}
  </span>;
}

/**
 * Ronda mark beside the name, sized by the font size. The mark is as tall as the capitals (0.717em in Newsreader,
 * starting 0.02em below the top of a leading-none line), so its bottom lands on the baseline instead of hanging into
 * the descender space.
 */
export function RondaLockup({ className }: { className?: string }) {
  return <span className={cn("inline-flex items-start gap-[0.36em] font-serif", className)}>
    <RondaMark className="mt-[0.02em] size-[0.717em] gap-[max(1px,0.05em)]" />
    {/* leading-none lives here: a text-size class passed in would otherwise drop it from the wrapper. */}
    <span className="leading-none">Ronda</span>
  </span>;
}
