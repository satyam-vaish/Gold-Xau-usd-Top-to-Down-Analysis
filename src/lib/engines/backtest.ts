/**
 * Backtesting engine — event-driven, no look-ahead bias:
 * signals are computed ONLY on closed bars; entries fill at the NEXT bar's
 * open with spread + slippage + commission. Walk-forward segments included.
 */
import type { BacktestMetrics, BacktestReport, BacktestTrade, Candle, Timeframe } from "./types";
import { atr, lastValue, mean, stdev } from "./indicators";
import { findSwings } from "./structure";
import { detectFvgs, detectSweeps } from "./ict";

export const STRATEGIES = [
  "ICT_LIQUIDITY_SWEEP",
  "MSS_FVG",
  "ORDER_BLOCK_RETEST",
  "QUASIMODO_FIB",
  "LONDON_KILLZONE",
  "NY_KILLZONE",
  "VWAP_REVERSION",
  "VOLUME_PROFILE",
] as const;
export type StrategyName = (typeof STRATEGIES)[number];

export const STRATEGY_LABELS: Record<StrategyName, string> = {
  ICT_LIQUIDITY_SWEEP: "ICT Liquidity Sweep",
  MSS_FVG: "MSS + FVG",
  ORDER_BLOCK_RETEST: "Order Block Retest",
  QUASIMODO_FIB: "Quasimodo + Fibonacci",
  LONDON_KILLZONE: "London Killzone",
  NY_KILLZONE: "New York Killzone",
  VWAP_REVERSION: "VWAP Reversion",
  VOLUME_PROFILE: "Volume Profile Strategy",
};

interface Signal {
  index: number;      // bar index where signal fires (bar CLOSED)
  direction: "LONG" | "SHORT";
  stop: number;
  target: number;     // computed from minRR
}

function sessionOf(t: number): string {
  const h = new Date(t * 1000).getUTCHours();
  if (h >= 0 && h < 7) return "ASIAN";
  if (h >= 7 && h < 12) return "LONDON";
  if (h >= 12 && h < 21) return "NEW_YORK";
  return "SYDNEY";
}

function sessionAllowed(t: number, filter: string): boolean {
  if (filter === "ALL") return true;
  return sessionOf(t) === filter;
}

