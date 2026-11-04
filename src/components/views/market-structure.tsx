"use client";

/**
 * Liquidity Intelligence, Liquidity Heatmap, Session Intelligence,
 * Volatility Intelligence, Order Flow Analysis views.
 */
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useApi } from "@/lib/hooks/useData";
import {
  Chip, GlassPanel, SectionTitle, StatCard, StatusBadge, SkeletonBlock,
  DataTable, KV, Disclaimer, DirectionBadge, PriceCell, DeltaCell,
} from "@/components/glass/primitives";

type Full = {
  instrument: string;
  price: number;
  liquidity: {
    basis: string;
    nearestBsl: { label: string; price: number; distance: number; distancePct: number; strength: number } | null;
    nearestSsl: { label: string; price: number; distance: number; distancePct: number; strength: number } | null;
    likelyTarget: { label: string; price: number; side: string; strength: number; distancePct: number } | null;
    targetConfidence: number;
    sweepZone: { top: number; bottom: number; side: string } | null;
    consumed: { label: string; price: number; side: string }[];
    pools: { id: string; side: string; kind: string; label: string; price: number; distance: number; distancePct: number; strength: number; status: string }[];
    recentSweeps: { kind: string; sweepPrice: number; referenceLabel: string; reclaimed: boolean; time: number }[];
    potentialReversalZone: { top: number; bottom: number } | null;
  };
  heatmap: { levels: { price: number; buyIntensity: number; sellIntensity: number; executedVolume: number; basis: string }[]; dataBasis: string; note: string };
  sessions: { name: string; short: string; isOpen: boolean; high: number | null; low: number | null; range: number | null; openingRange: { high: number; low: number } | null; openTime: string; closeTime: string }[];
  sessionStats: { key: string; label: string; avgRange: number; medianRange: number; sweepAsianHighPct: number; sweepAsianLowPct: number; displacementPct: number; continuationPct: number; reversalPct: number; samples: number }[];
  openings: { midnightOpen: number | null; openingRange30: { high: number; low: number } | null; openingRange60: { high: number; low: number } | null };
  volatility: { atr: Record<string, number>; adr: number; adrPct: number; awr: number; dailyRange: number; rangeConsumedPct: number; remainingRange: number; historicalVolAnnual: number; hvPercentile: number; regime: string; expansion: boolean; contraction: boolean; stdevDaily: number; sessionVol: Record<string, number>; newsDrivenVol: number | null };
  orderFlow: {
    buyerPct: number; sellerPct: number; delta: number; cvd: number; dataBasis: string;
    aggressiveBuying: boolean; aggressiveSelling: boolean;
    stackedImbalances: { side: string; count: number; time: number }[];
    absorption: { side: string; time: number; note: string } | null;
    divergence: { kind: string | null; note: string };
    series: { time: number; buyVolume: number; sellVolume: number; delta: number; cvd: number }[];
  };
};

