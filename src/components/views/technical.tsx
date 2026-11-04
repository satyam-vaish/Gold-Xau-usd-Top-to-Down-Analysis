"use client";

/**
 * Technical Intelligence + ICT/SMC Scanner views.
 */
import { useState } from "react";
import { useApi } from "@/lib/hooks/useData";
import {
  Chip, GlassPanel, SectionTitle, StatusBadge, SkeletonBlock,
  DataTable, KV, Disclaimer, DirectionBadge,
} from "@/components/glass/primitives";

type FullAnalysis = {
  instrument: string;
  price: number;
  structures: Record<string, {
    trend: string; lastEvent: { kind: string; direction: string; price: number; confirmTime: number } | null;
    zone: string; rangeHigh: number; rangeLow: number; equilibrium: number;
    lastLabelHigh: string | null; lastLabelLow: string | null;
    support: number[]; resistance: number[];
  }>;
  mtf: { alignment: string; score: number; summary: string };
  ict: {
    fvg: { top: number; bottom: number; direction: string; filled: boolean; displacement: boolean; inverse: boolean; size: number; time: number }[];
    orderBlocks: { top: number; bottom: number; direction: string; kind: string; broken: boolean; retested: boolean; time: number }[];
    sweeps: { kind: string; time: number; sweepPrice: number; referenceLabel: string; reclaimed: boolean; displacementAfter: boolean }[];
    equalLevels: { kind: string; price: number; count: number }[];
    quasimodo: { direction: string; leftShoulder: { price: number }; head: { price: number }; rightShoulder: { price: number }; neckline: number; breakoutConfirmed: boolean; targets: number[] } | null;
    internalExternal: { external: { high: number; low: number } | null; internal: { high: number; low: number } | null };
    ote: { top: number; bottom: number } | null;
    inOte: boolean;
    displacement: { direction: string; bodyAtr: number; time: number } | null;
    summary: string[];
  };
  fib: {
    anchorHigh: { time: number; price: number }; anchorLow: { time: number; price: number };
    direction: string; levels: { ratio: number; price: number; label: string }[];
    oteZone: { top: number; bottom: number }; inOte: boolean;
    extensionLevels: { ratio: number; price: number; label: string }[];
  };
  vwap: {
    daily: { current: number | null; stdevUpper: number | null; stdevLower: number | null; stdev2Upper: number | null; stdev2Lower: number | null };
    weekly: { current: number | null };
    deviation: { sigma1: number[]; sigma2: number[]; sigma3: number[]; stdev: number };
  };
  profile: { poc: number; vah: number; val: number; hvn: number[]; lvn: number[] };
  volatility: { atr: Record<string, number>; adr: number; stdevDaily: number };
};

const TFS = ["15m", "1h", "4h", "1d"] as const;

