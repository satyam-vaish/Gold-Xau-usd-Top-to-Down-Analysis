/**
 * Market structure engine — swing detection, trend, BOS / CHoCH / MSS,
 * HH/HL/LH/LL labelling, premium/discount zones, S/R levels.
 *
 * Design notes:
 * - Swing detection uses fractal pivots with configurable confirmation strength;
 *   a swing is only emitted after `strength` bars have closed on both sides,
 *   which prevents repainting and "every wick becomes structure" noise.
 * - BOS = break of the last structural swing in trend direction.
 *   CHoCH = first break against the prevailing trend (character change).
 *   MSS = CHoCH confirmed by a displacement candle closing beyond the level
 *   with momentum (body > k × ATR) — stricter than CHoCH.
 */
import type { Candle, StructurePoint, Swing, Timeframe, TimeframeStructure, TrendState } from "./types";
import { atr, lastValue } from "./indicators";

export function findSwings(candles: Candle[], strength = 3): Swing[] {
  const swings: Swing[] = [];
  for (let i = strength; i < candles.length - strength; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) swings.push({ index: i, time: candles[i].time, price: candles[i].high, kind: "HIGH", strength });
    else if (isLow) swings.push({ index: i, time: candles[i].time, price: candles[i].low, kind: "LOW", strength });
  }
  // dedupe consecutive same-kind swings keeping the more extreme one
  const dedup: Swing[] = [];
  for (const s of swings) {
    const last = dedup[dedup.length - 1];
    if (last && last.kind === s.kind) {
      if ((s.kind === "HIGH" && s.price >= last.price) || (s.kind === "LOW" && s.price <= last.price)) {
        dedup[dedup.length - 1] = s;
      }
    } else dedup.push(s);
  }
  return dedup;
}

interface StructureOptions {
  swingStrength?: number;
  mssBodyAtr?: number; // displacement body multiple for MSS
}

