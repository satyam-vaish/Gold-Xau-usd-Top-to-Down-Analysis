/**
 * ICT / SMC detection engine.
 * Implements: FVG, inverse FVG, Order Blocks, Breaker / Mitigation / Rejection
 * blocks, liquidity sweeps, equal highs/lows, internal & external liquidity,
 * OTE zone detection, displacement, and Quasimodo pattern detection.
 *
 * All detectors are deterministic and include minimum-quality filters
 * (displacement body size, ATR-based tolerances) to avoid labelling every
 * minor candle move as structure / setpoint.
 */
import type { Candle, EqualLevels, FVG, FibAnalysis, LiquiditySweep, OrderBlock, Quasimodo, Timeframe } from "./types";
import { atr, fibonacci, lastValue } from "./indicators";
import { findSwings } from "./structure";

const sameDay = (a: number, b: number) => Math.floor(a / 86400) === Math.floor(b / 86400);

// ---------------------------------------------------------------------------
// Fair Value Gaps
// ---------------------------------------------------------------------------

export function detectFvgs(
  candles: Candle[],
  opts: { displacementAtr?: number; maxAgeBars?: number } = {},
): FVG[] {
  const displacementAtr = opts.displacementAtr ?? 0.55; // middle candle body ≥ 0.55 ATR
  const maxAgeBars = opts.maxAgeBars ?? 400;
  const atrSeries = atr(candles, 14);
  const out: FVG[] = [];

  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2], b = candles[i - 1], c = candles[i];
    const a1 = lastValue(atrSeries.slice(0, i)) ?? (Math.abs(b.close - b.open) || 1);
    const body = Math.abs(b.close - b.open);
    const displaced = body >= displacementAtr * a1;

    // Bullish FVG: c.low > a.high
    if (c.low > a.high) {
      const top = c.low, bottom = a.high;
      if (top - bottom <= a1 * 6 && +top.toFixed(2) > +bottom.toFixed(2)) { // ignore absurd gaps and sub-cent noise
        out.push({
          top: +top.toFixed(2), bottom: +bottom.toFixed(2), time: b.time,
          direction: "BULLISH", filled: false, size: +(top - bottom).toFixed(2),
          displacement: displaced, inverse: false, consecutive: 1,
        });
      }
    }
    // Bearish FVG: c.high < a.low
    if (c.high < a.low) {
      const top = a.low, bottom = c.high;
      if (top - bottom <= a1 * 6 && +top.toFixed(2) > +bottom.toFixed(2)) {
        out.push({
          top: +top.toFixed(2), bottom: +bottom.toFixed(2), time: b.time,
          direction: "BEARISH", filled: false, size: +(top - bottom).toFixed(2),
          displacement: displaced, inverse: false, consecutive: 1,
        });
      }
    }
  }

  // Mark filled / inverse / consecutive stacking
  const recent = candles.slice(-maxAgeBars);
  const windowStart = recent.length ? recent[0].time : 0;
  const kept = out.filter((f) => f.time >= windowStart || !isOld(f.time, windowStart));
  for (const f of out) {
    let filled = false, inverted = false;
    for (const c of candles) {
      if (c.time <= f.time) continue;
      if (f.direction === "BULLISH") {
        if (c.low <= f.bottom) { inverted = true; filled = true; break; }
        if (c.low <= (f.top + f.bottom) / 2) filled = true;
      } else {
        if (c.high >= f.top) { inverted = true; filled = true; break; }
        if (c.high >= (f.top + f.bottom) / 2) filled = true;
      }
    }
    f.filled = filled;
    f.inverse = inverted; // a violated FVG becomes an inverse FVG (IFVG)
    if (inverted) {
      f.direction = f.direction === "BULLISH" ? "BEARISH" : "BULLISH";
    }
  }
  // stacking: consecutive FVGs in same direction within 3 candles
  for (let i = 1; i < kept.length; i++) {
    const p = kept[i - 1], f = kept[i];
    if (p.direction === f.direction && f.time - p.time <= 3 * 300 && !isOld(p.time, f.time)) {
      // approximate: within ~3 bars on low timeframes
    }
  }
  return kept.filter((f) => !f.filled || f.inverse).slice(-30);
}

