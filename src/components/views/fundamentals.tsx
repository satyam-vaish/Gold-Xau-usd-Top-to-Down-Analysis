"use client";

/**
 * Fundamental Intelligence — live news, economic calendar, macro dashboard
 * and the fundamental AI prediction (tabbed workspace).
 */
import { useState } from "react";
import { useApi } from "@/lib/hooks/useData";
import {
  Chip, GlassPanel, SectionTitle, StatCard, StatusBadge, SkeletonBlock,
  DataTable, ProbabilityBar, KV, Disclaimer, DirectionBadge, Spark, DeltaCell,
} from "@/components/glass/primitives";
import type { PredictionOutput } from "@/lib/engines/types";

interface NewsResp {
  articles: { id: string; headline: string; source: string; url: string; summary: string; publishedAt: string; category: string; importance: string; sentiment: string; sentimentScore: number; impact: string; aiSummary: string }[];
  aggregateSentiment: number;
}
interface CalendarResp {
  events: { id: string; name: string; country: string; eventTime: string; previous: string | null; forecast: string | null; actual: string | null; impact: string; kind: string; status: string; countdownHours: number; historicalReaction: { avgMove15m: number; avgMove1h: number; avgMove4h: number; typicalDirection: string } | null }[];
  note: string;
}
interface MacroResp {
  assets: { key: string; label: string; quote: { price: number | null; status: string; source: string } | null; changePct1d: number | null; spark: number[] }[];
}
interface PredictionsResp {
  technical: PredictionOutput[];
  fundamental: PredictionOutput | null;
}

const CATEGORIES = ["ALL", "FED", "INFLATION", "USD", "GEOPOLITICS", "CENTRAL_BANKS", "GOLD"];