export function analyzeStructure(
  candles: Candle[],
  timeframe: Timeframe,
  opts: StructureOptions = {},
): TimeframeStructure {
  const strength = opts.swingStrength ?? 3;
  const mssBodyAtr = opts.mssBodyAtr ?? 1.1;
  const swings = findSwings(candles, strength);
  const price = candles.length ? candles[candles.length - 1].close : 0;
  const atrSeries = atr(candles, 14);
  const lastAtr = lastValue(atrSeries) ?? (price * 0.004 || 1);

  // Build swing sequences (alternating highs/lows) for trend + labels
  const seq = swings;
  const highs: Swing[] = seq.filter((s) => s.kind === "HIGH");
  const lows: Swing[] = seq.filter((s) => s.kind === "LOW");

  // Trend from last two highs and two lows
  let trend: TrendState = "RANGE";
  let lastLabelHigh: "HH" | "LH" | null = null;
  let lastLabelLow: "HL" | "LL" | null = null;
  if (highs.length >= 2 && lows.length >= 2) {
    const h1 = highs[highs.length - 2], h2 = highs[highs.length - 1];
    const l1 = lows[lows.length - 2], l2 = lows[lows.length - 1];
    lastLabelHigh = h2.price > h1.price ? "HH" : "LH";
    lastLabelLow = l2.price < l1.price ? "HL" : "LL";
    if (lastLabelHigh === "HH" && lastLabelLow === "HL") trend = "UPTREND";
    else if (lastLabelHigh === "LH" && lastLabelLow === "LL") trend = "DOWNTREND";
    else trend = "RANGE";
  }

  // Structure events: iterate candles; track most recent confirmed swing high/low BEFORE each bar
  const events: StructurePoint[] = [];
  let trendNow = "NONE" as "UP" | "DOWN" | "NONE";
  let lastConfirmedHigh: Swing | null = null;
  let lastConfirmedLow: Swing | null = null;
  let swingCursor = 0;

  for (let i = 0; i < candles.length; i++) {
    // confirm swings whose right window has closed by bar i
    while (swingCursor < swings.length && swings[swingCursor].index + strength <= i) {
      const s = swings[swingCursor];
      if (s.kind === "HIGH") lastConfirmedHigh = s;
      else lastConfirmedLow = s;
      swingCursor++;
    }
    const c = candles[i];
    const body = Math.abs(c.close - c.open);

    // bullish break of last high
    if (lastConfirmedHigh && c.close > lastConfirmedHigh.price) {
      const dir: "BULLISH" | "BEARISH" = "BULLISH";
      const kind = trendNow === "UP" ? "BOS" : trendNow === "DOWN" ? "CHoCH" : "BOS";
      const displaced = body > mssBodyAtr * lastAtr;
      events.push({
        kind: displaced && kind !== "BOS" ? "MSS" : kind,
        direction: dir,
        time: lastConfirmedHigh.time,
        price: lastConfirmedHigh.price,
        fromSwing: lastConfirmedHigh,
        confirmTime: c.time,
      });
      if (kind === "CHoCH" || kind === "MSS") trendNow = "UP";
      lastConfirmedHigh = null;
    }
    // bearish break of last low
    if (lastConfirmedLow && c.close < lastConfirmedLow.price) {
      const kind = trendNow === "DOWN" ? "BOS" : trendNow === "UP" ? "CHoCH" : "BOS";
      const displaced = body > mssBodyAtr * lastAtr;
      events.push({
        kind: displaced && kind !== "BOS" ? "MSS" : kind,
        direction: "BEARISH",
        time: lastConfirmedLow.time,
        price: lastConfirmedLow.price,
        fromSwing: lastConfirmedLow,
        confirmTime: c.time,
      });
      if (kind === "CHoCH" || kind === "MSS") trendNow = "DOWN";
      lastConfirmedLow = null;
    }
  }

  // Keep only the most recent 12 events
  const trimmed = events.slice(-12);

  // Range / premium-discount over the analysis window
  const lookback = candles.slice(-Math.min(candles.length, 120));
  const rangeHigh = lookback.length ? Math.max(...lookback.map((c) => c.high)) : 0;
  const rangeLow = lookback.length ? Math.min(...lookback.map((c) => c.low)) : 0;
  const equilibrium = (rangeHigh + rangeLow) / 2;
  const band = (rangeHigh - rangeLow) * 0.05;
  const zone: TimeframeStructure["zone"] =
    price > equilibrium + band ? "PREMIUM" : price < equilibrium - band ? "DISCOUNT" : "EQUILIBRIUM";

  // Support/resistance from recent swing clusters (±0.15% bucket)
  const tol = price * 0.0015 || 1;
  const cluster = (arr: Swing[]) => {
    const out: number[] = [];
    const sorted = [...arr].sort((a, b) => a.price - b.price);
    let bucket: number[] = [];
    for (const s of sorted) {
      if (!bucket.length || Math.abs(s.price - bucket[bucket.length - 1]) <= tol) bucket.push(s.price);
      else { out.push(+(bucket.reduce((x, y) => x + y, 0) / bucket.length).toFixed(2)); bucket = [s.price]; }
    }
    if (bucket.length) out.push(+(bucket.reduce((x, y) => x + y, 0) / bucket.length).toFixed(2));
    return out;
  };
  const resistances = cluster(highs.slice(-6)).filter((p) => p > price).sort((a, b) => a - b);
  const supports = cluster(lows.slice(-6)).filter((p) => p < price).sort((a, b) => b - a);

  return {
    timeframe,
    trend,
    swings: swings.slice(-24),
    highs: highs.slice(-6),
    lows: lows.slice(-6),
    lastHigh: highs[highs.length - 1] ?? null,
    lastLow: lows[lows.length - 1] ?? null,
    events: trimmed,
    lastEvent: trimmed[trimmed.length - 1] ?? null,
    rangeHigh: +rangeHigh.toFixed(2),
    rangeLow: +rangeLow.toFixed(2),
    equilibrium: +equilibrium.toFixed(2),
    zone,
    price: +price.toFixed(2),
    support: supports.slice(0, 4),
    resistance: resistances.slice(0, 4),
    lastLabelHigh,
    lastLabelLow,
  };
}

export interface MtfRow {
  timeframe: Timeframe;
  trend: TrendState;
  lastEvent: string;
  zone: string;
  lastLabelHigh: string;
  lastLabelLow: string;
  price: number;
}

/** Multi-timeframe confluence matrix — alignment description across TFs. */
export function mtfAlignment(rows: MtfRow[]): { alignment: "ALIGNED_BULLISH" | "ALIGNED_BEARISH" | "MIXED"; score: number; summary: string } {
  if (!rows.length) return { alignment: "MIXED", score: 0, summary: "No timeframe data" };
  let score = 0;
  for (const r of rows) {
    if (r.trend === "UPTREND") score += 1;
    else if (r.trend === "DOWNTREND") score -= 1;
    const ev = r.lastEvent.toUpperCase();
    if (ev.includes("BULLISH")) score += 0.5;
    else if (ev.includes("BEARISH")) score -= 0.5;
  }
  const normalized = Math.round((score / (rows.length * 1.5)) * 100);
  if (normalized >= 45) return { alignment: "ALIGNED_BULLISH", score: normalized, summary: "Bullish structure across most timeframes" };
  if (normalized <= -45) return { alignment: "ALIGNED_BEARISH", score: normalized, summary: "Bearish structure across most timeframes" };
  return { alignment: "MIXED", score: normalized, summary: "Timeframes disagree — treat as mixed/multi-directional" };
}
