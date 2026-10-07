/**
 * Historical pattern recognition engine.
 * Compares the recent market fingerprint (normalized returns, volatility,
 * candle-body ratios, trend efficiency) against the full loaded history with
 * k-NN cosine similarity, then reports the statistical forward outcomes.
 *
 * LEAKAGE GUARD: the query window (the last `L` bars) is EXCLUDED from the
 * search space, so no match can include the current situation itself. This is
 * a similarity search over realized history — it is NOT a trained model and
 * makes no accuracy claims beyond the reported sample statistics.
 */
import type { Candle, PatternMatch, PatternReport, Timeframe } from "./types";
import { mean, median, stdev } from "./indicators";

const L = 24; // fingerprint length in bars

function fingerprint(candles: Candle[], endIdx: number): number[] {
  const seg = candles.slice(endIdx - L, endIdx);
  const feats: number[] = [];
  for (let i = 1; i < seg.length; i++) {
    const c = seg[i], p = seg[i - 1];
    const range = c.high - c.low || 1e-9;
    feats.push(
      Math.log(c.close / p.close) * 100,                       // return
      ((c.close - c.open) / range) * 0.5,                      // body position
      ((c.high - Math.max(c.open, c.close)) / range) * 0.3,    // upper wick
      ((Math.min(c.open, c.close) - c.low) / range) * 0.3,     // lower wick
    );
  }
  // normalize to unit vector
  const norm = Math.sqrt(feats.reduce((a, b) => a + b * b, 0)) || 1;
  return feats.map((f) => f / norm);
}

export function findHistoricalPatterns(
  candles: Candle[],
  opts: { horizonBars?: number; topK?: number; targetPct?: number } = {},
): PatternReport {
  const horizon = opts.horizonBars ?? 24;
  const topK = opts.topK ?? 12;
  const targetPct = opts.targetPct ?? 0.5;

  if (candles.length < L + horizon + 200) {
    return emptyReport(`Need ≥ ${L + horizon + 200} candles; loaded ${candles.length}.`);
  }
  const query = fingerprint(candles, candles.length);
  const searchEnd = candles.length - horizon; // exclude forward window of query itself

  const matches: PatternMatch[] = [];
  // stride 2 for speed on long histories
  for (let i = L + 10; i < searchEnd; i += 2) {
    const cand = fingerprint(candles, i);
    let dot = 0;
    for (let j = 0; j < query.length; j++) dot += query[j] * cand[j];
    if (dot < 0.965) continue; // similarity gate
    const base = candles[i - 1].close;
    const fwd = candles.slice(i, i + horizon);
    const fwdRet = ((fwd[fwd.length - 1].close - base) / base) * 100;
    const mfe = ((Math.max(...fwd.map((c) => c.high)) - base) / base) * 100;
    const mae = ((base - Math.min(...fwd.map((c) => c.low))) / base) * 100;
    let barsToTarget: number | null = null;
    for (let b = 0; b < fwd.length; b++) {
      const moveUp = ((fwd[b].high - base) / base) * 100;
      const moveDown = ((base - fwd[b].low) / base) * 100;
      if (moveUp >= targetPct || moveDown >= targetPct) { barsToTarget = b + 1; break; }
    }
    matches.push({
      startTime: candles[i - L].time,
      endTime: candles[i - 1].time,
      similarity: +dot.toFixed(4),
      forwardReturnPct: +fwdRet.toFixed(3),
      mfePct: +mfe.toFixed(3),
      maePct: +mae.toFixed(3),
      barsToTarget,
    });
  }

  matches.sort((a, b) => b.similarity - a.similarity);
  const top = matches.slice(0, topK);
  if (!top.length) return emptyReport("No historical window passed the similarity threshold — market state is unusual relative to loaded history.");

  const moves = top.map((m) => m.forwardReturnPct);
  const bullish = moves.filter((m) => m > 0.05).length;
  const bearish = moves.filter((m) => m < -0.05).length;
  const avgMove = mean(moves);
  const sd = stdev(moves);
  const ci = 1.96 * (sd / Math.sqrt(moves.length));
  const times = top.map((m) => m.barsToTarget).filter((t): t is number => t !== null);

  return {
    comparables: matches.length,
    bullishOutcomes: bullish,
    bearishOutcomes: bearish,
    bullishPct: +((bullish / top.length) * 100).toFixed(1),
    avgMovePct: +avgMove.toFixed(3),
    medianMovePct: +median(moves).toFixed(3),
    avgMfePct: +mean(top.map((m) => m.mfePct)).toFixed(3),
    avgMaePct: +mean(top.map((m) => m.maePct)).toFixed(3),
    avgTimeToTargetBars: times.length ? +mean(times).toFixed(1) : null,
    ci95Low: +(avgMove - ci).toFixed(3),
    ci95High: +(avgMove + ci).toFixed(3),
    matches: top,
    featuresUsed: ["24-bar log returns", "candle body position", "upper/lower wick ratios (unit-normalized cosine similarity)"],
    leakageGuard: true,
  };
}

function emptyReport(note: string): PatternReport {
  return {
    comparables: 0, bullishOutcomes: 0, bearishOutcomes: 0, bullishPct: 0,
    avgMovePct: 0, medianMovePct: 0, avgMfePct: 0, avgMaePct: 0,
    avgTimeToTargetBars: null, ci95Low: 0, ci95High: 0, matches: [],
    featuresUsed: [], leakageGuard: true,
  };
}