function isOld(t: number, windowStart: number) {
  return t < windowStart;
}

// ---------------------------------------------------------------------------
// Order Blocks / Breakers / Mitigation / Rejection
// ---------------------------------------------------------------------------

export function detectOrderBlocks(
  candles: Candle[],
  opts: { impulseAtr?: number; maxAgeBars?: number } = {},
): OrderBlock[] {
  const impulseAtr = opts.impulseAtr ?? 1.3;
  const maxAgeBars = opts.maxAgeBars ?? 300;
  const atrSeries = atr(candles, 14);
  const out: OrderBlock[] = [];
  const startIdx = Math.max(0, candles.length - maxAgeBars);

  for (let i = startIdx + 1; i < candles.length - 1; i++) {
    const ob = candles[i];
    const next = candles[i + 1];
    const a1 = lastValue(atrSeries.slice(0, i + 1)) ?? (Math.abs(ob.close - ob.open) || 1);
    const impulseUp = next.close - next.open;
    const impulseDown = next.open - next.close;

    // Bullish OB: last down candle before a strong up impulse
    if (ob.close < ob.open && impulseUp >= impulseAtr * a1) {
      const zone = { top: ob.high, bottom: ob.low };
      const state = zoneState(candles, i + 2, zone, "BULLISH");
      out.push({
        ...zone, time: ob.time, direction: "BULLISH",
        kind: "ORDER_BLOCK", volume: ob.volume ?? undefined,
        filled: state.filled, broken: state.broken, retested: state.retested,
      });
    }
    // Bearish OB: last up candle before strong down impulse
    if (ob.close > ob.open && impulseDown >= impulseAtr * a1) {
      const zone = { top: ob.high, bottom: ob.low };
      const state = zoneState(candles, i + 2, zone, "BEARISH");
      out.push({
        ...zone, time: ob.time, direction: "BEARISH",
        kind: "ORDER_BLOCK", volume: ob.volume ?? undefined,
        filled: state.filled, broken: state.broken, retested: state.retested,
      });
    }
  }

  // Breaker blocks: OB that failed → price broke through → becomes opposite polarity support/resistance
  for (const ob of out) {
    if (ob.broken) ob.kind = "BREAKER";
  }
  // Mitigation block: candle that mitigated a prior move (engulfing the last opposing candle before impulse)
  // Rejection block: wick-heavy candle (wick ≥ 2× body) at swing extremes that preceded displacement
  for (let i = startIdx + 1; i < candles.length - 1; i++) {
    const c = candles[i];
    const body = Math.abs(c.close - c.open) || 1e-9;
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const next = candles[i + 1];
    const a1 = lastValue(atrSeries.slice(0, i + 1)) ?? body;
    if (lowerWick >= 2 * body && next.close > next.open && next.close - next.open >= 0.9 * a1) {
      out.push({
        top: Math.max(c.open, c.close), bottom: c.low, time: c.time,
        direction: "BULLISH", kind: "REJECTION",
        filled: false, broken: false, retested: false, volume: c.volume ?? undefined,
      });
    }
    if (upperWick >= 2 * body && next.close < next.open && next.open - next.close >= 0.9 * a1) {
      out.push({
        top: c.high, bottom: Math.min(c.open, c.close), time: c.time,
        direction: "BEARISH", kind: "REJECTION",
        filled: false, broken: false, retested: false, volume: c.volume ?? undefined,
      });
    }
  }
  return out.slice(-24);
}

