/**
 * Liquidity intelligence engine.
 *
 * IMPORTANT HONesty NOTE (enforced by design): this engine INFERRES liquidity
 * from observable price action (swing highs/lows, equal highs/lows, session
 * extremes, prior day/week extremes). It does NOT have access to resting
 * stop-loss orders and never claims to. Reports carry an explicit `basis`
 * string that the UI must display.
 */
import type { Candle, EqualLevels, LiquidityPool, LiquidityReport, LiquiditySweep, Timeframe } from "./types";
import { findSwings } from "./structure";
import { detectEqualLevels, detectSweeps } from "./ict";

const DAY = 86400;

function dayKey(t: number) { return Math.floor(t / DAY); }

/** Previous trading day's high/low from daily candles. */
export function prevDayHighLow(daily: Candle[]): { pdh: number | null; pdl: number | null; pwh: number | null; pwl: number | null } {
  const d = new Date();
  const todayKey = dayKey(Math.floor(Date.now() / 1000));
  const days = daily.filter((c) => dayKey(c.time) < todayKey).sort((a, b) => b.time - a.time);
  const pd = days[0] ?? null;
  // previous week: complete ISO week before the current one
  const weeks = new Map<number, Candle[]>();
  for (const c of days) {
    const t = new Date(c.time * 1000);
    const day = t.getUTCDay();
    const monday = dayKey(c.time) - ((day + 6) % 7);
    if (!weeks.has(monday)) weeks.set(monday, []);
    weeks.get(monday)!.push(c);
  }
  const sortedWeeks = [...weeks.entries()].sort((a, b) => b[0] - a[0]);
  const pw = sortedWeeks[0]?.[1] ?? null;
  return {
    pdh: pd ? +pd.high.toFixed(2) : null,
    pdl: pd ? +pd.low.toFixed(2) : null,
    pwh: pw ? +Math.max(...pw.map((c) => c.high)).toFixed(2) : null,
    pwl: pw ? +Math.min(...pw.map((c) => c.low)).toFixed(2) : null,
  };
}

export function buildLiquidityReport(
  candles: Candle[],
  intraday: Candle[],
  instrument: import("./types").Instrument,
  timeframe: Timeframe,
): LiquidityReport {
  const price = candles.length ? candles[candles.length - 1].close : 0;
  const swings = findSwings(candles, 3);
  const eq = detectEqualLevels(candles);
  const sweeps = detectSweeps(candles);
  const { pdh, pdl, pwh, pwl } = prevDayHighLow(candles);

  const pools: LiquidityPool[] = [];
  const push = (p: Omit<LiquidityPool, "distance" | "distancePct">) => {
    pools.push({
      ...p,
      distance: +(p.price - price).toFixed(2),
      distancePct: +(((p.price - price) / price) * 100).toFixed(3),
    });
  };

  // swing-based pools (recent, above and below)
  const recentHighs = swings.filter((s) => s.kind === "HIGH").slice(-8);
  const recentLows = swings.filter((s) => s.kind === "LOW").slice(-8);
  for (const s of recentHighs) {
    if (s.price <= price) continue;
    push({
      id: `sw-${s.time}`, side: "BUY", kind: "SWING_HIGH",
      label: `Swing high ${new Date(s.time * 1000).toISOString().slice(5, 16).replace("T", " ")} UTC`,
      price: +s.price.toFixed(2), strength: Math.min(1, 0.4 + s.strength * 0.1),
      status: "OPEN", formedAt: s.time, touches: 1,
    });
  }
  for (const s of recentLows) {
    if (s.price >= price) continue;
    push({
      id: `sw-${s.time}`, side: "SELL", kind: "SWING_LOW",
      label: `Swing low ${new Date(s.time * 1000).toISOString().slice(5, 16).replace("T", " ")} UTC`,
      price: +s.price.toFixed(2), strength: Math.min(1, 0.4 + s.strength * 0.1),
      status: "OPEN", formedAt: s.time, touches: 1,
    });
  }
  // equal levels → stronger pools (multiple touches)
  for (const e of eq) {
    const side = e.kind === "EQH" ? "BUY" : "SELL";
    if ((side === "BUY" && e.price <= price) || (side === "SELL" && e.price >= price)) continue;
    push({
      id: `eq-${e.times[0]}`, side, kind: e.kind,
      label: `${e.kind} × ${e.count} touches`,
      price: e.price, strength: Math.min(1, 0.55 + e.count * 0.12),
      status: "OPEN", formedAt: e.times[e.times.length - 1], touches: e.count,
    });
  }
  // PDH/PDL/PWH/PWL
  const addRef = (p: number | null, side: "BUY" | "SELL", kind: string, label: string, formedAt: number) => {
    if (p === null) return;
    if ((side === "BUY" && p <= price) || (side === "SELL" && p >= price)) return;
    push({ id: kind, side, kind, label, price: p, strength: 0.8, status: "OPEN", formedAt, touches: 1 });
  };
  if (pdh) addRef(pdh, "BUY", "PDH", "Previous Day High", Date.now() / 1000 - DAY);
  if (pdl) addRef(pdl, "SELL", "PDL", "Previous Day Low", Date.now() / 1000 - DAY);
  if (pwh) addRef(pwh, "BUY", "PWH", "Previous Week High", Date.now() / 1000 - 7 * DAY);
  if (pwl) addRef(pwl, "SELL", "PWL", "Previous Week Low", Date.now() / 1000 - 7 * DAY);

  // consumed (already swept) pools from recent sweeps
  const consumed: LiquidityPool[] = sweeps.slice(-6).map((s: LiquiditySweep) => ({
    id: `swept-${s.time}`,
    side: s.kind === "BSL_SWEEP" ? "BUY" : "SELL",
    kind: "SWEPT",
    label: `${s.kind} @ ${s.sweepPrice}`,
    price: s.referencePrice,
    distance: +(s.referencePrice - price).toFixed(2),
    distancePct: +(((s.referencePrice - price) / price) * 100).toFixed(3),
    strength: 0.3,
    status: "SWEPT" as const,
    formedAt: s.time,
    touches: 1,
  }));

  const bsl = pools.filter((p) => p.side === "BUY").sort((a, b) => a.price - b.price)[0] ?? null;
  const ssl = pools.filter((p) => p.side === "SELL").sort((a, b) => b.price - a.price)[0] ?? null;

  // Likely target: the nearer pool gets higher prior, weighted by strength
  let likely: LiquidityPool | null = null;
  let confidence = 0;
  if (bsl && ssl) {
    const dB = bsl.distance, dS = Math.abs(ssl.distance);
    const scoreB = (1 / (1 + dB / (price * 0.004))) * (0.5 + bsl.strength / 2);
    const scoreS = (1 / (1 + dS / (price * 0.004))) * (0.5 + ssl.strength / 2);
    likely = scoreB >= scoreS ? bsl : ssl;
    confidence = +(Math.max(scoreB, scoreS) * 100).toFixed(1);
  } else likely = bsl ?? ssl;

  // sweep zone: 0.15% band just beyond the likely target
  let sweepZone: LiquidityReport["sweepZone"] = null;
  if (likely) {
    const band = price * 0.0015;
    sweepZone = likely.side === "BUY"
      ? { top: +(likely.price + band * 2).toFixed(2), bottom: +likely.price.toFixed(2), side: "BUY" }
      : { top: +likely.price.toFixed(2), bottom: +(likely.price - band * 2).toFixed(2), side: "SELL" };
  }

  // potential reversal zone: nearest unfilled FVG or OB confluence beyond the sweep — approximate
  // with the midpoint between target and the next pool on the other side
  let reversal: LiquidityReport["potentialReversalZone"] = null;
  const opposite = likely?.side === "BUY" ? ssl : bsl;
  if (likely && opposite) {
    const mid = (likely.price + opposite.price) / 2;
    reversal = {
      top: +(Math.max(mid, Math.min(likely.price, opposite.price)) ).toFixed(2),
      bottom: +(Math.min(mid, Math.max(likely.price, opposite.price))).toFixed(2),
    };
  }

  return {
    instrument,
    price: +price.toFixed(2),
    asOf: new Date().toISOString(),
    nearestBsl: bsl,
    nearestSsl: ssl,
    likelyTarget: likely,
    targetConfidence: confidence,
    sweepZone,
    consumed,
    pools: pools.sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance)),
    recentSweeps: sweeps,
    potentialReversalZone: reversal,
    basis:
      "Inferred liquidity from observable price action (swing points, equal highs/lows, prior day/week extremes, session ranges). This is NOT exchange order-book depth and does not claim to know resting stop-loss orders.",
    timeframe,
  };
}

