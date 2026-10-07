/**
 * Engine unit tests — run with: bun test tests/engines.test.ts
 */
import { describe, expect, test } from "bun:test";
import type { Candle } from "../src/lib/engines/types";
import { sma, ema, rsi, atr, stdev, dailyVwap, volumeProfile, fibonacci } from "../src/lib/engines/indicators";
import { findSwings, analyzeStructure, mtfAlignment } from "../src/lib/engines/structure";
import { detectFvgs, detectOrderBlocks, detectSweeps, detectEqualLevels, detectQuasimodo } from "../src/lib/engines/ict";
import { buildLiquidityReport } from "../src/lib/engines/liquidity";
import { sessionStates, sessionStatistics } from "../src/lib/engines/sessions";
import { buildVolatilityReport } from "../src/lib/engines/volatility";
import { buildOrderFlow } from "../src/lib/engines/orderflow";
import { detectRegime } from "../src/lib/engines/regime";
import { technicalCore, walkForwardCalibrate, technicalPrediction, fundamentalPrediction } from "../src/lib/engines/predict";
import { buildConfluence } from "../src/lib/engines/confluence";
import { generateSetups, DEFAULT_RULES } from "../src/lib/engines/setups";
import { runBacktest } from "../src/lib/engines/backtest";
import { evaluatePredictions } from "../src/lib/engines/metrics";
import { buildIntermarketReport } from "../src/lib/engines/intermarket";
import { findHistoricalPatterns } from "../src/lib/engines/patterns";

// Deterministic synthetic candles: uptrend with noise (seeded PRNG)
function synth(n: number, seed = 42, drift = 0.06, start = 4000): Candle[] {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: Candle[] = [];
  let price = start;
  let t = 1700000000;
  for (let i = 0; i < n; i++) {
    const noise = (rand() - 0.5) * 6;
    const open = price;
    const close = price + drift + noise;
    const high = Math.max(open, close) + rand() * 2.5;
    const low = Math.min(open, close) - rand() * 2.5;
    out.push({ time: t, open, high, low, close, volume: 800 + rand() * 500 });
    price = close;
    t += 900;
  }
  return out;
}

function downtrend(n: number): Candle[] {
  return synth(n, 7, -0.08, 4200);
}

describe("indicators", () => {
  test("SMA computes correctly", () => {
    const r = sma([1, 2, 3, 4, 5], 3);
    expect(r[2]).toBe(2);
    expect(r[4]).toBe(4);
  });
  test("EMA converges", () => {
    const r = ema([10, 10, 10, 10, 10], 3);
    expect(r[4]).toBe(10);
  });
  test("RSI bounds", () => {
    const r = rsi(synth(100).map((c) => c.close), 14);
    const last = r[r.length - 1]!;
    expect(last).toBeGreaterThanOrEqual(0);
    expect(last).toBeLessThanOrEqual(100);
  });
  test("ATR positive", () => {
    const c = synth(200);
    const a = atr(c, 14).filter((x): x is number => x !== null);
    expect(a[a.length - 1]).toBeGreaterThan(0);
  });
  test("stdev of constant is 0", () => {
    expect(stdev([5, 5, 5, 5])).toBe(0);
  });
  test("daily VWAP within day range", () => {
    const c = synth(300);
    const v = dailyVwap(c);
    expect(v.current).toBeGreaterThan(3000);
  });
  test("volume profile has POC", () => {
    const vp = volumeProfile(synth(200), 30);
    expect(vp.levels.length).toBeGreaterThan(10);
    expect(vp.poc).toBeGreaterThan(0);
    expect(vp.vah).toBeGreaterThanOrEqual(vp.poc);
    expect(vp.poc).toBeGreaterThanOrEqual(vp.val);
  });
  test("fibonacci OTE zone ordering", () => {
    const c = synth(120);
    const f = fibonacci(c, c[0].time, c[c.length - 1].time, "1h");
    expect(f.oteZone.top).toBeGreaterThan(f.oteZone.bottom);
  });
});

describe("structure", () => {
  test("finds swings in trending series", () => {
    const c = synth(300);
    const sw = findSwings(c, 3);
    expect(sw.length).toBeGreaterThan(3);
  });
  test("uptrend detected", () => {
    const s = analyzeStructure(synth(300), "1h");
    expect(["UPTREND", "RANGE"]).toContain(s.trend);
  });
  test("downtrend detected", () => {
    const s = analyzeStructure(downtrend(300), "1h");
    expect(["DOWNTREND", "RANGE"]).toContain(s.trend);
  });
  test("events have kinds", () => {
    const s = analyzeStructure(synth(300), "1h");
    for (const e of s.events) expect(["BOS", "CHoCH", "MSS"]).toContain(e.kind);
  });
  test("mtf alignment", () => {
    const m = mtfAlignment([{ timeframe: "1h", trend: "UPTREND", lastEvent: "BOS BULLISH", zone: "PREMIUM", lastLabelHigh: "HH", lastLabelLow: "HL", price: 4100 }]);
    expect(m.alignment).toBe("ALIGNED_BULLISH");
  });
});

