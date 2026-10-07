/**
 * Intermarket analysis — correlations, rolling correlation, relative
 * strength, divergence detection. Correlations are reported as measured
 * over explicit windows; stability/causality is never assumed.
 */
import type { Candle } from "./types";
import { pearson } from "./indicators";

export interface CorrelationRow {
  pair: string;
  correlation: number;
  window: string;
  interpretation: string;
}

export interface RollingPoint { time: number; value: number }

export interface IntermarketReport {
  instrument: string;
  correlationMatrix: { asset: string; value: number }[];
  rollingCorrelation: { asset: string; series: RollingPoint[] }[];
  relativeStrength: { asset: string; goldVsAssetPct: number }[];
  divergences: { asset: string; kind: "BULLISH" | "BEARISH" | null; note: string }[];
  windowDays: number;
  note: string;
}

const closes = (c: Candle[]) => c.map((x) => x.close);

function alignAndCorrelate(a: Candle[], b: Candle[], windowBars: number): number {
  const n = Math.min(a.length, b.length, windowBars);
  if (n < 20) return 0;
  return +pearson(closes(a).slice(-n), closes(b).slice(-n)).toFixed(3);
}

function rollingCorr(a: Candle[], b: Candle[], windowBars: number, step: number, points = 40): RollingPoint[] {
  const out: RollingPoint[] = [];
  const n = Math.min(a.length, b.length);
  if (n < windowBars + step) return out;
  const start = n - windowBars - (points - 1) * step;
  for (let i = Math.max(0, start); i + windowBars <= n; i += step) {
    const wa = closes(a).slice(i, i + windowBars);
    const wb = closes(b).slice(i, i + windowBars);
    out.push({ time: a[i + windowBars - 1].time, value: +pearson(wa, wb).toFixed(3) });
  }
  return out;
}

export function buildIntermarketReport(
  gold: Candle[],
  assets: { name: string; candles: Candle[]; inverse?: boolean }[],
  windowBars = 90,
): IntermarketReport {
  const matrix = assets.map((a) => ({
    asset: a.name,
    value: alignAndCorrelate(gold, a.candles, windowBars),
  }));
  const rolling = assets.map((a) => ({
    asset: a.name,
    series: rollingCorr(gold, a.candles, 30, 6, 40),
  }));

  // relative strength: gold % vs asset % over the window
  const rs = assets.map((a) => {
    const g0 = gold[Math.max(0, gold.length - windowBars)]?.close ?? 0;
    const g1 = gold[gold.length - 1]?.close ?? 0;
    const a0 = a.candles[Math.max(0, a.candles.length - windowBars)]?.close ?? 0;
    const a1 = a.candles[a.candles.length - 1]?.close ?? 0;
    const goldPct = g0 ? ((g1 - g0) / g0) * 100 : 0;
    const assetPct = a0 ? ((a1 - a0) / a0) * 100 : 0;
    return { asset: a.name, goldVsAssetPct: +(goldPct - assetPct).toFixed(2) };
  });

  // divergences: gold made new 20-bar high/low but asset did not (and vice versa)
  const divergences = assets.map((a) => {
    const gWin = gold.slice(-20);
    const aWin = a.candles.slice(-20);
    if (gWin.length < 20 || aWin.length < 20) return { asset: a.name, kind: null as "BULLISH" | "BEARISH" | null, note: "Insufficient aligned history" };
    const gHigh = gWin[gWin.length - 1].close >= Math.max(...gWin.map((c) => c.close)) - 1e-9;
    const aHigh = aWin[aWin.length - 1].close >= Math.max(...aWin.map((c) => c.close)) - 1e-9;
    const gLow = gWin[gWin.length - 1].close <= Math.min(...gWin.map((c) => c.close)) + 1e-9;
    const aLow = aWin[aWin.length - 1].close <= Math.min(...aWin.map((c) => c.close)) + 1e-9;
    const inverse = a.inverse ?? false;
    if (gHigh && !aHigh) {
      return {
        asset: a.name, kind: (inverse ? "BEARISH" : "BULLISH") as "BULLISH" | "BEARISH" | null,
        note: `Gold at 20-bar closing high while ${a.name} has not confirmed${inverse ? " (expected inverse)" : ""} — divergence`,
      };
    }
    if (gLow && !aLow) {
      return {
        asset: a.name, kind: (inverse ? "BULLISH" : "BEARISH") as "BULLISH" | "BEARISH" | null,
        note: `Gold at 20-bar closing low while ${a.name} has not confirmed${inverse ? " (expected inverse)" : ""} — divergence`,
      };
    }
    return { asset: a.name, kind: null as "BULLISH" | "BEARISH" | null, note: "No divergence" };
  });

  return {
    instrument: "GOLD",
    correlationMatrix: matrix,
    rollingCorrelation: rolling,
    relativeStrength: rs,
    divergences,
    windowDays: windowBars,
    note: "Correlations are measured over explicit windows and change over time; the platform never assumes correlation stability or causality.",
  };
}

/** Gold/Silver ratio series from two aligned candle arrays. */
export function goldSilverRatio(gold: Candle[], silver: Candle[]): { time: number; value: number }[] {
  const out: { time: number; value: number }[] = [];
  const m = new Map(silver.map((c) => [c.time, c.close]));
  for (const g of gold) {
    const s = m.get(g.time);
    if (s && s > 0) out.push({ time: g.time, value: +(g.close / s).toFixed(2) });
  }
  return out;
}