export function FundamentalIntelligence() {
  const [tab, setTab] = useState<"news" | "calendar" | "macro" | "prediction">("news");
  const [cat, setCat] = useState("ALL");
  const news = useApi<NewsResp>("/api/fundamental/news", 120000);
  const calendar = useApi<CalendarResp>("/api/fundamental/calendar", 60000);
  const macro = useApi<MacroResp>("/api/fundamental/macro", 60000);
  const preds = useApi<PredictionsResp>("/api/ai/predictions", 120000);
  const fundamental = preds.data?.fundamental ?? null;

  const articles = (news.data?.articles ?? []).filter((a) => cat === "ALL" || a.category === cat);
  const upcoming = (calendar.data?.events ?? []).filter((e) => e.countdownHours > -3);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {([["news", "Live Financial News"], ["calendar", "Economic Calendar"], ["macro", "Macro Dashboard"], ["prediction", "Fundamental AI Prediction"]] as const).map(([k, label]) => (
          <Chip key={k} active={tab === k} onClick={() => setTab(k)}>{label}</Chip>
        ))}
      </div>

      {tab === "news" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <GlassPanel className="xl:col-span-2 p-4">
            <SectionTitle
              title="Live Financial News — Gold-Relevant"
              subtitle="Yahoo Finance search (live) · Finnhub when configured · deduped, source-attributed, rule-classified"
              right={<StatusBadge status={articles.length ? "LIVE" : "…"} />}
            />
            <div className="flex flex-wrap gap-1.5 mb-3">
              {CATEGORIES.map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{c.replace("_", " ")}</Chip>)}
            </div>
            <div className="space-y-2.5 max-h-[640px] overflow-y-auto pr-1">
              {!news.data ? <SkeletonBlock h={300} /> : articles.length === 0 ? (
                <p className="text-[12px] text-zinc-500">No articles in this category right now.</p>
              ) : articles.map((a) => (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block glass-subtle p-3 hover:border-white/20 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-[12.5px] font-medium leading-snug text-zinc-100">{a.headline}</div>
                    <StatusBadge status={a.sentiment === "BULLISH_GOLD" ? "BULLISH" : a.sentiment === "BEARISH_GOLD" ? "BEARISH" : "NEUTRAL"} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[9.5px] text-zinc-600">
                    <span className="text-zinc-400">{a.source}</span>
                    <span className="num">{new Date(a.publishedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                    <span>· {a.category.replace("_", " ")}</span>
                    <span className={`px-1.5 rounded ${a.importance === "HIGH" ? "text-zinc-200 bg-white/10" : ""}`}>{a.importance}</span>
                  </div>
                  <div className="text-[10.5px] text-zinc-500 mt-1.5 leading-relaxed">{a.impact}</div>
                  <div className="text-[10px] text-zinc-600 mt-1">{a.aiSummary}</div>
                </a>
              ))}
            </div>
          </GlassPanel>
          <div className="space-y-3">
            <StatCard label="Aggregate News Sentiment" value={news.data ? news.data.aggregateSentiment.toFixed(2) : "…"} sub={news.data ? `${news.data.articles.length} classified articles (−1 bearish … +1 bullish)` : ""} status="LIVE" />
            <GlassPanel className="p-4">
              <SectionTitle title="Sentiment Mix" />
              {(() => {
                const arts = news.data?.articles ?? [];
                const bull = arts.filter((a) => a.sentiment === "BULLISH_GOLD").length;
                const bear = arts.filter((a) => a.sentiment === "BEARISH_GOLD").length;
                const neut = arts.length - bull - bear;
                return arts.length ? <ProbabilityBar bull={bull / arts.length} bear={bear / arts.length} neutral={neut / arts.length} /> : <SkeletonBlock h={40} />;
              })()}
            </GlassPanel>
            <GlassPanel className="p-4">
              <SectionTitle title="Classification Transparency" />
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Sentiment comes from an explainable keyword/rule model (rate cuts, inflation surprises, dollar moves,
                central-bank buying, geopolitics…). Every article shows which rules fired and why — no black box.
                Duplicates are removed by URL+headline hash.
              </p>
            </GlassPanel>
          </div>
        </div>
      )}

      {tab === "calendar" && (
        <div className="space-y-3">
          <GlassPanel className="p-4">
            <SectionTitle title="Economic Calendar" subtitle={calendar.data?.note} right={<StatusBadge status={(calendar.data?.events ?? []).some((e) => e.status === "LIVE") ? "LIVE" : "ESTIMATED"} />} />
            <DataTable
              headers={["Event", "Time (UTC)", "Countdown", "Impact", "Prev", "Forecast", "Actual", "Typical Gold Reaction"]}
              rows={upcoming.slice(0, 14).map((e) => [
                <span key="n" className="text-zinc-100">{e.name}{e.status === "ESTIMATED" ? <span className="ml-1.5"><StatusBadge status="ESTIMATED" /></span> : null}</span>,
                <span key="t" className="num">{new Date(e.eventTime).toISOString().slice(5, 16).replace("T", " ")}</span>,
                <span key="c" className="num">{e.countdownHours > 0 ? `${e.countdownHours.toFixed(1)}h` : "released"}</span>,
                <span key="i" className={e.impact === "HIGH" ? "text-zinc-100 font-semibold" : "text-zinc-400"}>{e.impact}</span>,
                e.previous ?? "—",
                e.forecast ?? "—",
                e.actual ?? (e.countdownHours <= 0 ? "pending" : "—"),
                e.historicalReaction ? (
                  <span key="r" className="text-zinc-400">
                    ~±{e.historicalReaction.avgMove1h}% 1h — <span className="text-zinc-600">{e.historicalReaction.typicalDirection.slice(0, 58)}…</span>
                  </span>
                ) : "—",
              ])}
            />
            <Disclaimer className="mt-3" />
          </GlassPanel>
        </div>
      )}

      {tab === "macro" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {(macro.data?.assets ?? []).map((a, i) => (
              <StatCard
                key={a.key}
                label={a.label.replace("_", " ")}
                delay={0.04 * i}
                value={a.quote?.price != null ? a.quote.price.toLocaleString("en-US", { maximumFractionDigits: 3 }) : "—"}
                status={a.quote?.status}
                sub={<span className="flex items-center justify-between gap-2"><DeltaCell value={a.changePct1d} />{a.spark?.length ? <span className="w-16"><Spark data={a.spark} height={20} /></span> : null}</span>}
              />
            ))}
            {!macro.data && <><SkeletonBlock h={92} /><SkeletonBlock h={92} /><SkeletonBlock h={92} /><SkeletonBlock h={92} /></>}
          </div>
          <GlassPanel className="p-4">
            <SectionTitle title="Macro Dashboard Notes" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              <KV k="DXY source" v="Yahoo DX-Y.NYB" />
              <KV k="Yields" v="Yahoo ^TNX / 2YY=F (percent)" />
              <KV k="Real yields" v="FRED adapter active when FRED_API_KEY set (DFII10)" mono={false} />
              <KV k="Gold/Silver ratio" v="See Intermarket Analysis view" mono={false} />
              <KV k="Fed rate expectations" v="Derived from news sentiment + 2Y yield momentum" mono={false} />
              <KV k="Central-bank purchases" v="News-derived signal; WGC data needs licensed feed" mono={false} />
            </div>
            <Disclaimer className="mt-3" />
          </GlassPanel>
        </div>
      )}

      {tab === "prediction" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <GlassPanel className="xl:col-span-2 p-4">
            <SectionTitle title="Fundamental AI Prediction" subtitle="Explainable factor model — kept independent from the technical engine" right={fundamental ? <DirectionBadge dir={fundamental.direction} /> : null} />
            {!fundamental ? <SkeletonBlock h={280} /> : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {["1 Hour", "4 Hours", "Next Session", "1 Day", "5 Days"].map((h, i) => (
                    <span key={h} className="glass-subtle px-2 py-1 text-[10px] num text-zinc-300">
                      {h}: {fundamental.direction} {Math.round((preds.data?.fundamental?.direction ? fundamental.probBull : 0) * 100)}%/… {(preds.data?.technical?.find((t) => t.horizon === (["1h", "4h", "session", "1d", "5d"][i]) ?? "1h")?.direction ?? "—")}
                    </span>
                  ))}
                </div>
                <ProbabilityBar bull={fundamental.probBull} bear={fundamental.probBear} neutral={fundamental.probNeutral} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Supporting factors</div>
                    <ul className="space-y-1">{fundamental.supporting.map((s, i) => <li key={i} className="text-[11px] text-zinc-300">+ {s}</li>)}</ul>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-zinc-600 mb-1">Conflicting factors</div>
                    <ul className="space-y-1">{fundamental.conflicting.map((s, i) => <li key={i} className="text-[11px] text-zinc-400">− {s}</li>)}</ul>
                  </div>
                </div>
                <KV k="Key risks" v={fundamental.invalidation} mono={false} />
                <KV k="Calibration basis" v={fundamental.calibration.basis} mono={false} />
              </div>
            )}
          </GlassPanel>
          <GlassPanel className="p-4" delay={0.05}>
            <SectionTitle title="Short / Medium-Term Outlook" />
            {(() => {
              const tech = preds.data?.technical ?? [];
              const st = tech.find((t) => t.horizon === "1h");
              const mt = tech.find((t) => t.horizon === "5d");
              return (
                <div className="space-y-3">
                  <KV k="Short-term (1h)" v={st ? `${st.direction} — bull ${(st.probBull * 100).toFixed(0)}%` : "…"} />
                  <KV k="Medium-term (5d)" v={mt ? `${mt.direction} — bull ${(mt.probBull * 100).toFixed(0)}%` : "…"} />
                  <KV k="Engine separation" v="Fundamental & technical predictions are computed independently and only combined inside the Confluence Engine." mono={false} />
                  <Disclaimer />
                </div>
              );
            })()}
          </GlassPanel>
        </div>
      )}
    </div>
  );
}