/** Generate signals bar-by-bar using only data ≤ i (closed bars). */
function generateSignals(
  candles: Candle[],
  strategy: StrategyName,
  minRR: number,
  sessionFilter: string,
): Signal[] {
  const signals: Signal[] = [];
  const n = candles.length;
  for (let i = 60; i < n - 2; i++) {
    const past = candles.slice(Math.max(0, i - 160), i + 1); // window ending at CLOSED bar i
    const c = past[past.length - 1];
    if (!sessionAllowed(c.time, sessionFilter)) continue;
    const a1 = lastValue(atr(past, 14)) ?? ((c.high - c.low) || 1);
    let sig: Signal | null = null;

    if (strategy === "ICT_LIQUIDITY_SWEEP") {
      const sweeps = detectSweeps(past, { swingStrength: 3 });
      const s = sweeps[sweeps.length - 1];
      if (s && c.time - s.time <= 6 * 3600 && s.displacementAfter) {
        if (s.kind === "SSL_SWEEP" && c.close > s.referencePrice) {
          sig = { index: i, direction: "LONG", stop: s.sweepPrice - a1 * 0.3, target: 0 };
        } else if (s.kind === "BSL_SWEEP" && c.close < s.referencePrice) {
          sig = { index: i, direction: "SHORT", stop: s.sweepPrice + a1 * 0.3, target: 0 };
        }
        if (sig) {
          const risk = Math.abs(c.close - sig.stop);
          sig.target = sig.direction === "LONG" ? c.close + risk * minRR : c.close - risk * minRR;
        }
      }
    } else if (strategy === "MSS_FVG") {
      const fvgs = detectFvgs(past, { maxAgeBars: 40 });
      const swings = findSwings(past, 3);
      const lastSwingHigh = swings.filter((s) => s.kind === "HIGH").slice(-1)[0];
      const lastSwingLow = swings.filter((s) => s.kind === "LOW").slice(-1)[0];
      const f = fvgs[fvgs.length - 1];
      if (f && f.displacement) {
        // bullish MSS: close above last swing high then price returns into bullish FVG
        if (lastSwingHigh && c.close > lastSwingHigh.price && f.direction === "BULLISH" && c.low <= f.top && c.close >= f.bottom) {
          const risk = f.top - (f.bottom - a1 * 0.3);
          sig = { index: i, direction: "LONG", stop: f.bottom - a1 * 0.3, target: c.close + risk * minRR };
        } else if (lastSwingLow && c.close < lastSwingLow.price && f.direction === "BEARISH" && c.high >= f.bottom && c.close <= f.top) {
          const risk = (f.top + a1 * 0.3) - f.bottom;
          sig = { index: i, direction: "SHORT", stop: f.top + a1 * 0.3, target: c.close - risk * minRR };
        }
      }
    } else if (strategy === "ORDER_BLOCK_RETEST") {
      // simplified: strong impulse candle followed by retest of its origin
      const c1 = past[past.length - 1], c2 = past[past.length - 2], c3 = past[past.length - 3];
      const impulseUp = c3.close - c3.open >= 1.2 * a1;
      const impulseDown = c3.open - c3.close >= 1.2 * a1;
      if (impulseUp && c2.close > c3.high && c.low <= c3.high && c.close > c3.open) {
        const risk = c3.high - (c3.low - a1 * 0.3);
        sig = { index: i, direction: "LONG", stop: c3.low - a1 * 0.3, target: c.close + risk * minRR };
      } else if (impulseDown && c2.close < c3.low && c.high >= c3.low && c.close < c3.open) {
        const risk = (c3.high + a1 * 0.3) - c3.low;
        sig = { index: i, direction: "SHORT", stop: c3.high + a1 * 0.3, target: c.close - risk * minRR };
      }
    } else if (strategy === "QUASIMODO_FIB") {
      const swings = findSwings(past, 3);
      const highs = swings.filter((s) => s.kind === "HIGH");
      const lows = swings.filter((s) => s.kind === "LOW");
      if (highs.length >= 3) {
        const [ls, head, rs] = highs.slice(-3);
        const betweenLows = lows.filter((l) => l.time > ls.time && l.time < rs.time);
        const neckline = betweenLows.length ? Math.min(...betweenLows.map((l) => l.price)) : null;
        if (neckline && head.price > ls.price && rs.price < head.price && c.close < neckline && c.close < c.open) {
          const risk = Math.abs(neckline - (neckline + (neckline - head.price)));
          sig = { index: i, direction: "SHORT", stop: head.price + a1 * 0.2, target: c.close - risk * minRR };
        }
      }
      if (!sig && lows.length >= 3) {
        const [ls, head, rs] = lows.slice(-3);
        const betweenHighs = highs.filter((h) => h.time > ls.time && h.time < rs.time);
        const neckline = betweenHighs.length ? Math.max(...betweenHighs.map((h) => h.price)) : null;
        if (neckline && head.price < ls.price && rs.price > head.price && c.close > neckline && c.close > c.open) {
          const risk = Math.abs((neckline + (neckline - head.price)) - neckline);
          sig = { index: i, direction: "LONG", stop: head.price - a1 * 0.2, target: c.close + risk * minRR };
        }
      }
    } else if (strategy === "LONDON_KILLZONE" || strategy === "NY_KILLZONE") {
      const h = new Date(c.time * 1000).getUTCHours();
      const kz = strategy === "LONDON_KILLZONE" ? h === 7 || h === 8 || h === 9 : h === 12 || h === 13 || h === 14;
      if (kz && past.length >= 8) {
        // opening range of the KZ (first 3 bars of window in kz) — breakout trade
        const kzBars = past.slice(-4, -1);
        const orHigh = Math.max(...kzBars.map((b) => b.high));
        const orLow = Math.min(...kzBars.map((b) => b.low));
        if (c.close > orHigh && c.close > c.open) {
          sig = { index: i, direction: "LONG", stop: orLow - a1 * 0.2, target: c.close + (orHigh - orLow) * minRR };
        } else if (c.close < orLow && c.close < c.open) {
          sig = { index: i, direction: "SHORT", stop: orHigh + a1 * 0.2, target: c.close - (orHigh - orLow) * minRR };
        }
      }
    } else if (strategy === "VWAP_REVERSION") {
      // daily VWAP proxy on intraday window
      const dayStart = Math.floor(c.time / 86400) * 86400;
      const dayCandles = past.filter((b) => b.time >= dayStart);
      let pv = 0, vv = 0;
      for (const b of dayCandles) {
        const tp = (b.high + b.low + b.close) / 3;
        const v = b.volume ?? 1;
        pv += tp * v; vv += v;
      }
      const vwap = vv > 0 ? pv / vv : null;
      if (vwap) {
        const dev = (c.close - vwap) / a1;
        if (dev >= 2.2 && c.close < c.open) {
          sig = { index: i, direction: "SHORT", stop: c.high + a1 * 0.5, target: vwap };
        } else if (dev <= -2.2 && c.close > c.open) {
          sig = { index: i, direction: "LONG", stop: c.low - a1 * 0.5, target: vwap };
        }
      }
    } else if (strategy === "VOLUME_PROFILE") {
      // POC reversion: price far from rolling POC returns to it
      const win = past.slice(-48);
      const hi = Math.max(...win.map((b) => b.high));
      const lo = Math.min(...win.map((b) => b.low));
      const bins = 24;
      const size = (hi - lo) / bins || 1e-9;
      const vols = new Array(bins).fill(0);
      for (const b of win) {
        const v = b.volume ?? 1;
        const bi = Math.min(bins - 1, Math.max(0, Math.floor(((b.high + b.low + b.close) / 3 - lo) / size)));
        vols[bi] += v;
      }
      const pocIdx = vols.indexOf(Math.max(...vols));
      const poc = lo + (pocIdx + 0.5) * size;
      const dev = (c.close - poc) / a1;
      if (dev >= 2.4 && c.close < c.open) sig = { index: i, direction: "SHORT", stop: c.high + a1 * 0.4, target: poc };
      else if (dev <= -2.4 && c.close > c.open) sig = { index: i, direction: "LONG", stop: c.low - a1 * 0.4, target: poc };
    }

    if (sig) signals.push(sig);
  }
  return signals;
}

