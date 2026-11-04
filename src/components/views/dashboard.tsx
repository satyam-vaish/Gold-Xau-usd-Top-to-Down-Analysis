"use client";

/**
 * Overview Dashboard — global market intelligence summary.
 */
import { motion } from "framer-motion";
import { Activity, ChevronRight, Layers, Newspaper, Scale, Waves } from "lucide-react";
import { useApi, useLiveQuotes } from "@/lib/hooks/useData";
import {
  GlassPanel, SectionTitle, StatCard, StatusBadge, DeltaCell, PriceCell,
  ProbabilityBar, ScoreMeter, SkeletonGrid, SkeletonBlock, KV, Disclaimer, DirectionBadge, Chip,
} from "@/components/glass/primitives";
import { Spark } from "@/components/glass/primitives";
import { useState } from "react";
import PriceChart from "@/components/charts/PriceChart";
import type { Candle, ConfluenceOutput } from "@/lib/engines/types";

interface TickerResp {
  xauusd: { instrument: string; price: number | null; status: string; source: string; asOf: string; change: { abs: number; pct: number } | null };
  gc1: { instrument: string; price: number | null; status: string; source: string; asOf: string; change: { abs: number; pct: number } | null };
  session: string;
  marketOpen: boolean;
  serverTime: string;
}
interface OverviewResp {
  cards: {
    key: string; label: string;
    quote?: { price: number | null; status: string; source: string; asOf: string } | null;
    asset?: { quote: { price: number | null } | null; changePct1d: number | null; spark: number[] } | null;
    value?: number | string | null;
    note?: string;
    status?: string;
  }[];
}