/** Multi-timeframe heatmap from executed volume + inferred pools. */
export function buildHeatmap(
  candles: Candle[],
  instrument: import("./types").Instrument,
  timeframe: Timeframe,
  bins = 48,
): import("./types").HeatmapReport {
  const price = candles.length ? candles[candles.length - 1].close : 0;
  if (!candles.length) {
    return { instrument, timeframe, asOf: new Date().toISOString(), price: 0, levels: [], maxIntensity: 1, dataBasis: "EXECUTED_VOLUME + INFERRED", note: "No data" };
  }
  const hi = Math.max(...candles.map((c) => c.high));
  const lo = Math.min(...candles.map((c) => c.low));
  const binSize = Math.max((hi - lo) / bins, 0.05);
  const n = Math.ceil((hi - lo) / binSize);
  const buyV = new Array(n).fill(0);
  const sellV = new Array(n).fill(0);
  for (const c of candles) {
    const v = c.volume ?? 0;
    const closeFrac = c.high === c.low ? 0.5 : (c.close - c.low) / (c.high - c.low);
    const loBin = Math.min(n - 1, Math.max(0, Math.floor((c.low - lo) / binSize)));
    const hiBin = Math.min(n - 1, Math.max(0, Math.floor((c.high - lo) / binSize)));
    const per = v / (hiBin - loBin + 1);
    for (let b = loBin; b <= hiBin; b++) {
      buyV[b] += per * closeFrac;
      sellV[b] += per * (1 - closeFrac);
    }
  }
  const max = Math.max(...buyV, ...sellV, 1e-9);
  const levels = buyV.map((b, i) => {
    const p = +(lo + (i + 0.5) * binSize).toFixed(2);
    const near = Math.abs(p - price) < price * 0.001;
    return {
      price: p,
      buyIntensity: +(b / max).toFixed(3),
      sellIntensity: +(sellV[i] / max).toFixed(3),
      executedVolume: +(b + sellV[i]).toFixed(2),
      restingOrderBook: null,
      basis: (near ? "EXECUTED_VOLUME" : "INFERRED") as "EXECUTED_VOLUME" | "INFERRED",
    };
  });
  return {
    instrument, timeframe,
    asOf: new Date().toISOString(),
    price: +price.toFixed(2),
    levels, maxIntensity: 1,
    dataBasis: "EXECUTED_VOLUME + INFERRED (no real order-book feed connected)",
    note:
      "Green→bright rows = executed buy-side volume concentration; darker rows = sell-side. No live depth-of-market feed is connected, so resting order-book liquidity is shown as unavailable rather than fabricated.",
  };
}
