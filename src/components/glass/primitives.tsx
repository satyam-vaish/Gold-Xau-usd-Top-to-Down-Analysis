"use client";

/**
 * Glassmorphism UI primitives — monochromatic design system components.
 */
import { motion } from "framer-motion";
import { type ReactNode, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Panel / Card
// ---------------------------------------------------------------------------

export function GlassPanel({
  children, className, strong, hover, delay = 0,
}: { children: ReactNode; className?: string; strong?: boolean; hover?: boolean; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(strong ? "glass-strong" : "glass", hover && "glass-hover", className)}
    >
      {children}
    </motion.div>
  );
}

export function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div>
        <h3 className="text-[13px] font-semibold tracking-[0.14em] uppercase text-zinc-200">{title}</h3>
        {subtitle ? <p className="text-[11px] text-zinc-500 mt-0.5 max-w-xl">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const map: Record<string, string> = {
    LIVE: "border-zinc-300/40 text-zinc-100 bg-zinc-100/10",
    DELAYED: "border-zinc-400/30 text-zinc-300 bg-zinc-100/5",
    DEMO: "border-zinc-500/40 text-zinc-400 bg-zinc-500/10",
    ESTIMATED: "border-zinc-500/40 text-zinc-400 bg-zinc-500/10",
    UNAVAILABLE: "border-zinc-600/40 text-zinc-500 bg-zinc-600/10",
    PROXY: "border-zinc-400/30 text-zinc-300 bg-zinc-100/5",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] uppercase", map[status] ?? map.DELAYED, className)}>
      {status}
    </span>
  );
}

