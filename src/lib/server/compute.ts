/**
 * Analysis aggregator — orchestrates every engine over the provider candles
 * with TTL caching, so API routes stay fast and consistent.
 */
import type {
  Candle, ConfluenceOutput, HeatmapReport, Instrument, LiquidityReport,
  OrderFlowReport, PredictionOutput, RegimeReport, SetupScanResult, SetupRules,
  Timeframe, TimeframeStructure, VolatilityReport,
} from "../engines/types";
import { db } from "@/lib/db";
import { getCandles, getQuote } from "./marketData";
import { cache } from "./cache";
import { analyzeStructure, mtfAlignment } from "../engines/structure";
import { runIctScan } from "../engines/ict";
import { buildLiquidityReport, buildHeatmap } from "../engines/liquidity";
import { sessionStates, sessionStatistics, dailyOpenings, activeSession } from "../engines/sessions";
import { buildVolatilityReport } from "../engines/volatility";
import { buildOrderFlow } from "../engines/orderflow";
import { detectRegime } from "../engines/regime";
import { findHistoricalPatterns } from "../engines/patterns";
import { fibonacci, dailyVwap, weeklyVwap, volumeProfile, deviationLevels } from "../engines/indicators";
import { technicalPrediction, fundamentalPrediction, walkForwardCalibrate } from "../engines/predict";
import { buildConfluence } from "../engines/confluence";
import { generateSetups } from "../engines/setups";
import { fetchAndStoreNews, aggregateSentiment } from "./news";
import { getMacroAssets } from "./marketData";

async function load(instrument: Instrument, tf: Timeframe, limit = 900): Promise<Candle[]> {
  const r = await getCandles(instrument, tf, limit);
  return r.candles;
}

export interface FullAnalysis {
  instrument: Instrument;
  price: number;
  asOf: string;
  structures: Record<string, TimeframeStructure>;
  mtf: ReturnType<typeof mtfAlignment>;
  ict: ReturnType<typeof runIctScan>;
  liquidity: LiquidityReport;
  sessions: ReturnType<typeof sessionStates>;
  sessionStats: ReturnType<typeof sessionStatistics>;
  openings: ReturnType<typeof dailyOpenings>;
  activeSessionName: string;
  volatility: VolatilityReport;
  orderFlow: OrderFlowReport;
  regime: RegimeReport;
  patterns: ReturnType<typeof findHistoricalPatterns>;
  fib: ReturnType<typeof fibonacci>;
  vwap: { daily: ReturnType<typeof dailyVwap>; weekly: ReturnType<typeof weeklyVwap>; deviation: ReturnType<typeof deviationLevels> };
  profile: ReturnType<typeof volumeProfile>;
  heatmap: HeatmapReport;
}

const ANALYSIS_TTL = 30;