export function TechnicalIntelligence() {
  const [instrument, setInstrument] = useState<"XAUUSD" | "GC1!">("GC1!");
  const a = useApi<FullAnalysis>(`/api/analysis/full?instrument=${instrument === "GC1!" ? "gc" : "xauusd"}`, 45000);

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        <Chip active={instrument === "XAUUSD"} onClick={() => setInstrument("XAUUSD")}>XAUUSD</Chip>
        <Chip active={instrument === "GC1!"} onClick={() => setInstrument("GC1!")}>GC1!</Chip>
      </div>

      {/* Multi-timeframe confluence matrix */}
      <GlassPanel className="p-4">
        <SectionTitle
          title="Multi-Timeframe Structure Matrix"
          subtitle="Market structure, trend, BOS/CHoCH/MSS, swing labels, premium/discount — per timeframe"
          right={a.data ? <span className="text-[10px] text-zinc-400 num">{a.data.mtf.summary} ({a.data.mtf.score > 0 ? "+" : ""}{a.data.mtf.score})</span> : null}
        />
        {!a.data ? <SkeletonBlock h={180} /> : (
          <DataTable
            headers={["TF", "Trend", "Last event", "Zone", "HH/LH", "HL/LL", "Range (L…H)", "Equilibrium", "Support", "Resistance"]}
            rows={TFS.map((tf) => {
              const s = a.data!.structures[tf];
              if (!s) return [<span key="x">—</span>];
              return [
                <span key="tf" className="text-zinc-100 font-semibold">{tf.toUpperCase()}</span>,
                <DirectionBadge key="t" dir={s.trend} />,
                s.lastEvent ? `${s.lastEvent.kind} ${s.lastEvent.direction.toLowerCase()} @ ${s.lastEvent.price}` : "—",
                s.zone,
                s.lastLabelHigh ?? "—",
                s.lastLabelLow ?? "—",
                <span key="r" className="num">{s.rangeLow} … {s.rangeHigh}</span>,
                <span key="e" className="num">{s.equilibrium}</span>,
                <span key="s" className="num">{s.support.slice(0, 2).join(" / ") || "—"}</span>,
                <span key="r2" className="num">{s.resistance.slice(0, 2).join(" / ") || "—"}</span>,
              ];
            })}
          />
        )}
      </GlassPanel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* Fibonacci */}
        <GlassPanel className="p-4" delay={0.05}>
          <SectionTitle title="Fibonacci Intelligence" subtitle="Auto-anchored to the dominant impulse leg of the loaded window" right={a.data?.fib.inOte ? <StatusBadge status="IN OTE" /> : null} />
          {!a.data ? <SkeletonBlock h={200} /> : (
            <>
              <div className="grid grid-cols-2 gap-x-6 mb-2">
                <KV k="Anchor high" v={a.data.fib.anchorHigh.price} />
                <KV k="Anchor low" v={a.data.fib.anchorLow.price} />
                <KV k="Impulse direction" v={a.data.fib.direction} />
                <KV k="OTE zone (0.618–0.79)" v={`${a.data.fib.oteZone.bottom} – ${a.data.fib.oteZone.top}`} />
              </div>
              <DataTable
                headers={["Ratio", "Price"]}
                rows={a.data.fib.levels.map((l) => [
                  <span key="r" className={l.ratio === 0.618 || l.ratio === 0.705 || l.ratio === 0.786 ? "text-zinc-100" : ""}>{l.label}</span>,
                  <span key="p" className="num">{l.price}</span>,
                ])}
              />
              <div className="text-[10px] text-zinc-600 mt-2">Extensions: {a.data.fib.extensionLevels.map((e) => `${e.label}=${e.price}`).join(" · ")}</div>
            </>
          )}
        </GlassPanel>

        {/* VWAP + deviation + volume profile */}
        <GlassPanel className="p-4" delay={0.1}>
          <SectionTitle title="VWAP · Standard Deviation · Volume Profile" />
          {!a.data ? <SkeletonBlock h={200} /> : (
            <>
              <div className="grid grid-cols-2 gap-x-6">
                <KV k="Daily VWAP" v={a.data.vwap.daily.current ?? "—"} />
                <KV k="Weekly VWAP" v={a.data.vwap.weekly.current ?? "—"} />
                <KV k="VWAP +1σ / −1σ" v={`${a.data.vwap.daily.stdevUpper ?? "—"} / ${a.data.vwap.daily.stdevLower ?? "—"}`} />
                <KV k="VWAP +2σ / −2σ" v={`${a.data.vwap.daily.stdev2Upper ?? "—"} / ${a.data.vwap.daily.stdev2Lower ?? "—"}`} />
                <KV k="Price σ (40 bars)" v={a.data.vwap.deviation.stdev} />
                <KV k="±3σ bands" v={`${a.data.vwap.deviation.sigma3[0]} / ${a.data.vwap.deviation.sigma3[1]}`} />
              </div>
              <div className="mt-3 pt-3 border-t border-white/5">
                <div className="grid grid-cols-3 gap-3">
                  <KV k="POC" v={a.data.profile.poc} />
                  <KV k="VAH" v={a.data.profile.vah} />
                  <KV k="VAL" v={a.data.profile.val} />
                </div>
                <KV k="High-volume nodes" v={a.data.profile.hvn.slice(0, 5).join(" · ") || "—"} />
                <KV k="Low-volume nodes" v={a.data.profile.lvn.slice(0, 5).join(" · ") || "—"} />
                <KV k="ATR 1h / 1d" v={`${a.data.volatility.atr["1h"]} / ${a.data.volatility.atr["1d"]}`} />
              </div>
            </>
          )}
        </GlassPanel>
      </div>
      <Disclaimer />
    </div>
  );
}