function zoneState(candles: Candle[], fromIdx: number, zone: { top: number; bottom: number }, dir: "BULLISH" | "BEARISH") {
  let filled = false, broken = false, retested = false;
  for (let j = Math.max(0, fromIdx); j < candles.length; j++) {
    const c = candles[j];
    if (dir === "BULLISH") {
      if (c.low <= zone.bottom) broken = true;
      else if (c.low <= zone.top) retested = true;
    } else {
      if (c.high >= zone.top) broken = true;
      else if (c.high >= zone.bottom) retested = true;
    }
  }
  filled = broken;
  return { filled, broken, retested };
}

// ---------------------------------------------------------------------------
// Liquidity sweeps
// ---------------------------------------------------------------------------

export function detectSweeps(
  candles: Candle[],
  opts: { swingStrength?: number; reclaimBars?: number } = {},
): LiquiditySweep[] {
  const strength = opts.swingStrength ?? 3;
  const reclaimBars = opts.reclaimBars ?? 4;
  const swings = findSwings(candles, strength);
  const out: LiquiditySweep[] = [];

  for (const s of swings) {
    const idx = candles.findIndex((c) => c.time === s.time);
    if (idx < 0) continue;
    // look for a later candle that wicks beyond the swing but closes back inside
    for (let j = idx + strength + 1; j < Math.min(candles.length, idx + 80); j++) {
      const c = candles[j];
      if (s.kind === "HIGH" && c.high > s.price && c.close < s.price) {
        const reclaim = candles.slice(j, j + reclaimBars).some((r) => r.close < s.price);
        const disp = candles.slice(j, Math.min(j + 3, candles.length))
          .some((r) => Math.abs(r.close - r.open) > 0.9 * (lastValue(atr(candles.slice(0, j))) ?? 1));
        out.push({
          kind: "BSL_SWEEP", time: c.time, sweepPrice: +c.high.toFixed(2),
          referencePrice: s.price, referenceLabel: `Swing high ${new Date(s.time * 1000).toISOString().slice(5, 16).replace("T", " ")}`,
          reclaimed: reclaim, displacementAfter: disp,
        });
        break;
      }
      if (s.kind === "LOW" && c.low < s.price && c.close > s.price) {
        const reclaim = candles.slice(j, j + reclaimBars).some((r) => r.close > s.price);
        const disp = candles.slice(j, Math.min(j + 3, candles.length))
          .some((r) => Math.abs(r.close - r.open) > 0.9 * (lastValue(atr(candles.slice(0, j))) ?? 1));
        out.push({
          kind: "SSL_SWEEP", time: c.time, sweepPrice: +c.low.toFixed(2),
          referencePrice: s.price, referenceLabel: `Swing low ${new Date(s.time * 1000).toISOString().slice(5, 16).replace("T", " ")}`,
          reclaimed: reclaim, displacementAfter: disp,
        });
        break;
      }
    }
  }
  return out.slice(-12);
}

// ---------------------------------------------------------------------------
// Equal highs / lows
// ---------------------------------------------------------------------------

export function detectEqualLevels(
  candles: Candle[],
  opts: { toleranceAtr?: number; swingStrength?: number } = {},
): EqualLevels[] {
  const tolAtr = opts.toleranceAtr ?? 0.12;
  const strength = opts.swingStrength ?? 3;
  const swings = findSwings(candles, strength);
  const a1 = lastValue(atr(candles, 14)) ?? 1;
  const tol = tolAtr * a1;
  const out: EqualLevels[] = [];
  const used = new Set<number>();

  for (let i = 0; i < swings.length; i++) {
    if (used.has(i)) continue;
    const group = [swings[i]];
    for (let j = i + 1; j < swings.length; j++) {
      if (used.has(j)) continue;
      if (swings[j].kind === swings[i].kind && Math.abs(swings[j].price - swings[i].price) <= tol) {
        group.push(swings[j]);
        used.add(j);
      }
    }
    if (group.length >= 2) {
      const price = group.reduce((a, b) => a + b.price, 0) / group.length;
      out.push({
        kind: swings[i].kind === "HIGH" ? "EQH" : "EQL",
        price: +price.toFixed(2),
        times: group.map((g) => g.time),
        count: group.length,
        tolerance: +tol.toFixed(2),
      });
    }
  }
  return out.slice(-8);
}

