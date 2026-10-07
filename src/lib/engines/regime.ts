/**
 * Market regime detector — statistical classification into trend/range/
 * volatility/consolidation/reversal/breakout states with probabilities and
 * supporting evidence. A "manipulation candidate" is only flagged with a
 * sweep + reclaim + displacement sequence, never from a single wick.
 */
import type { Candle, MarketRegime, RegimeReport, Timeframe } from "./types";
import { atr, lastValue, mean, percentile, stdev } from "./indicators";
import { findSwings } from "./structure";
import { detectSweeps } from "./ict";

export function detectRegime(candles: Candle[], timeframe: Timeframe): RegimeReport {
  if (candles.length < 60) {
    return {
      regime: "RANGING", secondary: null, probabilities: { RANGING: 0.5 },
      evidence: ["Insufficient history — defaulting to RANGING"], transitions: [], history: [], confidence: 0.3,
    };
  }
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const a14 = lastValue(atr(candles, 14)) ?? 1;

  // Efficiency ratio (Kaufman): net move / path length → trendiness
  const window = 20;
  const seg = closes.slice(-window - 1);
  const net = Math.abs(seg[seg.length - 1] - seg[0]);
  let path = 0;
  for (let i = 1; i < seg.length; i++) path += Math.abs(seg[i] - seg[i - 1]);
  const er = path > 0 ? net / path : 0;

  // Volatility percentile (20-bar realized vol vs 1-year of 20-bar vols)
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const vol20 = stdev(rets.slice(-20)) * Math.sqrt(252 * 24) * 100;
  const volSeries: number[] = [];
  for (let i = 20; i <= rets.length; i++) volSeries.push(stdev(rets.slice(i - 20, i)) * Math.sqrt(252 * 24) * 100);
  const volPct = volSeries.length ? (volSeries.filter((v) => v <= vol20).length / volSeries.length) * 100 : 50;

  // Range compression: recent range vs 50-bar range
  const recentRange = Math.max(...closes.slice(-10)) - Math.min(...closes.slice(-10));
  const longRange = Math.max(...closes.slice(-50)) - Math.min(...closes.slice(-50));
  const compression = longRange > 0 ? recentRange / longRange : 1;

  // Breakout: price beyond 20-bar extreme
  const hi20 = Math.max(...candles.slice(-21, -1).map((c) => c.high));
  const lo20 = Math.min(...candles.slice(-21, -1).map((c) => c.low));
  const breakoutUp = price > hi20;
  const breakoutDown = price < lo20;

  // Directional move
  const move20 = ((price - closes[closes.length - 21]) / closes[closes.length - 21]) * 100;

  // Reversal evidence: CHoCH-like — prior trend + recent opposite displacement
  const swings = findSwings(candles, 3);
  const lastHighs = swings.filter((s) => s.kind === "HIGH").slice(-2);
  const lastLows = swings.filter((s) => s.kind === "LOW").slice(-2);
  const potentialReversal =
    (lastHighs.length === 2 && lastHighs[1].price < lastHighs[0].price && move20 > 0) ||
    (lastLows.length === 2 && lastLows[1].price > lastLows[0].price && move20 < 0);

  // Manipulation candidate: recent sweep + reclaim + displacement
  const sweeps = detectSweeps(candles.slice(-80), { swingStrength: 3 });
  const lastSweep = sweeps[sweeps.length - 1] ?? null;
  const manipulation = lastSweep && lastSweep.reclaimed && lastSweep.displacementAfter &&
    candles[candles.length - 1].time - lastSweep.time < 12 * 3600;

  // Score each regime
  const scores: Partial<Record<MarketRegime, number>> = {
    TRENDING_BULLISH: (er > 0.35 && move20 > 0.3 ? 0.5 : 0.05) + (breakoutUp ? 0.25 : 0) + (move20 > 1 ? 0.15 : 0),
    TRENDING_BEARISH: (er > 0.35 && move20 < -0.3 ? 0.5 : 0.05) + (breakoutDown ? 0.25 : 0) + (move20 < -1 ? 0.15 : 0),
    RANGING: (er < 0.25 ? 0.45 : 0.05) + (compression > 0.5 && compression < 1.1 ? 0.2 : 0),
    HIGH_VOLATILITY: (volPct > 80 ? 0.5 : 0.05) + (a14 > 0 ? Math.min(0.2, (vol20 / 20) * 0.05) : 0),
    LOW_VOLATILITY: (volPct < 20 ? 0.5 : 0.05) + (compression < 0.35 ? 0.2 : 0),
    CONSOLIDATION: (compression < 0.45 ? 0.4 : 0.03) + (er < 0.2 ? 0.15 : 0),
    POTENTIAL_REVERSAL: potentialReversal ? 0.42 : 0.03,
    BREAKOUT: breakoutUp || breakoutDown ? 0.45 : 0.03,
    MANIPULATION_CANDIDATE: manipulation ? 0.4 : 0.02,
  };
  const totalScore = Object.values(scores).reduce((a, b) => a + (b ?? 0), 0) || 1;
  const probs: Partial<Record<MarketRegime, number>> = {};
  for (const [k, v] of Object.entries(scores)) probs[k as MarketRegime] = +(((v ?? 0) / totalScore)).toFixed(3);
  const sorted = Object.entries(probs).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [MarketRegime, number][];
  const regime = sorted[0][0];
  const secondary = sorted[1][0];

  // Recent regime history (classify in 30-bar steps, cheap approximation using ER + move)
  const history: { time: number; regime: MarketRegime }[] = [];
  const step = Math.max(20, Math.floor(candles.length / 24));
  for (let i = step; i < candles.length; i += step) {
    const segC = closes.slice(Math.max(0, i - window - 1), i + 1);
    const netS = Math.abs(segC[segC.length - 1] - segC[0]);
    let pathS = 0;
    for (let j = 1; j < segC.length; j++) pathS += Math.abs(segC[j] - segC[j - 1]);
    const erS = pathS > 0 ? netS / pathS : 0;
    const moveS = ((closes[i] - closes[i - window]) / closes[i - window]) * 100;
    history.push({
      time: candles[i].time,
      regime: erS > 0.3 ? (moveS > 0 ? "TRENDING_BULLISH" : "TRENDING_BEARISH") : "RANGING",
    });
  }

  const evidence: string[] = [
    `Efficiency ratio ${er.toFixed(2)} over last ${window} bars (>${0.35} = trending)`,
    `Realized volatility percentile ${volPct.toFixed(0)}%`,
    `Range compression ${(compression * 100).toFixed(0)}% of 50-bar range`,
    `20-bar move ${move20.toFixed(2)}%`,
  ];
  if (breakoutUp) evidence.push(`Price above 20-bar high ${hi20.toFixed(2)} — breakout condition`);
  if (breakoutDown) evidence.push(`Price below 20-bar low ${lo20.toFixed(2)} — breakout condition`);
  if (manipulation) evidence.push(`Recent ${lastSweep!.kind} with reclaim + displacement (sequence-based, not a single wick)`);
  if (potentialReversal) evidence.push("Swing labels show opposing pressure to the recent move (potential reversal)");

  const transitions: string[] = [];
  if (regime === "CONSOLIDATION") transitions.push("Consolidations resolve — expect expansion; watch 20-bar range extremes.");
  if (regime === "BREAKOUT") transitions.push("Breakouts from compression fail often without displacement — demand candle-body confirmation.");
  if (regime === "TRENDING_BULLISH" && volPct > 85) transitions.push("Extended trend with very high volatility — pullback risk elevated.");
  if (regime === "TRENDING_BEARISH" && volPct > 85) transitions.push("Extended bearish trend with very high volatility — short-covering spikes possible.");

  const confidence = +Math.min(0.95, 0.4 + (sorted[0][1] ?? 0)).toFixed(2);

  return {
    regime,
    secondary,
    probabilities: Object.fromEntries(sorted.slice(0, 4).map(([k, v]) => [k, v])) as Partial<Record<MarketRegime, number>>,
    evidence,
    transitions,
    history,
    confidence,
  };
}
