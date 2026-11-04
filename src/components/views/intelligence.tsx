"use client";

/**
 * AI Prediction Center, Confluence Engine, Trade Setup Generator.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import { useApi, usePost } from "@/lib/hooks/useData";
import {
  Chip, GlassPanel, SectionTitle, StatCard, StatusBadge, SkeletonBlock,
  DataTable, KV, Disclaimer, DirectionBadge, ProbabilityBar, ScoreMeter,
} from "@/components/glass/primitives";
import type { ConfluenceOutput, PredictionOutput, SetupScanResult } from "@/lib/engines/types";

// ---------------------------------------------------------------------------

export function PredictionCenter() {
  const [instrument, setInstrument] = useState<"XAUUSD" | "GC1!">("GC1!");
  const [engine, setEngine] = useState<"TECHNICAL" | "FUNDAMENTAL">("TECHNICAL");
  const { data } = useApi<{ technical: PredictionOutput[]; fundamental: PredictionOutput | null }>(`/api/ai/predictions?instrument=${instrument === "GC1!" ? "gc" : "xauusd"}`, 60000);

  const list: PredictionOutput[] = engine === "TECHNICAL"
    ? (data?.technical ?? [])
    : data?.fundamental ? [data.fundamental] : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 items-center">
        <Chip active={instrument === "XAUUSD"} onClick={() => setInstrument("XAUUSD")}>XAUUSD</Chip>
        <Chip active={instrument === "GC1!"} onClick={() => setInstrument("GC1!")}>GC1!</Chip>
        <span className="w-px h-5 bg-white/10 mx-1" />
        <Chip active={engine === "TECHNICAL"} onClick={() => setEngine("TECHNICAL")}>Technical Engine</Chip>
        <Chip active={engine === "FUNDAMENTAL"} onClick={() => setEngine("FUNDAMENTAL")}>Fundamental Engine</Chip>
      </div>

      <GlassPanel className="p-3">
        <p className="text-[10.5px] text-zinc-500 leading-relaxed">
          <strong className="text-zinc-300">Honesty note:</strong> probabilities come from a weighted scoring model squashed
          through a logistic function. The technical engine is walk-forward calibrated on the loaded history (score at t uses
          only data ≤ t; evaluated on the realized move over each horizon) — the measured out-of-sample accuracy is shown per
          prediction. No invented "AI accuracy" is ever displayed.
        </p>
      </GlassPanel>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {!data ? Array.from({ length: 6 }).map((_, i) => <SkeletonBlock key={i} h={190} />) : list.map((p, i) => (
          <motion.div key={p.horizon} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <GlassPanel className="p-4 h-full" hover>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{p.horizon} horizon</span>
                <DirectionBadge dir={p.direction} />
              </div>
              <ProbabilityBar bull={p.probBull} bear={p.probBear} neutral={p.probNeutral} />
              <div className="grid grid-cols-2 gap-x-4 mt-3">
                <KV k="Confidence" v={`${(p.confidence * 100).toFixed(0)}%`} />
                <KV k="Regime" v={p.regime !== "n/a" ? p.regime.replace(/_/g, " ").toLowerCase() : "—"} />
                <KV k="Expected zone" v={p.expectedLow && p.expectedHigh ? `${p.expectedLow} – ${p.expectedHigh}` : "—"} />
                <KV k="Valid until" v={new Date(p.targetTs).toISOString().slice(11, 16) + " UTC"} />
              </div>
              <div className="mt-2 pt-2 border-t border-white/5">
                <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1">Supporting evidence</div>
                <ul className="space-y-0.5 max-h-24 overflow-y-auto pr-1">
                  {p.supporting.slice(0, 4).map((s, j) => <li key={j} className="text-[10.5px] text-zinc-400">+ {s}</li>)}
                </ul>
                <div className="text-[9px] uppercase tracking-widest text-zinc-600 mt-1.5 mb-1">Conflicting</div>
                <ul className="space-y-0.5 max-h-16 overflow-y-auto pr-1">
                  {p.conflicting.slice(0, 3).map((s, j) => <li key={j} className="text-[10.5px] text-zinc-500">− {s}</li>)}
                </ul>
              </div>
              <p className="text-[10px] text-zinc-500 mt-2">{p.invalidation}</p>
              <p className="text-[9.5px] text-zinc-600 mt-1.5 num">
                Calibration: {p.calibration.historicalAccuracy != null ? `${p.calibration.historicalAccuracy}% oos hit-rate (${p.calibration.samples} samples)` : "pending — history loading"}
              </p>
            </GlassPanel>
          </motion.div>
        ))}
      </div>
      <Disclaimer />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ConfluenceEngine() {
  const [instrument, setInstrument] = useState<"XAUUSD" | "GC1!">("GC1!");
  const { data } = useApi<ConfluenceOutput>(`/api/ai/confluence?instrument=${instrument === "GC1!" ? "gc" : "xauusd"}`, 60000);

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        <Chip active={instrument === "XAUUSD"} onClick={() => setInstrument("XAUUSD")}>XAUUSD</Chip>
        <Chip active={instrument === "GC1!"} onClick={() => setInstrument("GC1!")}>GC1!</Chip>
      </div>
      {!data ? <SkeletonBlock h={340} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Overall Bias" value={<DirectionBadge dir={data.overallBias} />} sub={`score ${data.confluenceScore > 0 ? "+" : ""}${data.confluenceScore}`} />
            <StatCard label="Confluence Score" value={data.confluenceScore} sub={<ScoreMeter score={data.confluenceScore} label="" />} />
            <StatCard label="Confidence" value={`${(data.confidence * 100).toFixed(0)}%`} sub={`regime: ${data.regime}`} />
            <StatCard label="Key Liquidity Target" value={data.keyLiquidityTarget ? data.keyLiquidityTarget.price : "—"} sub={data.keyLiquidityTarget ? `${data.keyLiquidityTarget.label} (${data.keyLiquidityTarget.side})` : "none"} status="INFERRED" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <GlassPanel className="xl:col-span-2 p-4">
              <SectionTitle title="Evidence Ledger" subtitle="Every input engine's contribution — supporting and conflicting" />
              <ProbabilityBar bull={data.probBull} bear={data.probBear} neutral={data.probNeutral} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1.5">Supporting</div>
                  <ul className="space-y-1">{data.supporting.map((s, i) => <li key={i} className="text-[11px] text-zinc-300">▸ {s}</li>)}</ul>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1.5">Conflicting</div>
                  <ul className="space-y-1">{data.conflicting.map((s, i) => <li key={i} className="text-[11px] text-zinc-400">▸ {s}</li>)}</ul>
                </div>
              </div>
            </GlassPanel>
            <GlassPanel className="p-4" delay={0.05}>
              <SectionTitle title="Levels & Risk" />
              <KV k="Major support" v={data.majorSupport ?? "—"} />
              <KV k="Major resistance" v={data.majorResistance ?? "—"} />
              <KV k="Reversal zone" v={data.reversalZone ? `${data.reversalZone.bottom} – ${data.reversalZone.top}` : "—"} />
              <KV k="Fundamental bias" v={data.fundamentalBias} />
              <KV k="Technical bias" v={data.technicalBias} />
              <KV k="MTF alignment" v={data.mtfAlignment} />
              <KV k="Liquidity" v={data.liquidityCondition} mono={false} />
              <KV k="Order flow" v={data.orderFlow} mono={false} />
              <KV k="Volatility" v={data.volatility} mono={false} />
              <KV k="Session" v={data.session} />
              <KV k="News sentiment" v={data.newsSentiment} mono={false} />
            </GlassPanel>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <GlassPanel className="p-4">
              <SectionTitle title="Key Risks" />
              <ul className="space-y-1.5">{data.keyRisks.map((r, i) => <li key={i} className="text-[11.5px] text-zinc-300">⚠ {r}</li>)}</ul>
            </GlassPanel>
            <GlassPanel className="p-4" delay={0.05}>
              <SectionTitle title="Invalidation" />
              <p className="text-[12px] text-zinc-200">{data.invalidation}</p>
              <p className="text-[10px] text-zinc-600 mt-2 num">Computed {new Date(data.timestamp).toISOString().slice(0, 19).replace("T", " ")} UTC</p>
            </GlassPanel>
          </div>
        </>
      )}
      <Disclaimer />
    </div>
  );
}

// ---------------------------------------------------------------------------

interface SettingsResp {
  settings: {
    minRiskReward: number; requireMss: boolean; requireSweep: boolean; requireDisplacement: boolean;
    requireFvg: boolean; requireHtfAlignment: boolean; requireFundAlignment: boolean;
    sessionFilter: string; maxVolatilityGuard: boolean;
  } | null;
}

export function TradeSetupGenerator() {
  const [instrument, setInstrument] = useState<"XAUUSD" | "GC1!">("GC1!");
  const [rules, setRules] = useState<Record<string, boolean | number | string> | null>(null);
  const { data } = useApi<SetupScanResult & { rules: Record<string, unknown> }>(`/api/ai/setups?instrument=${instrument === "GC1!" ? "gc" : "xauusd"}`, 60000);
  const settings = useApi<SettingsResp>("/api/settings", 0);
  const { post, loading } = usePost<SetupScanResult>();

  const current = rules ?? (data?.rules as Record<string, boolean | number | string> | undefined) ?? {};

  const toggle = (k: string) => {
    const next = { ...current, [k]: !current[k] };
    setRules(next);
    void post(`/api/ai/setups?instrument=${instrument === "GC1!" ? "gc" : "xauusd"}`, next);
  };
  const setRR = (v: number) => {
    const next = { ...current, minRR: v };
    setRules(next);
    void post(`/api/ai/setups?instrument=${instrument === "GC1!" ? "gc" : "xauusd"}`, next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 items-center">
        <Chip active={instrument === "XAUUSD"} onClick={() => setInstrument("XAUUSD")}>XAUUSD</Chip>
        <Chip active={instrument === "GC1!"} onClick={() => setInstrument("GC1!")}>GC1!</Chip>
      </div>

      <GlassPanel className="p-3">
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[9px] uppercase tracking-[0.14em] text-zinc-600 mr-1">Rules</span>
          <span className="text-[10px] text-zinc-500 mr-1">Min RR 1:</span>
          {[2, 3, 4, 5].map((v) => <Chip key={v} active={Number(current.minRR ?? 3) === v} onClick={() => setRR(v)}>{v}</Chip>)}
          <span className="w-px h-5 bg-white/10 mx-1" />
          {[
            ["requireHtfAlignment", "HTF alignment"], ["requireMss", "Require MSS"], ["requireSweep", "Require sweep"],
            ["requireDisplacement", "Require displacement"], ["requireFvg", "Require FVG"], ["requireFundAlignment", "Fundamental alignment"],
            ["maxVolatilityGuard", "Volatility guard"],
          ].map(([k, label]) => (
            <Chip key={k} active={!!current[k]} onClick={() => toggle(k)}>{label}</Chip>
          ))}
          {loading && <span className="text-[10px] text-zinc-500 ml-1">re-scanning…</span>}
        </div>
      </GlassPanel>

      {!data ? <SkeletonBlock h={260} /> : data.setups.length === 0 ? (
        <GlassPanel className="p-8 text-center">
          <div className="text-[13px] font-semibold tracking-[0.2em] text-zinc-300 uppercase">No Valid Setup</div>
          <p className="text-[11px] text-zinc-500 mt-2">The generator refuses to force trades. Current failing gates:</p>
          <ul className="mt-3 space-y-1 max-w-xl mx-auto text-left">
            {data.noSetupReasons.map((r, i) => <li key={i} className="text-[11px] text-zinc-400">• {r}</li>)}
          </ul>
        </GlassPanel>
      ) : (
        <div className="space-y-3">
          {data.setups.map((s, i) => (
            <motion.div key={s.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <GlassPanel hover className="p-4">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <DirectionBadge dir={s.direction} />
                  <span className="text-[11px] font-semibold tracking-wide text-zinc-100 uppercase">{s.setupType.replace(/_/g, " ")}</span>
                  <StatusBadge status={`${s.timeframe.toUpperCase()} · ${s.session.replace("_", " ")}`} />
                  <span className="text-[10px] num text-zinc-500">quality {s.quality}/100 · RR 1:{s.riskReward}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-4">
                  <KV k="Entry zone" v={`${s.entryZone.bottom} – ${s.entryZone.top}`} />
                  <KV k="Stop loss" v={s.stopLoss} />
                  <KV k="TP1" v={s.takeProfits[0] ?? "—"} />
                  <KV k="TP2" v={s.takeProfits[1] ?? "—"} />
                  <KV k="TP3" v={s.takeProfits[2] ?? "—"} />
                  <KV k="Invalidation" v={s.invalidation} />
                </div>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1">Confluences</div>
                    <ul className="space-y-0.5">{s.confluences.map((c, j) => <li key={j} className="text-[10.5px] text-zinc-400">▸ {c}</li>)}</ul>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1">Reasoning</div>
                    <ul className="space-y-0.5">{s.reasoning.map((c, j) => <li key={j} className="text-[10.5px] text-zinc-500">{c}</li>)}</ul>
                  </div>
                </div>
                <p className="text-[10px] text-zinc-600 mt-2">Entry confirmation: {s.entryConfirmation}</p>
              </GlassPanel>
            </motion.div>
          ))}
        </div>
      )}

      <GlassPanel className="p-3">
        <p className="text-[10px] text-zinc-500"><strong className="text-zinc-300">Rules applied:</strong> {(data?.rulesApplied ?? []).join(" · ") || "—"}</p>
        <p className="text-[10px] text-zinc-600 mt-1">The platform never executes trades automatically. Setups are analytical blueprints with explicit invalidation.</p>
      </GlassPanel>
      <Disclaimer />
    </div>
  );
}