export function OverviewDashboard({ onNavigate }: { onNavigate: (id: string) => void }) {
  const { data: ticker } = useApi<TickerResp>("/api/market/ticker", 3000);
  const { data: overview } = useApi<OverviewResp>("/api/market/overview", 5000);
  const { data: conf } = useApi<ConfluenceOutput>("/api/ai/confluence", 10000);
  const { data: analysis } = useApi<{
    volatility: { adr: number; adrPct: number; rangeConsumedPct: number; regime: string; hvPercentile: number };
    regime: { regime: string; confidence: number };
    liquidity: { likelyTarget: { label: string; price: number; side: string } | null; targetConfidence: number };
    activeSessionName: string;
    ict: { summary: string[] };
  }>("/api/analysis/full", 10000);
  const { data: news } = useApi<{ articles: { headline: string; sentiment: string; importance: string; source: string; publishedAt: string }[] }>("/api/fundamental/news", 30000);
  const { quotes, connected } = useLiveQuotes();

  const xauLive = quotes["XAUUSD"]?.price ?? ticker?.xauusd.price ?? null;
  const gcLive = quotes["GC1!"]?.price ?? ticker?.gc1.price ?? null;
  const [tab, setTab] = useState<"summary" | "ict">("summary");

  const [chartInstrument, setChartInstrument] = useState<"XAUUSD" | "GC1!">("XAUUSD");
  const [chartTf, setChartTf] = useState<"5m" | "15m" | "1h" | "1d">("15m");
  const { data: chartCandles, isLoading: chartLoading } = useApi<{ candles: Candle[]; source: string; status: string; asOf: string }>(
    `/api/market/candles?instrument=${chartInstrument}&tf=${chartTf}&limit=160`,
    4000,
  );
  const liveQuoteForOverview = quotes[chartInstrument] ?? null;

  return (
    <div className="space-y-4">
      {/* Hero row */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          label="Gold Spot · XAUUSD"
          value={<PriceCell value={xauLive} />}
          sub={ticker ? (
            <span className="flex items-center gap-2">
              <DeltaCell value={ticker.xauusd.change?.pct ?? null} />
              <StatusBadge status={quotes["XAUUSD"] ? "LIVE" : ticker.xauusd.status} />
            </span>
          ) : null}
          delay={0}
        />
        <StatCard
          label="COMEX Futures · GC1!"
          value={<PriceCell value={gcLive} />}
          sub={ticker ? (
            <span className="flex items-center gap-2">
              <DeltaCell value={ticker.gc1.change?.pct ?? null} />
              <StatusBadge status={quotes["GC1!"] ? ticker.gc1.status : ticker.gc1.status} />
            </span>
          ) : null}
          delay={0.05}
        />
        <StatCard
          label="Market Session"
          value={analysis?.activeSessionName ?? ticker?.session ?? "—"}
          sub={
            <span className="flex items-center gap-2 text-zinc-500">
              <span className={`live-dot ${ticker?.marketOpen ? "" : "opacity-40"}`} />
              {ticker?.marketOpen ? "Market open" : "Market closed"} · {connected ? "stream connected" : "stream offline"}
            </span>
          }
          delay={0.1}
        />
        <StatCard
          label="Market Regime"
          value={analysis ? analysis.regime.regime.replace(/_/g, " ") : "—"}
          sub={analysis ? `confidence ${(analysis.regime.confidence * 100).toFixed(0)}% · HV pct ${analysis.volatility.hvPercentile}%` : "loading"}
          delay={0.15}
        />
      </div>

      {/* Featured Live Gold Chart on Overview */}
      <div className="rounded-xl border border-[#151515] p-3 shadow-2xl" style={{ minHeight: 420, backgroundColor: "#050505" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#151515]">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold text-zinc-100 tracking-wide">Live Gold Price & Chart</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#FFE600] animate-pulse" />
            <span className="text-[11px] font-semibold text-[#FFE600] font-mono">
              {liveQuoteForOverview?.price ? `$${liveQuoteForOverview.price.toFixed(2)}` : xauLive ? `$${xauLive.toFixed(2)}` : "Streaming…"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Chip active={chartInstrument === "XAUUSD"} onClick={() => setChartInstrument("XAUUSD")}>XAUUSD · Spot</Chip>
              <Chip active={chartInstrument === "GC1!"} onClick={() => setChartInstrument("GC1!")}>GC1! · Futures</Chip>
            </div>
            <span className="w-px h-4 bg-[#151515]" />
            <div className="flex items-center gap-1">
              {(["5m", "15m", "1h", "1d"] as const).map((t) => (
                <Chip key={t} active={chartTf === t} onClick={() => setChartTf(t)}>{t.toUpperCase()}</Chip>
              ))}
            </div>
            <button
              onClick={() => onNavigate("charts")}
              className="text-[10px] text-[#858585] hover:text-zinc-100 flex items-center gap-1 ml-2 transition-colors"
            >
              Full Charting Lab <ChevronRight size={11} />
            </button>
          </div>
        </div>

        {chartLoading && !chartCandles ? (
          <SkeletonBlock h={360} className="my-2" />
        ) : chartCandles?.candles ? (
          <PriceChart
            candles={chartCandles.candles}
            chartType="candles"
            liveQuote={liveQuoteForOverview}
            height={360}
            precision={2}
          />
        ) : (
          <SkeletonBlock h={360} className="my-2" />
        )}

        <div className="flex items-center justify-between px-2 pt-2 border-t border-[#151515] text-[10px] text-[#858585]">
          <div className="flex items-center gap-2">
            <StatusBadge status={liveQuoteForOverview ? "LIVE" : (chartCandles?.status ?? "STREAMING")} />
            <span>{liveQuoteForOverview?.source ?? chartCandles?.source ?? "Gold Market Feed"}</span>
          </div>
          <span className="font-mono" suppressHydrationWarning>
            as of {liveQuoteForOverview?.time || chartCandles?.asOf
              ? new Date(liveQuoteForOverview?.time ?? chartCandles!.asOf).toISOString().slice(11, 19)
              : "--:--:--"} UTC
          </span>
        </div>
      </div>

      {/* Overview cards */}
      {!overview ? <SkeletonGrid count={8} /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {overview.cards.map((c, i) => (
            <StatCard
              key={c.key}
              label={c.label}
              delay={0.05 * i}
              value={
                c.quote?.price != null ? <PriceCell value={c.quote.price} /> :
                typeof c.value === "number" ? c.value.toFixed(2) :
                typeof c.value === "string" ? c.value : null
              }
              status={c.quote?.status ?? c.status}
              sub={
                c.asset ? (
                  <span className="flex items-center justify-between gap-2">
                    <DeltaCell value={c.asset.changePct1d} />
                    {c.asset.spark?.length ? <span className="w-16"><Spark data={c.asset.spark} height={20} /></span> : null}
                  </span>
                ) : c.note
              }
            />
          ))}
        </div>
      )}

      {/* Intelligence summary + AI panel content */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <GlassPanel className="xl:col-span-2 p-4">
          <SectionTitle
            title="Market Intelligence Summary"
            subtitle="Confluence of fundamental + technical engines, liquidity and regime"
            right={
              <div className="flex gap-1.5">
                <Chip active={tab === "summary"} onClick={() => setTab("summary")}>Summary</Chip>
                <Chip active={tab === "ict"} onClick={() => setTab("ict")}>ICT/SMC Digest</Chip>
              </div>
            }
          />
          {!conf ? <SkeletonBlock h={140} /> : tab === "summary" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <DirectionBadge dir={conf.overallBias} />
                <span className="text-[11px] text-zinc-400 num">Confluence {conf.confluenceScore > 0 ? "+" : ""}{conf.confluenceScore}</span>
                <span className="text-[11px] text-zinc-500">Confidence {(conf.confidence * 100).toFixed(0)}%</span>
              </div>
              <ProbabilityBar bull={conf.probBull} bear={conf.probBear} neutral={conf.probNeutral} />
              <ScoreMeter score={conf.confluenceScore} label="confluence" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                <KV k="Fundamental bias" v={conf.fundamentalBias} />
                <KV k="Technical bias" v={conf.technicalBias} />
                <KV k="Nearest liquidity target" v={conf.keyLiquidityTarget ? `${conf.keyLiquidityTarget.label} @ ${conf.keyLiquidityTarget.price}` : "—"} />
                <KV k="Volatility" v={conf.volatility} mono={false} />
                <KV k="Regime" v={conf.regime} />
                <KV k="Session" v={conf.session} />
                <KV k="Next high-impact event" v={news?.articles?.length ? news.articles[0].headline.slice(0, 46) + "…" : "—"} mono={false} />
                <KV k="Order flow" v={conf.orderFlow} mono={false} />
              </div>
              <button onClick={() => onNavigate("confluence")} className="text-[11px] text-zinc-300 hover:text-zinc-50 inline-flex items-center gap-1">
                Open full Confluence Engine <ChevronRight size={12} />
              </button>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {(analysis?.ict.summary ?? []).map((s, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                  className="text-[12px] text-zinc-300 flex gap-2">
                  <Layers size={12} className="mt-0.5 text-zinc-500 shrink-0" /> {s}
                </motion.li>
              ))}
              {!analysis?.ict.summary?.length && <li className="text-[12px] text-zinc-600">Scanner warming up…</li>}
            </ul>
          )}
        </GlassPanel>

        <div className="space-y-3">
          <GlassPanel className="p-4" delay={0.05}>
            <SectionTitle title="Liquidity Draw" subtitle="Inferred from price action — not order-book depth" />
            {analysis?.liquidity.likelyTarget ? (
              <div>
                <div className="text-lg font-semibold num text-zinc-50">{analysis.liquidity.likelyTarget.price}</div>
                <div className="text-[11px] text-zinc-400 mt-0.5">{analysis.liquidity.likelyTarget.label}</div>
                <div className="text-[10px] text-zinc-600 mt-1 num">confidence {analysis.liquidity.targetConfidence}% · {analysis.liquidity.likelyTarget.side}-side pool</div>
              </div>
            ) : <SkeletonBlock h={60} />}
            <button onClick={() => onNavigate("liquidity")} className="mt-2 text-[11px] text-zinc-300 hover:text-zinc-50 inline-flex items-center gap-1">
              Liquidity Intelligence <ChevronRight size={12} />
            </button>
          </GlassPanel>

          <GlassPanel className="p-4" delay={0.1}>
            <SectionTitle title="Latest Gold-Relevant News" right={<Newspaper size={13} className="text-zinc-500" />} />
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {(news?.articles ?? []).slice(0, 6).map((n, i) => (
                <div key={i} className="border-b border-white/5 pb-2 last:border-0">
                  <div className="text-[11.5px] leading-snug text-zinc-200">{n.headline}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <StatusBadge status={n.sentiment === "BULLISH_GOLD" ? "BULLISH" : n.sentiment === "BEARISH_GOLD" ? "BEARISH" : "NEUTRAL"} />
                    <span className="text-[9px] text-zinc-600" suppressHydrationWarning>{n.source} · {new Date(n.publishedAt).toISOString().slice(11, 16)} UTC</span>
                  </div>
                </div>
              ))}
              {!news && <SkeletonBlock h={120} />}
            </div>
          </GlassPanel>
        </div>
      </div>

      {/* Quick access tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        {[
          { id: "charts", label: "Live Charts", icon: Activity },
          { id: "ict", label: "ICT/SMC Scanner", icon: Layers },
          { id: "heatmap", label: "Liquidity Heatmap", icon: Waves },
          { id: "predictions", label: "AI Predictions", icon: Scale },
          { id: "orderflow", label: "Order Flow", icon: Activity },
          { id: "sessions", label: "Sessions", icon: Waves },
        ].map((t, i) => (
          <motion.button
            key={t.id}
            onClick={() => onNavigate(t.id)}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }}
            whileHover={{ y: -3 }}
            className="glass glass-hover p-3.5 flex flex-col items-start gap-2 text-left"
          >
            <t.icon size={15} className="text-zinc-400" />
            <span className="text-[11px] font-medium text-zinc-200">{t.label}</span>
          </motion.button>
        ))}
      </div>

      <Disclaimer />
    </div>
  );
}