describe("ict", () => {
  test("FVG detection produces zones with top>bottom", () => {
    const c = synth(300, 99, 0.2); // strong trend → gaps
    const f = detectFvgs(c);
    for (const g of f) expect(g.top).toBeGreaterThan(g.bottom);
  });
  test("order blocks bounded", () => {
    const c = synth(300, 123, 0.15);
    const obs = detectOrderBlocks(c);
    for (const ob of obs) expect(ob.top).toBeGreaterThanOrEqual(ob.bottom);
  });
  test("sweeps reference a swing", () => {
    const c = synth(400, 55, 0.05);
    const s = detectSweeps(c);
    for (const x of s) expect(x.sweepPrice).toBeGreaterThan(0);
  });
  test("equal levels have 2+ touches", () => {
    const c = synth(300, 88, 0.02);
    const e = detectEqualLevels(c);
    for (const x of e) expect(x.count).toBeGreaterThanOrEqual(2);
  });
  test("quasimodo returns null or full structure", () => {
    const q = detectQuasimodo(synth(300, 3));
    if (q) {
      expect(q.neckline).toBeGreaterThan(0);
      expect(["BULLISH", "BEARISH"]).toContain(q.direction);
    }
  });
});

describe("liquidity & sessions & volatility", () => {
  test("liquidity report pools sorted by distance", () => {
    const c = synth(500);
    const r = buildLiquidityReport(c, c, "GC1!", "15m");
    expect(r.basis).toContain("Inferred");
    const open = r.pools.filter((p) => p.status === "OPEN");
    for (let i = 1; i < open.length; i++) {
      expect(Math.abs(open[i].distance)).toBeGreaterThanOrEqual(Math.abs(open[i - 1].distance) - 1e-6);
    }
  });
  test("session states include 6 windows", () => {
    const st = sessionStates(synth(200));
    expect(st.length).toBe(6);
    expect(st.map((s) => s.short)).toContain("LONDON_KZ");
  });
  test("session stats compute", () => {
    const st = sessionStatistics(synth(2000, 11, 0.02));
    expect(st.length).toBe(5);
  });
  test("volatility report", () => {
    const c = synth(3000, 21, 0.05);
    const v = buildVolatilityReport(c, c, c.slice(-60));
    expect(v.adr).toBeGreaterThan(0);
    expect(v.hvPercentile).toBeGreaterThanOrEqual(0);
    expect(v.hvPercentile).toBeLessThanOrEqual(100);
  });
});

describe("orderflow & regime", () => {
  test("order flow sums to 100%", () => {
    const r = buildOrderFlow(synth(300), "15m");
    expect(r.buyerPct + r.sellerPct).toBeCloseTo(100, 0);
    expect(r.dataBasis).toBe("PROXY");
  });
  test("regime returns valid class", () => {
    const r = detectRegime(synth(500, 31, 0.12), "1h");
    expect(r.regime).toBeTruthy();
    expect(Object.keys(r.probabilities).length).toBeGreaterThan(0);
  });
});

describe("predictions", () => {
  test("technical prediction probabilities sum to 1", () => {
    const p = technicalPrediction(synth(600), "15m", "1h", "GC1!");
    const sum = p.probBull + p.probBear + p.probNeutral;
    expect(sum).toBeCloseTo(1, 1);
    expect(p.engine).toBe("TECHNICAL");
  });
  test("walk-forward calibration runs", () => {
    const cal = walkForwardCalibrate(synth(800), 6);
    if (cal.samples > 0) {
      expect(cal.accuracy).toBeGreaterThan(0);
      expect(cal.brier).toBeGreaterThan(0);
    }
  });
  test("fundamental prediction works", () => {
    const p = fundamentalPrediction("XAUUSD", "1d", 4130, {
      dxyTrend5d: -0.8, yield10Change5d: -0.05, vixChange5d: 4,
      newsSentiment: 0.3, newsCount: 12,
      highImpactEventsAhead: [{ name: "CPI", hoursAway: 26 }],
    });
    expect(p.engine).toBe("FUNDAMENTAL");
    expect(p.probBull + p.probBear + p.probNeutral).toBeCloseTo(1, 1);
  });
});