export async function getFullAnalysis(instrument: Instrument, primaryTf: Timeframe = "15m"): Promise<FullAnalysis> {
  const key = `analysis:${instrument}:${primaryTf}`;
  const hit = cache.get<FullAnalysis>(key);
  if (hit) return hit;

  let c15: Candle[];
  let h1: Candle[];
  let h4: Candle[];
  let d1: Candle[];

  if (instrument === "XAUUSD") {
    c15 = await load(instrument, "15m", 500);
    const { resample } = await import("../providers/types");
    h1 = resample(c15, 60);
    h4 = resample(c15, 240);
    d1 = resample(c15, 1440);
    if (!d1.length) d1 = c15;
  } else {
    [c15, h1, h4, d1] = await Promise.all([
      load(instrument, "15m", 900),
      load(instrument, "1h", 900),
      load(instrument, "4h", 600),
      load(instrument, "1d", 400),
    ]);
  }
  const price = c15.length ? c15[c15.length - 1].close : 0;

  const structures: Record<string, TimeframeStructure> = {
    "15m": analyzeStructure(c15, "15m"),
    "1h": analyzeStructure(h1, "1h"),
    "4h": analyzeStructure(h4, "4h"),
    "1d": analyzeStructure(d1, "1d"),
  };
  const mtfRows = [
    { timeframe: "15m" as Timeframe, trend: structures["15m"].trend, lastEvent: structures["15m"].lastEvent ? `${structures["15m"].lastEvent!.kind} ${structures["15m"].lastEvent!.direction}` : "—", zone: structures["15m"].zone, lastLabelHigh: structures["15m"].lastLabelHigh ?? "—", lastLabelLow: structures["15m"].lastLabelLow ?? "—", price: structures["15m"].price },
    { timeframe: "1h" as Timeframe, trend: structures["1h"].trend, lastEvent: structures["1h"].lastEvent ? `${structures["1h"].lastEvent!.kind} ${structures["1h"].lastEvent!.direction}` : "—", zone: structures["1h"].zone, lastLabelHigh: structures["1h"].lastLabelHigh ?? "—", lastLabelLow: structures["1h"].lastLabelLow ?? "—", price: structures["1h"].price },
    { timeframe: "4h" as Timeframe, trend: structures["4h"].trend, lastEvent: structures["4h"].lastEvent ? `${structures["4h"].lastEvent!.kind} ${structures["4h"].lastEvent!.direction}` : "—", zone: structures["4h"].zone, lastLabelHigh: structures["4h"].lastLabelHigh ?? "—", lastLabelLow: structures["4h"].lastLabelLow ?? "—", price: structures["4h"].price },
    { timeframe: "1d" as Timeframe, trend: structures["1d"].trend, lastEvent: structures["1d"].lastEvent ? `${structures["1d"].lastEvent!.kind} ${structures["1d"].lastEvent!.direction}` : "—", zone: structures["1d"].zone, lastLabelHigh: structures["1d"].lastLabelHigh ?? "—", lastLabelLow: structures["1d"].lastLabelLow ?? "—", price: structures["1d"].price },
  ];

  const sessions = sessionStates(h1.length ? h1 : c15);
  const fibWindow = (structures[primaryTf]?.events.length ? c15 : c15.slice(-240));
  const fib = fibonacci(fibWindow, fibWindow[0]?.time ?? 0, fibWindow[fibWindow.length - 1]?.time ?? 0, primaryTf);
  const dv = dailyVwap(c15.slice(-300));
  const wv = weeklyVwap(h1.slice(-500));

  const analysis: FullAnalysis = {
    instrument,
    price: +price.toFixed(2),
    asOf: new Date().toISOString(),
    structures,
    mtf: mtfAlignment(mtfRows),
    ict: runIctScan(c15, "15m"),
    liquidity: buildLiquidityReport(d1, c15, instrument, "15m"),
    sessions,
    sessionStats: sessionStatistics(h1),
    openings: dailyOpenings(c15),
    activeSessionName: activeSession(sessions),
    volatility: buildVolatilityReport(h1, d1, d1.slice(-60)),
    orderFlow: buildOrderFlow(c15, "15m"),
    regime: detectRegime(h1, "1h"),
    patterns: findHistoricalPatterns(h1.length > 450 ? h1 : c15, { horizonBars: 12, topK: 10 }),
    fib,
    vwap: {
      daily: dv,
      weekly: wv,
      deviation: deviationLevels(c15.slice(-120), dv.current ?? price, 40),
    },
    profile: volumeProfile(c15.slice(-240), 48),
    heatmap: buildHeatmap(c15.slice(-240), instrument, "15m", 48),
  };
  cache.set(key, analysis, ANALYSIS_TTL);
  return analysis;
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

export async function getTechnicalPredictions(instrument: Instrument): Promise<PredictionOutput[]> {
  const key = `predict:tech:${instrument}`;
  const hit = cache.get<PredictionOutput[]>(key);
  if (hit) return hit;

  const [c15, h1] = await Promise.all([load(instrument, "15m", 900), load(instrument, "1h", 900)]);
  const regime = detectRegime(h1, "1h");
  const of = buildOrderFlow(c15, "15m");
  const liq = buildLiquidityReport((await load(instrument, "1d", 200)), c15, instrument, "15m");
  const cvdBias = Math.max(-1, Math.min(1, (of.buyerPct - 50) / 20));
  let liqBias = 0;
  if (liq.likelyTarget) liqBias = liq.likelyTarget.side === "BUY" ? 0.5 : -0.5;
  const structures = [analyzeStructure(c15, "15m"), analyzeStructure(h1, "1h")];
  const mtfScore = mtfAlignment(structures.map((s, i) => ({ timeframe: (i === 0 ? "15m" : "1h") as Timeframe, trend: s.trend, lastEvent: s.lastEvent ? `${s.lastEvent.kind} ${s.lastEvent.direction}` : "", zone: s.zone, lastLabelHigh: "", lastLabelLow: "", price: s.price }))).score / 100;

  const horizons = ["15m", "1h", "4h", "session", "1d", "5d"];
  const out: PredictionOutput[] = [];
  for (const h of horizons) {
    out.push(technicalPrediction(h1.length > 300 ? h1 : c15, "1h", h, instrument, {
      regime: regime.regime, cvdBias, mtfScore, liquidityBias: liqBias,
    }));
  }
  cache.set(key, out, 60);
  return out;
}

export async function getFundamentalPrediction(instrument: Instrument, horizon = "1d"): Promise<PredictionOutput> {
  const key = `predict:fund:${instrument}:${horizon}`;
  const hit = cache.get<PredictionOutput>(key);
  if (hit) return hit;

  const [news, macro] = await Promise.all([
    fetchAndStoreNews().catch(() => []),
    getMacroAssets().catch(() => []),
  ]);
  const byKey = new Map(macro.map((m) => [m.key, m]));
  const dxy = byKey.get("DXY");
  const y10 = byKey.get("US10Y");
  const y2 = byKey.get("US2Y");
  const vix = byKey.get("VIX");

  // calendar: next high-impact events (from demo/finnhub — handled by calendar service)
  const eventsAhead: { name: string; hoursAway: number }[] = [];
  try {
    const { getUpcomingEvents } = await import("./calendar");
    const evs = await getUpcomingEvents();
    for (const e of evs.filter((e) => e.impact === "HIGH").slice(0, 3)) {
      eventsAhead.push({ name: e.name, hoursAway: (new Date(e.eventTime).getTime() - Date.now()) / 3600000 });
    }
  } catch { /* ignore */ }

  const sentiment = aggregateSentiment(news);
  const fedTone = news.filter((n) => n.category === "FED" || n.category === "FOMC").slice(0, 8);
  const fedAvg = fedTone.length ? fedTone.reduce((a, b) => a + b.sentimentScore, 0) / fedTone.length : 0;

  const pred = fundamentalPrediction(instrument, horizon, 0, {
    dxyTrend5d: dxy?.changePct1d !== null && dxy ? +(dxy.changePct1d! * 3).toFixed(2) : 0,
    yield10Change5d: y10 ? +(y10.changePct1d ?? 0) * 0.1 : 0,
    yield2Change5d: y2 ? +(y2.changePct1d ?? 0) * 0.1 : 0,
    vixLevel: vix?.quote?.price ?? undefined,
    vixChange5d: vix?.changePct1d ? +(vix.changePct1d * 3).toFixed(2) : 0,
    newsSentiment: sentiment,
    newsCount: news.length,
    highImpactEventsAhead: eventsAhead,
    centralBankTone: +fedAvg.toFixed(2),
  });
  cache.set(key, pred, 120);
  return pred;
}

// ---------------------------------------------------------------------------
// Confluence
// ---------------------------------------------------------------------------

export async function getConfluence(instrument: Instrument): Promise<ConfluenceOutput> {
  const key = `confluence:${instrument}`;
  const hit = cache.get<ConfluenceOutput>(key);
  if (hit) return hit;

  const analysis = await getFullAnalysis(instrument);
  const [techList, fund, news] = await Promise.all([
    getTechnicalPredictions(instrument),
    getFundamentalPrediction(instrument).catch(() => null),
    fetchAndStoreNews().catch(() => []),
  ]);
  const tech = techList.find((t) => t.horizon === "1h") ?? techList[0] ?? null;

  const conf = buildConfluence({
    fundamental: fund,
    technical: tech,
    structures: [analysis.structures["15m"], analysis.structures["1h"], analysis.structures["4h"]],
    liquidity: analysis.liquidity,
    orderFlow: analysis.orderFlow,
    volatility: analysis.volatility,
    regime: analysis.regime,
    sessions: analysis.sessions,
    newsSentiment: aggregateSentiment(news),
    instrument,
    price: analysis.price,
  });
  cache.set(key, conf, 45);
  return conf;
}

// ---------------------------------------------------------------------------
// Setups
// ---------------------------------------------------------------------------

export async function getSetups(instrument: Instrument, rules: SetupRules): Promise<SetupScanResult> {
  const key = `setups:${instrument}:${JSON.stringify(rules)}`;
  const hit = cache.get<SetupScanResult>(key);
  if (hit) return hit;

  const [c15, c1h, c4h] = await Promise.all([
    load(instrument, "15m", 700),
    load(instrument, "1h", 500),
    load(instrument, "4h", 400),
  ]);
  const [conf, liqAnalysis] = await Promise.all([
    getConfluence(instrument).catch(() => null),
    getFullAnalysis(instrument).catch(() => null),
  ]);
  const result = generateSetups({
    candles15m: c15, candles1h: c1h, candles4h: c4h, instrument, rules,
    confluence: conf,
    liquidity: liqAnalysis?.liquidity ?? null,
    orderFlow: liqAnalysis?.orderFlow ?? null,
    volatility: liqAnalysis?.volatility ?? null,
    sessions: liqAnalysis?.sessions ?? [],
  });
  cache.set(key, result, 60);
  return result;
}

/** Default rules from the user's DB settings, with platform defaults. */
export async function getRulesForInstrument(instrument: Instrument): Promise<SetupRules> {
  try {
    const user = await db.user.findFirst({ include: { settings: true } });
    const s = user?.settings;
    if (!s) return DEFAULTS;
    return {
      minRR: s.minRiskReward,
      requireMss: s.requireMss,
      requireSweep: s.requireSweep,
      requireDisplacement: s.requireDisplacement,
      requireFvg: s.requireFvg,
      requireHtfAlignment: s.requireHtfAlignment,
      requireFundamentalAlignment: s.requireFundAlignment,
      sessionFilter: s.sessionFilter,
      maxVolatilityGuard: s.maxVolatilityGuard,
    };
  } catch {
    return DEFAULTS;
  }
}

const DEFAULTS: SetupRules = {
  minRR: 3, requireMss: false, requireSweep: false, requireDisplacement: false,
  requireFvg: false, requireHtfAlignment: true, requireFundamentalAlignment: false,
  sessionFilter: "ALL", maxVolatilityGuard: true,
};

/** Ensure the default user exists (single-user sandbox mode) and return it. */
export async function ensureDefaultUser() {
  let user = await db.user.findFirst({ include: { settings: true } });
  if (!user) {
    user = await db.user.create({
      data: {
        email: "trader@gold-intelligence.local",
        name: "Primary Trader",
        settings: { create: {} },
      },
      include: { settings: true },
    });
  }
  if (!user.settings) {
    user = await db.user.update({
      where: { id: user.id },
      data: { settings: { create: {} } },
      include: { settings: true },
    });
  }
  return user;
}