export function IctScanner() {
  const [instrument, setInstrument] = useState<"XAUUSD" | "GC1!">("GC1!");
  const [minSize, setMinSize] = useState(0);
  const a = useApi<FullAnalysis>(`/api/analysis/full?instrument=${instrument === "GC1!" ? "gc" : "xauusd"}`, 45000);
  const [confirmSweep, setConfirmSweep] = useState(true);

  const fvg = (a.data?.ict.fvg ?? []).filter((f) => f.size >= minSize && (!confirmSweep || !f.filled));
  const sweeps = (a.data?.ict.sweeps ?? []).filter((s) => !confirmSweep || s.reclaimed);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 items-center">
        <Chip active={instrument === "XAUUSD"} onClick={() => setInstrument("XAUUSD")}>XAUUSD</Chip>
        <Chip active={instrument === "GC1!"} onClick={() => setInstrument("GC1!")}>GC1!</Chip>
        <span className="w-px h-5 bg-white/10 mx-1" />
        <Chip active={confirmSweep} onClick={() => setConfirmSweep((v) => !v)}>Confirmation filter (unfilled / reclaimed only)</Chip>
        <span className="text-[10px] text-zinc-600">Min FVG size $</span>
        {[0, 0.5, 1, 2].map((s) => <Chip key={s} active={minSize === s} onClick={() => setMinSize(s)}>{s.toFixed(1)}</Chip>)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <GlassPanel className="p-4">
          <SectionTitle title="Fair Value Gaps (FVG / IFVG)" subtitle={`Displacement-filtered, auto-mitigation tracking — ${fvg.length} zones`} />
          <DataTable
            headers={["Direction", "Zone", "Size", "Formed (UTC)", "Displacement", "State"]}
            rows={fvg.slice(-12).reverse().map((f, i) => [
              <DirectionBadge key={i} dir={f.direction} />,
              <span key="z" className="num">{f.bottom} – {f.top}</span>,
              <span key="s" className="num">${f.size.toFixed(2)}</span>,
              new Date(f.time * 1000).toISOString().slice(5, 16).replace("T", " "),
              f.displacement ? "yes" : "no",
              f.inverse ? "IFVG (inverted)" : f.filled ? "filled" : "open",
            ])}
          />
        </GlassPanel>

        <GlassPanel className="p-4" delay={0.05}>
          <SectionTitle title="Order Blocks · Breakers · Mitigation · Rejection" subtitle={`${(a.data?.ict.orderBlocks ?? []).length} zones detected on 15m`} />
          <div className="max-h-64 overflow-y-auto pr-1">
            <DataTable
              headers={["Type", "Direction", "Zone", "Broken", "Retested"]}
              rows={(a.data?.ict.orderBlocks ?? []).slice(-12).reverse().map((o, i) => [
                o.kind.replace("_", " "),
                <DirectionBadge key={i} dir={o.direction} />,
                <span key="z" className="num">{o.bottom} – {o.top}</span>,
                o.broken ? "yes" : "no",
                o.retested ? "yes" : "no",
              ])}
            />
          </div>
        </GlassPanel>

        <GlassPanel className="p-4" delay={0.1}>
          <SectionTitle title="Liquidity Sweeps" subtitle="Wick-through + close-back detection with reclaim & displacement flags" />
          <DataTable
            headers={["Kind", "Swept", "Reference", "Reclaimed", "Displacement", "Time (UTC)"]}
            rows={sweeps.slice(-8).reverse().map((s, i) => [
              <span key={i} className={s.kind === "BSL_SWEEP" ? "text-zinc-100" : "text-zinc-400"}>{s.kind.replace("_", " ")}</span>,
              <span key="p" className="num">{s.sweepPrice}</span>,
              <span key="r" className="text-zinc-500">{s.referenceLabel}</span>,
              s.reclaimed ? "yes" : "no",
              s.displacementAfter ? "yes" : "no",
              new Date(s.time * 1000).toISOString().slice(5, 16).replace("T", " "),
            ])}
          />
        </GlassPanel>

        <GlassPanel className="p-4" delay={0.15}>
          <SectionTitle title="Equal Highs / Lows · Internal & External · Quasimodo" />
          <DataTable
            headers={["Kind", "Price", "Touches"]}
            rows={(a.data?.ict.equalLevels ?? []).map((e, i) => [
              e.kind,
              <span key={i} className="num">{e.price}</span>,
              e.count,
            ])}
          />
          <div className="grid grid-cols-2 gap-x-6 mt-3">
            <KV k="External range" v={a.data?.ict.internalExternal.external ? `${a.data.ict.internalExternal.external.low} – ${a.data.ict.internalExternal.external.high}` : "—"} />
            <KV k="Internal range" v={a.data?.ict.internalExternal.internal ? `${a.data.ict.internalExternal.internal.low} – ${a.data.ict.internalExternal.internal.high}` : "—"} />
          </div>
          {a.data?.ict.quasimodo ? (
            <div className="mt-3 p-3 glass-subtle">
              <div className="flex items-center gap-2 mb-1.5">
                <DirectionBadge dir={a.data.ict.quasimodo.direction} />
                <span className="text-[11px] text-zinc-300">Quasimodo — neckline {a.data.ict.quasimodo.neckline}</span>
              </div>
              <div className="text-[10.5px] text-zinc-500">
                LS {a.data.ict.quasimodo.leftShoulder.price} · Head {a.data.ict.quasimodo.head.price} · RS {a.data.ict.quasimodo.rightShoulder.price} ·
                breakout {a.data.ict.quasimodo.breakoutConfirmed ? "confirmed" : "pending"} · targets {a.data.ict.quasimodo.targets.join(" → ")}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-600 mt-3">No completed Quasimodo structure on the current 15m window.</p>
          )}
          {a.data?.ict.displacement ? (
            <KV k="Latest displacement" v={`${a.data.ict.displacement.direction} · ${a.data.ict.displacement.bodyAtr}× ATR body`} />
          ) : null}
        </GlassPanel>
      </div>
      <Disclaimer />
    </div>
  );
}