function InstrumentPicker({ value, onChange }: { value: string; onChange: (v: "XAUUSD" | "GC1!") => void }) {
  return (
    <div className="flex gap-1.5">
      <Chip active={value === "XAUUSD"} onClick={() => onChange("XAUUSD")}>XAUUSD</Chip>
      <Chip active={value === "GC1!"} onClick={() => onChange("GC1!")}>GC1!</Chip>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function LiquidityIntelligence() {
  const [instrument, setInstrument] = useState<"XAUUSD" | "GC1!">("GC1!");
  const { data } = useApi<Full>(`/api/analysis/full?instrument=${instrument === "GC1!" ? "gc" : "xauusd"}`, 45000);

  return (
    <div className="space-y-4">
      <InstrumentPicker value={instrument} onChange={setInstrument} />
      {!data ? <SkeletonBlock h={300} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Current Price" value={<PriceCell value={data.price} />} />
            <StatCard label="Nearest Buy-Side Liquidity" value={data.liquidity.nearestBsl ? <PriceCell value={data.liquidity.nearestBsl.price} /> : "—"} sub={data.liquidity.nearestBsl ? `${data.liquidity.nearestBsl.distancePct}% away · strength ${(data.liquidity.nearestBsl.strength * 100).toFixed(0)}%` : ""} />
            <StatCard label="Nearest Sell-Side Liquidity" value={data.liquidity.nearestSsl ? <PriceCell value={data.liquidity.nearestSsl.price} /> : "—"} sub={data.liquidity.nearestSsl ? `${data.liquidity.nearestSsl.distancePct}% away · strength ${(data.liquidity.nearestSsl.strength * 100).toFixed(0)}%` : ""} />
            <StatCard label="Likely Liquidity Target" value={data.liquidity.likelyTarget ? <PriceCell value={data.liquidity.likelyTarget.price} /> : "—"} sub={data.liquidity.likelyTarget ? `${data.liquidity.likelyTarget.side}-side · confidence ${data.liquidity.targetConfidence}%` : ""} status="INFERRED" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <GlassPanel className="xl:col-span-2 p-4">
              <SectionTitle title="Liquidity Pools" subtitle={`${data.liquidity.pools.filter((p) => p.status === "OPEN").length} open · sorted by distance`} />
              <DataTable
                headers={["Side", "Kind", "Label", "Price", "Distance", "Distance %", "Strength", "Status"]}
                rows={data.liquidity.pools.slice(0, 14).map((p) => [
                  <span key="s" className={p.side === "BUY" ? "text-zinc-100" : "text-zinc-400"}>{p.side === "BUY" ? "BUY ▲" : "SELL ▼"}</span>,
                  p.kind.replace(/_/g, " "),
                  <span key="l" className="text-zinc-500">{p.label}</span>,
                  <span key="p" className="num">{p.price}</span>,
                  <span key="d" className="num">{p.distance > 0 ? "+" : ""}{p.distance}</span>,
                  <span key="dp" className="num">{p.distancePct}%</span>,
                  <span key="st" className="num">{(p.strength * 100).toFixed(0)}%</span>,
                  <StatusBadge key="st" status={p.status} />,
                ])}
              />
            </GlassPanel>

            <div className="space-y-3">
              <GlassPanel className="p-4" delay={0.05}>
                <SectionTitle title="Sweep Zone & Reversal" />
                <KV k="Potential sweep zone" v={data.liquidity.sweepZone ? `${data.liquidity.sweepZone.bottom} – ${data.liquidity.sweepZone.top} (${data.liquidity.sweepZone.side})` : "—"} />
                <KV k="Potential reversal zone" v={data.liquidity.potentialReversalZone ? `${data.liquidity.potentialReversalZone.bottom} – ${data.liquidity.potentialReversalZone.top}` : "—"} />
                <KV k="Consumed (recent)" v={data.liquidity.consumed.slice(0, 3).map((c) => c.label.split(" ")[0]).join(", ") || "—"} />
              </GlassPanel>
              <GlassPanel className="p-4" delay={0.1}>
                <SectionTitle title="Recent Sweeps" />
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {data.liquidity.recentSweeps.slice(-6).reverse().map((s, i) => (
                    <div key={i} className="glass-subtle p-2.5">
                      <div className="flex items-center justify-between">
                        <DirectionBadge dir={s.kind} />
                        <span className="num text-[11px] text-zinc-200">{s.sweepPrice}</span>
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-1">{s.referenceLabel} · {s.reclaimed ? "reclaimed" : "not reclaimed"} · {new Date(s.time * 1000).toISOString().slice(5, 16).replace("T", " ")}</div>
                    </div>
                  ))}
                  {!data.liquidity.recentSweeps.length && <p className="text-[11px] text-zinc-600">No sweeps in the loaded window.</p>}
                </div>
              </GlassPanel>
            </div>
          </div>

          <GlassPanel className="p-3">
            <p className="text-[10px] text-zinc-500 leading-relaxed">{data.liquidity.basis}</p>
          </GlassPanel>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function LiquidityHeatmap() {
  const [instrument, setInstrument] = useState<"XAUUSD" | "GC1!">("GC1!");
  const [tf, setTf] = useState("15m");
  const { data } = useApi<Full>(`/api/analysis/full?instrument=${instrument === "GC1!" ? "gc" : "xauusd"}&tf=${tf}`, 45000);
  const [filter, setFilter] = useState(0); // min intensity filter

  const levels = useMemo(() => {
    const ls = data?.heatmap.levels ?? [];
    return ls.filter((l) => Math.max(l.buyIntensity, l.sellIntensity) >= filter);
  }, [data, filter]);
  const price = data?.price ?? 0;
  const maxPrice = levels.length ? Math.max(...levels.map((l) => l.price)) : 1;
  const minPrice = levels.length ? Math.min(...levels.map((l) => l.price)) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 items-center">
        <InstrumentPicker value={instrument} onChange={setInstrument} />
        <span className="w-px h-5 bg-white/10 mx-1" />
        {["15m", "1h", "4h", "1d"].map((t) => <Chip key={t} active={tf === t} onClick={() => setTf(t)}>{t.toUpperCase()}</Chip>)}
        <span className="w-px h-5 bg-white/10 mx-1" />
        <span className="text-[10px] text-zinc-600">Intensity filter</span>
        {[0, 0.15, 0.3, 0.5].map((f) => <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>{(f * 100).toFixed(0)}%</Chip>)}
      </div>

      <GlassPanel className="p-4">
        <SectionTitle
          title="Multi-Timeframe Liquidity Heatmap"
          subtitle={data?.heatmap.dataBasis}
          right={<StatusBadge status="EXECUTED + INFERRED" />}
        />
        {!data ? <SkeletonBlock h={360} /> : (
          <div className="space-y-3">
            <div className="relative">
              <div className="space-y-[2px] max-h-[420px] overflow-y-auto pr-1">
                {levels.slice().sort((a, b) => b.price - a.price).map((l, i) => {
                  const isCurrent = Math.abs(l.price - price) < (maxPrice - minPrice) / levels.length / 2;
                  const intensity = Math.max(l.buyIntensity, l.sellIntensity);
                  const buyDom = l.buyIntensity >= l.sellIntensity;
                  return (
                    <div key={i} className="relative h-4 rounded-sm overflow-hidden flex items-center">
                      <div className="absolute inset-0 flex">
                        <motion.div
                          className="h-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${l.buyIntensity * 100}%` }}
                          transition={{ duration: 0.6, delay: i * 0.004 }}
                          style={{ background: `rgba(255,255,255,${0.08 + l.buyIntensity * 0.6})` }}
                        />
                        <motion.div
                          className="h-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${l.sellIntensity * 100}%` }}
                          transition={{ duration: 0.6, delay: i * 0.004 }}
                          style={{ background: `rgba(120,120,130,${0.06 + l.sellIntensity * 0.5})` }}
                        />
                      </div>
                      <div className="relative z-10 w-full flex items-center justify-between px-2">
                        <span className={`num text-[9.5px] ${isCurrent ? "text-zinc-50 font-bold" : "text-zinc-400"}`}>
                          {l.price}{isCurrent ? " ◄ price" : ""}
                        </span>
                        <span className="text-[8.5px] text-zinc-500 num">
                          {buyDom ? "BUY" : "SELL"} {(intensity * 100).toFixed(0)}% · vol {l.executedVolume.toFixed(0)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-zinc-500">
              <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm" style={{ background: "rgba(255,255,255,0.55)" }} /> buy-side concentration</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-2 rounded-sm" style={{ background: "rgba(120,120,130,0.5)" }} /> sell-side concentration</span>
              <span>{data.heatmap.note}</span>
            </div>
          </div>
        )}
      </GlassPanel>
      <Disclaimer />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SessionIntelligence() {
  const [instrument, setInstrument] = useState<"XAUUSD" | "GC1!">("GC1!");
  const { data } = useApi<Full>(`/api/analysis/full?instrument=${instrument === "GC1!" ? "gc" : "xauusd"}`, 45000);

  return (
    <div className="space-y-4">
      <InstrumentPicker value={instrument} onChange={setInstrument} />
      {!data ? <SkeletonBlock h={300} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            {data.sessions.map((s, i) => (
              <StatCard
                key={s.short}
                label={s.name}
                delay={0.04 * i}
                value={<span className={s.isOpen ? "text-zinc-50" : "text-zinc-500"}>{s.isOpen ? "OPEN" : "CLOSED"}</span>}
                sub={s.high != null ? `H ${s.high} · L ${s.low} · R ${s.range}` : "no range yet"}
                right={s.isOpen ? <span className="live-dot" /> : undefined}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <GlassPanel className="p-4">
              <SectionTitle title="Openings & Opening Ranges" subtitle="Midnight (00:00 UTC) open, 30m and 60m opening ranges" />
              <KV k="Midnight open" v={data.openings.midnightOpen ?? "—"} />
              <KV k="30m opening range" v={data.openings.openingRange30 ? `${data.openings.openingRange30.low} – ${data.openings.openingRange30.high}` : "—"} />
              <KV k="60m opening range" v={data.openings.openingRange60 ? `${data.openings.openingRange60.low} – ${data.openings.openingRange60.high}` : "—"} />
              <KV k="Session windows" v="Sydney 21:00 · Asia 00:00–09:00 · London 07:00–16:00 · NY 12:00–21:00 UTC" mono={false} />
              <KV k="Killzones" v="London 07:00–10:00 · New York 12:00–15:00 UTC" mono={false} />
            </GlassPanel>

            <GlassPanel className="p-4" delay={0.05}>
              <SectionTitle title="Historical Session Statistics" subtitle="Measured from the loaded hourly history" />
              <DataTable
                headers={["Session", "Avg range", "Median", "Displacement %", "Continuation %", "Reversal %", "Sweeps Asia H/L", "Samples"]}
                rows={data.sessionStats.map((s) => [
                  s.label,
                  <span key="a" className="num">{s.avgRange}</span>,
                  <span key="m" className="num">{s.medianRange}</span>,
                  <span key="d" className="num">{s.displacementPct}%</span>,
                  <span key="c" className="num">{s.continuationPct}%</span>,
                  <span key="r" className="num">{s.reversalPct}%</span>,
                  <span key="s" className="num">{s.sweepAsianHighPct}% / {s.sweepAsianLowPct}%</span>,
                  s.samples,
                ])}
              />
            </GlassPanel>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function VolatilityIntelligence() {
  const [instrument, setInstrument] = useState<"XAUUSD" | "GC1!">("GC1!");
  const { data } = useApi<Full>(`/api/analysis/full?instrument=${instrument === "GC1!" ? "gc" : "xauusd"}`, 45000);

  return (
    <div className="space-y-4">
      <InstrumentPicker value={instrument} onChange={setInstrument} />
      {!data ? <SkeletonBlock h={300} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Today's Range" value={<PriceCell value={data.volatility.dailyRange} />} sub={`${data.volatility.rangeConsumedPct}% of ADR consumed`} />
            <StatCard label="Average Daily Range" value={<PriceCell value={data.volatility.adr} />} sub={`${data.volatility.adrPct}% of price · remaining est. ${data.volatility.remainingRange}`} />
            <StatCard label="Volatility Regime" value={data.volatility.regime} sub={`HV ${data.volatility.historicalVolAnnual}% · percentile ${data.volatility.hvPercentile}`} status={data.volatility.regime} />
            <StatCard label="Avg Weekly Range" value={<PriceCell value={data.volatility.awr} />} sub={`daily σ ${data.volatility.stdevDaily}`} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <GlassPanel className="p-4">
              <SectionTitle title="ATR Across Timeframes" />
              <div className="grid grid-cols-2 gap-x-6">
                {Object.entries(data.volatility.atr).map(([tf, v]) => <KV key={tf} k={`ATR ${tf}`} v={v} />)}
                <KV k="News-driven vol factor" v={data.volatility.newsDrivenVol ? `${data.volatility.newsDrivenVol}× median hour` : "—"} />
                <KV k="Expansion / contraction" v={`${data.volatility.expansion ? "expansion" : data.volatility.contraction ? "contraction" : "normal"} (5d vs 20d)`} mono={false} />
              </div>
            </GlassPanel>
            <GlassPanel className="p-4" delay={0.05}>
              <SectionTitle title="Session Volatility (avg range)" />
              {Object.entries(data.volatility.sessionVol).map(([s, v]) => <KV key={s} k={s.replace("_", " ")} v={v} />)}
              <p className="text-[10px] text-zinc-600 mt-2">Computed from the last ~14 days of hourly candles per session window.</p>
            </GlassPanel>
          </div>
        </>
      )}
      <Disclaimer />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function OrderFlowAnalysis() {
  const [instrument, setInstrument] = useState<"XAUUSD" | "GC1!">("GC1!");
  const { data } = useApi<Full>(`/api/analysis/full?instrument=${instrument === "GC1!" ? "gc" : "xauusd"}`, 30000);

  const cvdSeries = useMemo(() => {
    if (!data?.orderFlow.series?.length) return [];
    // downsample for sparkline-style area
    const s = data.orderFlow.series;
    const step = Math.max(1, Math.floor(s.length / 60));
    return s.filter((_, i) => i % step === 0).map((p) => p.cvd);
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 items-center">
        <InstrumentPicker value={instrument} onChange={setInstrument} />
        <StatusBadge status="PROXY DATA" />
        <span className="text-[10px] text-zinc-600">Buy/sell split is an OHLCV proxy — no aggressor-tagged feed connected.</span>
      </div>
      {!data ? <SkeletonBlock h={300} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Buyer Pressure" value={`${data.orderFlow.buyerPct}%`} sub={<span className="block w-full"><span className="block h-1.5 rounded bg-zinc-800 overflow-hidden"><span className="block h-full bg-zinc-100" style={{ width: `${data.orderFlow.buyerPct}%` }} /></span></span>} />
            <StatCard label="Seller Pressure" value={`${data.orderFlow.sellerPct}%`} sub={<span className="block w-full"><span className="block h-1.5 rounded bg-zinc-800 overflow-hidden"><span className="block h-full bg-zinc-500" style={{ width: `${data.orderFlow.sellerPct}%` }} /></span></span>} />
            <StatCard label="Volume Delta (window)" value={<DeltaCell value={data.orderFlow.delta} suffix="" digits={0} />} sub={`CVD ${data.orderFlow.cvd.toLocaleString()}`} />
            <StatCard label="State" value={data.orderFlow.aggressiveBuying ? "Aggressive Buying" : data.orderFlow.aggressiveSelling ? "Aggressive Selling" : "Balanced"} sub={data.orderFlow.divergence.kind ? `CVD divergence: ${data.orderFlow.divergence.kind}` : "no CVD divergence"} status="PROXY" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <GlassPanel className="xl:col-span-2 p-4">
              <SectionTitle title="Cumulative Volume Delta" subtitle="Proxy CVD from 15m OHLCV over the loaded window" />
              {cvdSeries.length ? (
                <div className="relative h-44">
                  {(() => {
                    const min = Math.min(...cvdSeries), max = Math.max(...cvdSeries);
                    const range = max - min || 1;
                    const pts = cvdSeries.map((v, i) => `${(i / (cvdSeries.length - 1)) * 100},${100 - ((v - min) / range) * 96 - 2}`).join(" ");
                    const zeroY = 100 - ((0 - min) / range) * 96 - 2;
                    return (
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                        <line x1="0" y1={zeroY} x2="100" y2={zeroY} stroke="rgba(255,255,255,0.15)" strokeDasharray="2 2" strokeWidth="0.3" />
                        <polyline points={pts} fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                      </svg>
                    );
                  })()}
                </div>
              ) : <SkeletonBlock h={160} />}
            </GlassPanel>
            <div className="space-y-3">
              <GlassPanel className="p-4" delay={0.05}>
                <SectionTitle title="Absorption & Imbalances" />
                {data.orderFlow.absorption ? (
                  <div className="glass-subtle p-2.5">
                    <DirectionBadge dir={`${data.orderFlow.absorption.side} ABSORPTION`} />
                    <p className="text-[10.5px] text-zinc-500 mt-1.5">{data.orderFlow.absorption.note}</p>
                  </div>
                ) : <p className="text-[11px] text-zinc-600">No absorption signature in the last bars.</p>}
                <div className="mt-2">
                  <KV k="Stacked imbalances" v={data.orderFlow.stackedImbalances.length ? data.orderFlow.stackedImbalances.slice(-3).map((s) => `${s.side}×${s.count}`).join(", ") : "—"} />
                  <KV k="Divergence" v={data.orderFlow.divergence.kind ?? "none"} />
                </div>
              </GlassPanel>
              <GlassPanel className="p-4" delay={0.1}>
                <SectionTitle title="Footprint Availability" />
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  True bid×ask footprint, per-price deltas and market profile require an aggressor-tagged
                  exchange feed (e.g., CME MDP3 via Databento). The adapter is documented in
                  Settings → Data Providers; until connected, this workspace shows clearly-labelled OHLCV proxies
                  instead of fabricating depth data.
                </p>
              </GlassPanel>
            </div>
          </div>
        </>
      )}
      <Disclaimer />
    </div>
  );
}