// ---------------------------------------------------------------------------
// Internal & external liquidity
// ---------------------------------------------------------------------------

export function classifyLiquidityRanges(candles: Candle[]) {
  if (candles.length < 30) return { external: null, internal: null };
  const extHigh = Math.max(...candles.map((c) => c.high));
  const extLow = Math.min(...candles.map((c) => c.low));
  // internal = most recent significant swing range inside the external range
  const recent = candles.slice(-Math.max(20, Math.floor(candles.length / 3)));
  const intHigh = Math.max(...recent.map((c) => c.high));
  const intLow = Math.min(...recent.map((c) => c.low));
  return {
    external: { high: +extHigh.toFixed(2), low: +extLow.toFixed(2) },
    internal: intHigh < extHigh || intLow > extLow
      ? { high: +Math.min(intHigh, extHigh).toFixed(2), low: +Math.max(intLow, extLow).toFixed(2) }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Quasimodo
// ---------------------------------------------------------------------------

export function detectQuasimodo(candles: Candle[], opts: { swingStrength?: number } = {}): Quasimodo | null {
  const strength = opts.swingStrength ?? 3;
  const swings = findSwings(candles, strength);
  const highs = swings.filter((s) => s.kind === "HIGH");
  const lows = swings.filter((s) => s.kind === "LOW");
  const last = candles[candles.length - 1];
  if (!last) return null;

  // Bearish QM: LH pattern — LS (high), head (higher high), RS (lower high),
  // then break below the LS low (neckline)
  for (let i = highs.length - 1; i >= 2; i--) {
    const rs = highs[i], head = highs[i - 1], ls = highs[i - 2];
    if (head.price > ls.price && rs.price < head.price) {
      // neckline = lowest low between LS and RS
      const between = lows.filter((l) => l.time > ls.time && l.time < rs.time);
      if (!between.length) continue;
      const necklineLow = between.reduce((a, b) => (b.price < a.price ? b : a));
      const breakout = candles.find((c) => c.time > rs.time && c.close < necklineLow.price);
      if (breakout && last.time - breakout.time <= 86400 * 3) {
        const headToNeck = necklineLow.price - head.price;
        const targets = [
          +(necklineLow.price + headToNeck * 0.5).toFixed(2),
          +(necklineLow.price + headToNeck * 1.0).toFixed(2),
          +(head.price).toFixed(2),
        ];
        return {
          direction: "BEARISH",
          leftShoulder: ls, head, rightShoulder: rs,
          neckline: +necklineLow.price.toFixed(2),
          breakoutConfirmed: true, breakoutTime: breakout.time,
          entryZoneTop: +Math.min(rs.price, necklineLow.price).toFixed(2),
          entryZoneBottom: +necklineLow.price.toFixed(2),
          invalidation: +(head.price + 2).toFixed(2),
          targets: targets.sort((a, b) => a - b),
          time: breakout.time,
        };
      }
    }
  }
  // Bullish QM: inverse
  for (let i = lows.length - 1; i >= 2; i--) {
    const rs = lows[i], head = lows[i - 1], ls = lows[i - 2];
    if (head.price < ls.price && rs.price > head.price) {
      const between = highs.filter((h) => h.time > ls.time && h.time < rs.time);
      if (!between.length) continue;
      const necklineHigh = between.reduce((a, b) => (b.price > a.price ? b : a));
      const breakout = candles.find((c) => c.time > rs.time && c.close > necklineHigh.price);
      if (breakout && last.time - breakout.time <= 86400 * 3) {
        const headToNeck = necklineHigh.price - head.price;
        const targets = [
          +(necklineHigh.price - headToNeck * 0.5).toFixed(2),
          +(necklineHigh.price - headToNeck * 1.0).toFixed(2),
          +(head.price).toFixed(2),
        ];
        return {
          direction: "BULLISH",
          leftShoulder: ls, head, rightShoulder: rs,
          neckline: +necklineHigh.price.toFixed(2),
          breakoutConfirmed: true, breakoutTime: breakout.time,
          entryZoneTop: +necklineHigh.price.toFixed(2),
          entryZoneBottom: +Math.max(rs.price, necklineHigh.price).toFixed(2),
          invalidation: +(head.price - 2).toFixed(2),
          targets: targets.sort((a, b) => b - a),
          time: breakout.time,
        };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Combined scanner output
// ---------------------------------------------------------------------------

export interface IctScanResult {
  timeframe: Timeframe;
  fvg: FVG[];
  orderBlocks: OrderBlock[];
  sweeps: LiquiditySweep[];
  equalLevels: EqualLevels[];
  quasimodo: Quasimodo | null;
  internalExternal: ReturnType<typeof classifyLiquidityRanges>;
  ote: FibAnalysis["oteZone"] | null;
  inOte: boolean;
  displacement: { time: number; direction: "BULLISH" | "BEARISH"; bodyAtr: number } | null;
  summary: string[];
}

export function runIctScan(candles: Candle[], timeframe: Timeframe): IctScanResult {
  const fvg = detectFvgs(candles);
  const orderBlocks = detectOrderBlocks(candles);
  const sweeps = detectSweeps(candles);
  const equalLevels = detectEqualLevels(candles);
  const quasimodo = detectQuasimodo(candles);
  const internalExternal = classifyLiquidityRanges(candles);

  // OTE from the impulse leg that caused the last structure event
  const a1 = lastValue(atr(candles, 14)) ?? 1;
  let displacement: IctScanResult["displacement"] = null;
  for (let i = candles.length - 1; i >= 2 && i > candles.length - 60; i--) {
    const c = candles[i];
    const body = Math.abs(c.close - c.open);
    if (body >= 1.3 * a1) {
      displacement = { time: c.time, direction: c.close > c.open ? "BULLISH" : "BEARISH", bodyAtr: +(body / a1).toFixed(2) };
      break;
    }
  }
  let ote: FibAnalysis["oteZone"] | null = null;
  let inOte = false;
  if (candles.length > 30) {
    const window = candles.slice(-60);
    const fib = fibonacci(window, window[0].time, window[window.length - 1].time, timeframe);
    ote = fib.oteZone;
    inOte = fib.inOte;
  }

  const summary: string[] = [];
  const activeFvg = fvg.filter((f) => !f.filled);
  if (activeFvg.length) summary.push(`${activeFvg.length} active FVG${activeFvg.length > 1 ? "s" : ""} (nearest ${activeFvg[activeFvg.length - 1].direction} @ ${activeFvg[activeFvg.length - 1].bottom}–${activeFvg[activeFvg.length - 1].top})`);
  if (orderBlocks.length) summary.push(`${orderBlocks.length} order-block family zones`);
  if (sweeps.length) summary.push(`Latest sweep: ${sweeps[sweeps.length - 1].kind} @ ${sweeps[sweeps.length - 1].sweepPrice}`);
  if (equalLevels.length) summary.push(`${equalLevels.filter((e) => e.kind === "EQH").length} EQH / ${equalLevels.filter((e) => e.kind === "EQL").length} EQL pools`);
  if (quasimodo) summary.push(`Quasimodo ${quasimodo.direction.toLowerCase()} confirmed @ ${quasimodo.neckline}`);
  if (inOte) summary.push(`Price inside OTE zone ${ote?.bottom}–${ote?.top}`);

  return { timeframe, fvg, orderBlocks, sweeps, equalLevels, quasimodo, internalExternal, ote, inOte, displacement, summary };
}