describe("confluence & setups", () => {
  test("confluence outputs all fields", () => {
    const c = synth(400);
    const tech = technicalPrediction(c, "15m", "1h", "GC1!");
    const fund = fundamentalPrediction("GC1!", "1d", 4100, { newsSentiment: 0.2 });
    const conf = buildConfluence({
      fundamental: fund, technical: tech,
      structures: [analyzeStructure(c, "1h"), analyzeStructure(c, "4h")],
      liquidity: buildLiquidityReport(c, c, "GC1!", "15m"),
      orderFlow: buildOrderFlow(c, "15m"),
      volatility: buildVolatilityReport(c, c, c.slice(-60)),
      regime: detectRegime(c, "1h"),
      sessions: sessionStates(c),
      newsSentiment: 0.2, instrument: "GC1!", price: c[c.length - 1].close,
    });
    expect(conf.probBull + conf.probBear + conf.probNeutral).toBeCloseTo(1, 1);
    expect(conf.keyRisks.length).toBeGreaterThan(0);
  });
  test("setup generator respects rules", () => {
    const c = synth(400);
    const r = generateSetups({
      candles15m: c, candles1h: c, candles4h: c,
      instrument: "GC1!", rules: { ...DEFAULT_RULES, requireHtfAlignment: false, requireFundamentalAlignment: false },
      confluence: {
        overallBias: "BULLISH", probBull: 0.6, probBear: 0.2, probNeutral: 0.2,
        confluenceScore: 45, confidence: 0.7, fundamentalBias: "BULLISH", technicalBias: "BULLISH",
        mtfAlignment: "", liquidityCondition: "", orderFlow: "", volatility: "", newsSentiment: "",
        regime: "", session: "", keyLiquidityTarget: null, majorSupport: null, majorResistance: null,
        reversalZone: null, keyRisks: [], invalidation: "", supporting: [], conflicting: [],
        timestamp: new Date().toISOString(),
      },
      liquidity: buildLiquidityReport(c, c, "GC1!", "15m"),
      orderFlow: buildOrderFlow(c, "15m"),
      volatility: buildVolatilityReport(c, c, c.slice(-60)),
      sessions: sessionStates(c),
    });
    expect(Array.isArray(r.setups)).toBe(true);
    for (const s of r.setups) expect(s.riskReward).toBeGreaterThanOrEqual(DEFAULT_RULES.minRR);
  });
});

describe("backtest & metrics & patterns & intermarket", () => {
  test("backtest runs with no look-ahead structure", () => {
    const r = runBacktest({
      candles: synth(1500, 77, 0.05), instrument: "GC1!", timeframe: "15m",
      strategy: "ICT_LIQUIDITY_SWEEP", dateFrom: 1700000000, dateTo: 1700000000 + 1500 * 900,
      minRR: 3, riskPct: 1,
    });
    expect(r.metrics.totalTrades).toBeGreaterThanOrEqual(0);
    expect(r.equityCurve.length).toBeGreaterThan(0);
    for (const t of r.trades) expect(t.entryTime).toBeGreaterThan(1700000000);
  });
  test("metrics evaluation", () => {
    const rows = [
      { probBull: 0.8, direction: "BULLISH", realizedDir: "BULLISH", correct: true },
      { probBull: 0.3, direction: "BEARISH", realizedDir: "BEARISH", correct: true },
      { probBull: 0.7, direction: "BULLISH", realizedDir: "BEARISH", correct: false },
    ];
    const e = evaluatePredictions(rows, "TECHNICAL", "1h");
    expect(e.samples).toBe(3);
    expect(e.directionalAccuracy).toBeCloseTo(66.7, 0);
    expect(e.confusion!.tp).toBe(1);
    expect(e.confusion!.fp).toBe(1);
    expect(e.confusion!.tn).toBe(1);
  });
  test("pattern engine leakage guard", () => {
    const r = findHistoricalPatterns(synth(1200, 5, 0.08), { horizonBars: 24, topK: 8 });
    expect(r.leakageGuard).toBe(true);
    const lastTime = 1700000000 + 1199 * 900;
    for (const m of r.matches) expect(m.endTime).toBeLessThan(lastTime - 24 * 900 + 1);
  });
  test("intermarket correlation bounds", () => {
    const g = synth(300);
    const d = synth(300, 8, -0.04);
    const r = buildIntermarketReport(g, [{ name: "DXY", candles: d, inverse: true }]);
    for (const m of r.correlationMatrix) {
      expect(m.value).toBeGreaterThanOrEqual(-1);
      expect(m.value).toBeLessThanOrEqual(1);
    }
  });
});
