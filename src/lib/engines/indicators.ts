/**
 * Technical indicator primitives — real calculations over candle arrays.
 * No external TA dependency; every function is deterministic and unit-tested.
 */
import type { Candle, FibAnalysis, FibLevel, Timeframe, VwapSeriesPoint, VolumeProfile } from "./types";

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function trueRanges(candles: Candle[]): number[] {
  const out: number[] = [candles.length ? candles[0].high - candles[0].low : 0];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    out.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return out;
}

/** Wilder ATR series */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const tr = trueRanges(candles);
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function lastValue<T>(arr: (T | null)[]): T | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) return arr[i] as T;
  return null;
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

export function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = clamp(Math.floor((p / 100) * (s.length - 1)), 0, s.length - 1);
  return s[idx];
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = mean(a.slice(-n)), mb = mean(b.slice(-n));
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[a.length - n + i] - ma, y = b[b.length - n + i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

// ---------------------------------------------------------------------------
// VWAP family
// ---------------------------------------------------------------------------

export interface VwapResult {
  series: VwapSeriesPoint[];
  current: number | null;
  stdevUpper: number | null; // +1σ band
  stdevLower: number | null;
  stdev2Upper: number | null;
  stdev2Lower: number | null;
}

const DAY_S = 86400;
const WEEK_S = 604800;

function computeAnchoredVwap(candles: Candle[], anchorFn: (t: number) => number): VwapResult {
  const buckets = new Map<number, { pv: number; v: number; pv2: number; time: number }>();
  const order: number[] = [];
  for (const c of candles) {
    const key = anchorFn(c.time);
    const v = c.volume ?? 0;
    const typical = (c.high + c.low + c.close) / 3;
    let b = buckets.get(key);
    if (!b) {
      b = { pv: 0, v: 0, pv2: 0, time: key };
      buckets.set(key, b);
      order.push(key);
    }
    b.pv += typical * v;
    b.v += v;
    b.pv2 += v * typical * typical;
  }
  const series: VwapSeriesPoint[] = [];
  let cumPV = 0, cumV = 0, cumPV2 = 0;
  for (const key of order) {
    const b = buckets.get(key)!;
    cumPV += b.pv; cumV += b.v; cumPV2 += b.pv2;
    const vwap = cumV > 0 ? cumPV / cumV : 0;
    const variance = cumV > 0 ? Math.max(0, cumPV2 / cumV - vwap * vwap) : 0;
    const sd = Math.sqrt(variance);
    series.push({ time: key, value: vwap });
    if (key === order[order.length - 1] && cumV > 0) {
      return {
        series,
        current: vwap,
        stdevUpper: vwap + sd,
        stdevLower: vwap - sd,
        stdev2Upper: vwap + 2 * sd,
        stdev2Lower: vwap - 2 * sd,
      };
    }
  }
  return { series, current: null, stdevUpper: null, stdevLower: null, stdev2Upper: null, stdev2Lower: null };
}

/** Daily-anchored VWAP (resets each UTC day). */
export function dailyVwap(candles: Candle[]): VwapResult {
  return computeAnchoredVwap(candles, (t) => Math.floor(t / DAY_S) * DAY_S);
}

/** Weekly-anchored VWAP (resets Monday 00:00 UTC). */
export function weeklyVwap(candles: Candle[]): VwapResult {
  return computeAnchoredVwap(candles, (t) => {
    const d = new Date(t * 1000);
    const day = d.getUTCDay();
    const midnight = Math.floor(t / DAY_S) * DAY_S;
    return midnight - ((day + 6) % 7) * DAY_S; // back to Monday
  });
}

/** Session VWAP: anchor at a UTC hour boundary (e.g., London open 07:00 UTC). */
export function sessionVwap(candles: Candle[], sessionOpenUtcHour: number): VwapResult {
  return computeAnchoredVwap(candles, (t) => {
    const d = new Date(t * 1000);
    const dayStart = Math.floor(t / DAY_S) * DAY_S;
    const openSec = dayStart + sessionOpenUtcHour * 3600;
    return t >= openSec ? openSec : openSec - DAY_S;
  });
}

/** Anchored VWAP from a specific timestamp. */
export function anchoredVwap(candles: Candle[], anchorTime: number): VwapResult {
  const subset = candles.filter((c) => c.time >= anchorTime);
  return computeAnchoredVwap(subset, () => anchorTime);
}

// ---------------------------------------------------------------------------
// Volume Profile
// ---------------------------------------------------------------------------

export function volumeProfile(candles: Candle[], bins = 60): VolumeProfile {
  if (!candles.length) {
    return { levels: [], poc: 0, vah: 0, val: 0, hvn: [], lvn: [], binSize: 0 };
  }
  const hi = Math.max(...candles.map((c) => c.high));
  const lo = Math.min(...candles.map((c) => c.low));
  const binSize = Math.max((hi - lo) / bins, 0.01);
  const n = Math.ceil((hi - lo) / binSize);
  const vols = new Array(n).fill(0);
  const buys = new Array(n).fill(0);
  const sells = new Array(n).fill(0);

  for (const c of candles) {
    const v = c.volume ?? 0;
    if (v <= 0) continue;
    // distribute candle volume across the bins its range covers
    const loBin = clamp(Math.floor((c.low - lo) / binSize), 0, n - 1);
    const hiBin = clamp(Math.floor((c.high - lo) / binSize), 0, n - 1);
    const span = hiBin - loBin + 1;
    const per = v / span;
    // split buy/sell proxy by where close sits in the range
    const closeFrac = c.high === c.low ? 0.5 : (c.close - c.low) / (c.high - c.low);
    for (let b = loBin; b <= hiBin; b++) {
      vols[b] += per;
      buys[b] += per * closeFrac;
      sells[b] += per * (1 - closeFrac);
    }
  }
  const levels = vols.map((v, i) => ({
    price: +(lo + (i + 0.5) * binSize).toFixed(2),
    volume: v,
    buyVolume: buys[i],
    sellVolume: sells[i],
  }));
  const maxV = Math.max(...vols, 1e-9);
  const pocIdx = vols.indexOf(Math.max(...vols));
  const poc = levels[pocIdx]?.price ?? lo;
  // value area: expand from POC until 70% of volume
  const total = vols.reduce((a, b) => a + b, 0);
  let acc = vols[pocIdx] ?? 0;
  let lower = pocIdx, upper = pocIdx;
  while (acc < total * 0.7 && (lower > 0 || upper < n - 1)) {
    const downVol = lower > 0 ? vols[lower - 1] : -1;
    const upVol = upper < n - 1 ? vols[upper + 1] : -1;
    if (upVol >= downVol) { upper++; acc += Math.max(upVol, 0); }
    else { lower--; acc += Math.max(downVol, 0); }
  }
  const hvn = levels.filter((l) => l.volume > maxV * 0.7).map((l) => l.price);
  const lvn = levels.filter((l) => l.volume < maxV * 0.2 && l.volume > 0).map((l) => l.price);
  return {
    levels,
    poc: +poc.toFixed(2),
    vah: +(levels[upper]?.price ?? hi).toFixed(2),
    val: +(levels[lower]?.price ?? lo).toFixed(2),
    hvn: hvn.slice(0, 8),
    lvn: lvn.slice(0, 8),
    binSize: +binSize.toFixed(2),
  };
}

// ---------------------------------------------------------------------------
// Fibonacci
// ---------------------------------------------------------------------------

const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.705, 0.786, 0.886, 1];
const FIB_EXT = [1.272, 1.618, 2.0, 2.618];