export function DirectionBadge({ dir, className }: { dir: string; className?: string }) {
  const bull = /BULL|LONG|BUY|WIN/i.test(dir);
  const bear = /BEAR|SHORT|SELL|LOSS/i.test(dir);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-[0.1em]",
        bull && "border-zinc-200/50 bg-zinc-100/15 text-zinc-50",
        bear && "border-zinc-500/40 bg-zinc-500/15 text-zinc-300",
        !bull && !bear && "border-zinc-600/40 bg-zinc-600/10 text-zinc-400",
        className,
      )}
    >
      {dir.replace(/_/g, " ")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export function PriceCell({ value, digits = 2, className }: { value: number | null | undefined; digits?: number; className?: string }) {
  if (value === null || value === undefined) return <span className="text-zinc-600 num">—</span>;
  return <span className={cn("num", className)}>{value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}</span>;
}

export function DeltaCell({ value, digits = 2, suffix = "%" }: { value: number | null | undefined; digits?: number; suffix?: string }) {
  if (value === null || value === undefined) return <span className="text-zinc-600 num">—</span>;
  const positive = value >= 0;
  return (
    <span className={cn("num text-[11px]", positive ? "text-zinc-100" : "text-zinc-400")}>
      {positive ? "+" : ""}{value.toFixed(digits)}{suffix}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

export function StatCard({
  label, value, sub, status, right, children, className, delay,
}: {
  label: string; value?: ReactNode; sub?: ReactNode; status?: string; right?: ReactNode; children?: ReactNode; className?: string; delay?: number;
}) {
  return (
    <GlassPanel hover delay={delay} className={cn("p-4 flex flex-col gap-1.5 min-h-[92px]", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium tracking-[0.16em] uppercase text-zinc-500">{label}</span>
        <div className="flex items-center gap-1.5">
          {status ? <StatusBadge status={status} /> : null}
          {right}
        </div>
      </div>
      {value !== undefined ? <div className="text-lg leading-tight font-semibold text-zinc-50 num">{value}</div> : null}
      {sub ? <div className="text-[11px] text-zinc-500">{sub}</div> : null}
      {children}
    </GlassPanel>
  );
}

// ---------------------------------------------------------------------------
// Probability bar (tri-part)
// ---------------------------------------------------------------------------

export function ProbabilityBar({ bull, bear, neutral, className }: { bull: number; bear: number; neutral: number; className?: string }) {
  const b = Math.round(bull * 100), r = Math.round(bear * 100), n = Math.max(0, 100 - b - r);
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex h-2 overflow-hidden rounded-full bg-zinc-800/70">
        <div className="bg-zinc-100" style={{ width: `${b}%` }} />
        <div className="bg-zinc-500" style={{ width: `${n}%` }} />
        <div className="bg-zinc-700" style={{ width: `${r}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-zinc-500 num">
        <span className="text-zinc-200">Bull {b}%</span>
        <span>Neutral {n}%</span>
        <span>Bear {r}%</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meter / score
// ---------------------------------------------------------------------------

export function ScoreMeter({ score, min = -100, max = 100, label }: { score: number; min?: number; max?: number; label?: string }) {
  const pct = ((score - min) / (max - min)) * 100;
  return (
    <div className="space-y-1">
      <div className="relative h-1.5 rounded-full bg-gradient-to-r from-zinc-700 via-zinc-800 to-zinc-700">
        <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-500/60" />
        <motion.div
          className="absolute top-1/2 -translate-y-1/2 -ml-1 h-3 w-2 rounded-sm bg-zinc-100 shadow-[0_0_10px_rgba(255,255,255,0.5)]"
          initial={{ left: "50%" }}
          animate={{ left: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      {label ? <div className="flex justify-between text-[9px] uppercase tracking-widest text-zinc-600"><span>Bearish</span><span>{label}</span><span>Bullish</span></div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KV row + table
// ---------------------------------------------------------------------------

export function KV({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-white/5 last:border-0">
      <span className="text-[11px] text-zinc-500">{k}</span>
      <span className={cn("text-[12px] text-zinc-200 text-right", mono && "num")}>{v ?? "—"}</span>
    </div>
  );
}

export function DataTable({ headers, rows, className }: { headers: string[]; rows: ReactNode[][]; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-[0.14em] text-zinc-600 border-b border-white/10">
            {headers.map((h) => <th key={h} className="py-1.5 pr-3 font-medium whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={headers.length} className="py-4 text-center text-zinc-600">No data</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/[0.03]">
              {r.map((c, j) => <td key={j} className="py-1.5 pr-3 text-zinc-300 whitespace-nowrap">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline (monochrome SVG)
// ---------------------------------------------------------------------------

export function Spark({ data, className, height = 28 }: { data: number[]; className?: string; height?: number }) {
  if (data.length < 2) return <div className={cn("skeleton", className)} style={{ height }} />;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${height - ((v - min) / range) * (height - 4) - 2}`).join(" ");
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className={cn("w-full", className)} style={{ height }}>
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.25)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <polyline points={pts} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
      <polygon points={`0,${height} ${pts} 100,${height}`} fill="url(#sparkFill)" stroke="none" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function SkeletonBlock({ h = 80, className }: { h?: number; className?: string }) {
  return <div className={cn("skeleton", className)} style={{ height: h }} />;
}

export function SkeletonGrid({ count = 4, h = 92, className }: { count?: number; h?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 lg:grid-cols-4 gap-3", className)}>
      {Array.from({ length: count }).map((_, i) => <SkeletonBlock key={i} h={h} />)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle chip
// ---------------------------------------------------------------------------

export function Chip({ active, onClick, children, className, style }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <button
      onClick={onClick}
      style={style}
      className={cn(
        "rounded-lg border px-2.5 py-1 text-[10px] font-medium tracking-wide transition-all",
        active
          ? "border-zinc-200/60 bg-zinc-100/15 text-zinc-50 shadow-[0_0_12px_rgba(255,255,255,0.12)]"
          : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-zinc-200",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Disclaimer
// ---------------------------------------------------------------------------

export function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={cn("text-[9.5px] leading-relaxed text-zinc-600", className)}>
      AI outputs are analytical estimates, not guaranteed financial advice. Data statuses (LIVE / DELAYED / DEMO / PROXY) are labelled on every module.
    </p>
  );
}