export function runBacktest(args: {
  candles: Candle[];
  instrument: import("./types").Instrument;
  timeframe: Timeframe;
  strategy: StrategyName;
  sessionFilter?: string;
  dateFrom: number;
  dateTo: number;
  minRR?: number;
  riskPct?: number;
  initialEquity?: number;
  spread?: number;
  commissionPerLot?: number;
  slippage?: number;
}): BacktestReport {
  const {
    candles, instrument, timeframe, strategy,
    sessionFilter = "ALL", dateFrom, dateTo,
    minRR = 3, riskPct = 1, initialEquity = 10000,
    spread = 0.35, commissionPerLot = 3.5, slippage = 0.12,
  } = args;

  const data = candles
    .filter((c) => c.time >= dateFrom && c.time <= dateTo)
    .sort((a, b) => a.time - b.time);

  const notes = [
    `Assumptions: spread $${spread}/oz, slippage $${slippage}/oz per fill, commission $${commissionPerLot}/lot (100oz), risk ${riskPct}% of equity per trade.`,
    "Signals are evaluated on CLOSED bars only; fills occur at the next bar open (no look-ahead).",
    "Intraday-based strategies (VWAP/VP/Killzones) are only meaningful on intraday timeframes.",
    "Results are simulated and historical; they do not guarantee future performance.",
  ];

  if (data.length < 120) {
    return {
      request: { instrument, timeframe, strategy, sessionFilter, dateFrom: new Date(dateFrom * 1000).toISOString(), dateTo: new Date(dateTo * 1000).toISOString(), minRR, riskPct },
      assumptions: { spread, commissionPerLot, slippage },
      metrics: zeroMetrics(),
      equityCurve: [{ time: dateFrom, equity: initialEquity }],
      trades: [], monthly: [], walkForward: [],
      notes: [...notes, `Insufficient candles in range (${data.length} loaded — need ≥ 120).`],
    };
  }

  const signals = generateSignals(data, strategy, minRR, sessionFilter);

  // simulate
  const trades: BacktestTrade[] = [];
  let equity = initialEquity;
  const equityCurve: { time: number; equity: number }[] = [{ time: data[0].time, equity }];
  let i = 0;
  const used = new Set<number>();

  for (const sig of signals) {
    if (used.has(sig.index)) continue;
    used.add(sig.index);
    const entryIdx = sig.index + 1; // next bar open — no look-ahead
    if (entryIdx >= data.length) continue;
    const entryBar = data[entryIdx];
    const dir = sig.direction;
    const fill = dir === "LONG" ? entryBar.open + spread / 2 + slippage : entryBar.open - spread / 2 - slippage;
    const risk = Math.abs(fill - sig.stop) || 1e-9;
    const size = (equity * riskPct / 100) / risk; // units of oz
    const commission = (size / 100) * commissionPerLot;

    // walk forward until SL or TP hit (conservative: SL first if both inside same bar)
    let exitPrice: number | null = null;
    let exitTime = entryBar.time;
    let exitReason: BacktestTrade["exitReason"] = "END";
    for (let j = entryIdx; j < data.length; j++) {
      const b = data[j];
      const hitSl = dir === "LONG" ? b.low <= sig.stop : b.high >= sig.stop;
      const hitTp = dir === "LONG" ? b.high >= sig.target : b.low <= sig.target;
      if (hitSl) { exitPrice = sig.stop; exitTime = b.time; exitReason = "SL"; break; }
      if (hitTp) { exitPrice = sig.target; exitTime = b.time; exitReason = "TP"; break; }
      // time stop: 48 bars
      if (j - entryIdx >= 48) { exitPrice = b.close; exitTime = b.time; exitReason = "EOD"; break; }
    }
    if (exitPrice === null) { exitPrice = data[data.length - 1].close; exitTime = data[data.length - 1].time; }

    const gross = dir === "LONG" ? (exitPrice - fill) * size : (fill - exitPrice) * size;
    const pnl = gross - commission;
    equity += pnl;
    const rMult = pnl / (equity * riskPct / 100);
    trades.push({
      entryTime: entryBar.time, exitTime, direction: dir,
      entry: +fill.toFixed(2), exit: +exitPrice.toFixed(2),
      stop: +sig.stop.toFixed(2), target: +sig.target.toFixed(2),
      size: +size.toFixed(2), pnl: +pnl.toFixed(2), rMultiple: +rMult.toFixed(2),
      outcome: pnl > 1 ? "WIN" : pnl < -1 ? "LOSS" : "BE",
      exitReason, session: sessionOf(entryBar.time),
    });
    equityCurve.push({ time: exitTime, equity: +equity.toFixed(2) });
    i++;
  }

  const metrics = computeMetrics(trades, equityCurve, initialEquity);

  // monthly returns
  const monthlyMap = new Map<string, number[]>();
  let lastEq = initialEquity;
  const byMonth = new Map<string, number>();
  for (const p of equityCurve) {
    const m = new Date(p.time * 1000).toISOString().slice(0, 7);
    byMonth.set(m, p.equity);
  }
  let prev = initialEquity;
  const monthly: { month: string; returnPct: number }[] = [];
  for (const [m, eq] of [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    monthly.push({ month: m, returnPct: +(((eq - prev) / prev) * 100).toFixed(2) });
    prev = eq;
  }

  // walk-forward: split into 4 sequential segments, report each
  const wf: BacktestReport["walkForward"] = [];
  const segSize = Math.floor(trades.length / 4);
  for (let s = 0; s < 4; s++) {
    const seg = trades.slice(s * segSize, s === 3 ? undefined : (s + 1) * segSize);
    if (!seg.length) continue;
    const wins = seg.filter((t) => t.pnl > 0);
    const losses = seg.filter((t) => t.pnl < 0);
    const gp = wins.reduce((a, b) => a + b.pnl, 0);
    const gl = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));
    wf.push({
      segment: `W${s + 1}`,
      winRate: +((wins.length / seg.length) * 100).toFixed(1),
      profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : gp > 0 ? 99 : 0,
      netReturnPct: +((seg.reduce((a, b) => a + b.pnl, 0) / initialEquity) * 100).toFixed(2),
    });
  }

  return {
    request: { instrument, timeframe, strategy, sessionFilter, dateFrom: new Date(dateFrom * 1000).toISOString(), dateTo: new Date(dateTo * 1000).toISOString(), minRR, riskPct },
    assumptions: { spread, commissionPerLot, slippage },
    metrics, equityCurve, trades, monthly, walkForward: wf, notes,
  };
}