/**
 * Fibonacci from the dominant impulse leg (default: swing low → swing high of `from`..`to` window).
 * direction "UP": impulse up; retracements measured down from high.
 * direction "DOWN": impulse down; retracements measured up from low.
 */
export function fibonacci(
  candles: Candle[],
  from: number,
  to: number,
  timeframe: Timeframe,
): FibAnalysis {
  const window = candles.filter((c) => c.time >= from && c.time <= to);
  let hi = window[0], lo = window[0];
  for (const c of window) {
    if (c.high > hi.high) hi = c;
    if (c.low < lo.low) lo = c;
  }
  const upLeg = hi.time > lo.time; // low formed before high → impulse up
  const direction: "UP" | "DOWN" = upLeg ? "UP" : "DOWN";
  const diff = hi.high - lo.low;
  const levels: FibLevel[] = FIB_RATIOS.map((r) => ({
    ratio: r,
    price: +(direction === "UP" ? hi.high - diff * r : lo.low + diff * r).toFixed(2),
    label: r === 0 ? (direction === "UP" ? "High (0)" : "Low (0)") : r === 1 ? (direction === "UP" ? "Low (1.0)" : "High (1.0)") : r.toFixed(3),
  }));
  const extensionLevels: FibLevel[] = FIB_EXT.map((r) => ({
    ratio: r,
    price: +(direction === "UP" ? lo.low + diff * r : hi.high - diff * r).toFixed(2),
    label: `ext ${r}`,
  }));
  // OTE: 0.618–0.79 retracement of the impulse, in the direction of the trade
  const oteTop = direction === "UP" ? hi.high - diff * 0.618 : lo.low + diff * 0.618;
  const oteBottom = direction === "UP" ? hi.high - diff * 0.79 : lo.low + diff * 0.79;
  const price = window.length ? window[window.length - 1].close : candles[candles.length - 1]?.close ?? 0;
  const inOte = price <= Math.max(oteTop, oteBottom) + 1e-9 && price >= Math.min(oteTop, oteBottom) - 1e-9;
  return {
    anchorHigh: { time: hi.time, price: hi.high },
    anchorLow: { time: lo.time, price: lo.low },
    direction,
    levels,
    oteZone: { top: +Math.max(oteTop, oteBottom).toFixed(2), bottom: +Math.min(oteTop, oteBottom).toFixed(2) },
    inOte,
    extensionLevels,
  };
}

/** Standard deviation projection levels around a reference (e.g., VWAP or session open). */
export function deviationLevels(
  candles: Candle[],
  reference: number,
  period = 20,
): { sigma1: number[]; sigma2: number[]; sigma3: number[]; stdev: number } {
  const closes = candles.slice(-period).map((c) => c.close);
  const sd = stdev(closes);
  return {
    stdev: +sd.toFixed(2),
    sigma1: [+(reference + sd).toFixed(2), +(reference - sd).toFixed(2)],
    sigma2: [+(reference + 2 * sd).toFixed(2), +(reference - 2 * sd).toFixed(2)],
    sigma3: [+(reference + 3 * sd).toFixed(2), +(reference - 3 * sd).toFixed(2)],
  };
}