function computeMetrics(trades: BacktestTrade[], curve: { time: number; equity: number }[], initial: number): BacktestMetrics {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const gp = wins.reduce((a, b) => a + b.pnl, 0);
  const gl = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));
  let peak = initial, maxDd = 0;
  for (const p of curve) {
    peak = Math.max(peak, p.equity);
    maxDd = Math.max(maxDd, (peak - p.equity) / peak);
  }
  const rs = trades.map((t) => t.rMultiple);
  const avgR = mean(rs);
  const sdR = stdev(rs) || 1e-9;
  let winStreak = 0, lossStreak = 0, curW = 0, curL = 0;
  for (const t of trades) {
    if (t.pnl > 0) { curW++; curL = 0; } else if (t.pnl < 0) { curL++; curW = 0; }
    winStreak = Math.max(winStreak, curW);
    lossStreak = Math.max(lossStreak, curL);
  }
  return {
    totalTrades: trades.length,
    winRate: trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : 0,
    profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : gp > 0 ? 99 : 0,
    netReturnPct: curve.length ? +(((curve[curve.length - 1].equity - initial) / initial) * 100).toFixed(2) : 0,
    maxDrawdownPct: +(maxDd * 100).toFixed(2),
    avgRR: +(wins.length ? mean(wins.map((t) => t.rMultiple)) : 0).toFixed(2),
    expectancyR: +avgR.toFixed(3),
    sharpe: trades.length > 1 ? +(mean(rs) / sdR * Math.sqrt(Math.min(trades.length, 100))).toFixed(2) : 0,
    avgWinR: wins.length ? +mean(wins.map((t) => t.rMultiple)).toFixed(2) : 0,
    avgLossR: losses.length ? +mean(losses.map((t) => t.rMultiple)).toFixed(2) : 0,
    longestWinStreak: winStreak,
    longestLossStreak: lossStreak,
  };
}

function zeroMetrics(): BacktestMetrics {
  return {
    totalTrades: 0, winRate: 0, profitFactor: 0, netReturnPct: 0, maxDrawdownPct: 0,
    avgRR: 0, expectancyR: 0, sharpe: 0, avgWinR: 0, avgLossR: 0,
    longestWinStreak: 0, longestLossStreak: 0,
  };
}
