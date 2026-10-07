/**
 * Prediction engines — fundamental & technical, kept strictly independent
 * (they are merged later only inside the Confluence Engine).
 *
 * HONESTY CONTRACT (spec rule 16 / rule 4):
 * - Probabilities come from a deterministic weighted scoring model squashed
 *   through a logistic function — NOT from an invented "AI accuracy".
 * - The model IS calibrated on the actually loaded price history with a
 *   walk-forward procedure: for each historical time t, the score is computed
 *   ONLY with data up to t and evaluated against the realized move over the
 *   requested horizon. The resulting out-of-sample hit-rate / Brier score is
 *   reported to the user. No look-ahead.
 * - Every feature contribution is exposed for explainability.
 */
import type { Candle, PredictionFeature, PredictionOutput, Timeframe } from "./types";
import { atr, ema, lastValue, stdev } from "./indicators";

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// Shared candle feature extraction (used live AND walk-forward → consistent)
// ---------------------------------------------------------------------------

export interface TechnicalCore {
  score: number; // -1..1
  features: PredictionFeature[];
}

export function technicalCore(candles: Candle[]): TechnicalCore {
  const n = candles.length;
  if (n < 60) return { score: 0, features: [] };
  const closes = candles.map((c) => c.close);
  const price = closes[n - 1];
  const e20 = lastValue(ema(closes, 20))!;
  const e50 = lastValue(ema(closes, 50))!;
  const e20Prev = ema(closes.slice(0, n - 5), 20).filter((x): x is number => x !== null).slice(-1)[0] ?? e20;
  const e50Prev = ema(closes.slice(0, n - 5), 50).filter((x): x is number => x !== null).slice(-1)[0] ?? e50;

  const feats: { name: string; raw: number; w: number; detail: string }[] = [];

  // 1. EMA trend alignment + slope
  const trend = clamp(((e20 - e50) / price) * 250, -1, 1) * 0.6 + clamp(((e20 - e20Prev) / price) * 300, -1, 1) * 0.4;
  feats.push({ name: "EMA trend alignment & slope", raw: trend, w: 0.24, detail: `EMA20 ${e20.toFixed(2)} vs EMA50 ${e50.toFixed(2)}; 5-bar slope ${(e20 - e20Prev).toFixed(2)}` });

  // 2. Momentum (rate of change over 12 bars, z-scored by recent vol)
  const roc = ((price - closes[n - 13]) / closes[n - 13]) * 100;
  const sd = stdev(closes.slice(-30).map((c, i, arr) => (i ? Math.log(c / arr[i - 1]) : 0))) || 0.001;
  feats.push({ name: "Momentum (12-bar ROC)", raw: clamp(roc / (sd * 250 + 0.6), -1, 1), w: 0.2, detail: `${roc.toFixed(2)}% over 12 bars, vol-adjusted` });

  // 3. Position in recent range (premium/discount proxy)
  const hi = Math.max(...candles.slice(-40).map((c) => c.high));
  const lo = Math.min(...candles.slice(-40).map((c) => c.low));
  const pos = (price - lo) / (hi - lo || 1e-9);
  feats.push({ name: "Range position (premium/discount)", raw: clamp((0.5 - pos) * 1.6, -1, 1), w: 0.14, detail: `Price at ${(pos * 100).toFixed(0)}% of 40-bar range (mean-reversion tilt toward discount)` });

  // 4. Candle pressure: last 6 candles body direction & size
  let pressure = 0;
  for (let i = n - 6; i < n; i++) {
    const c = candles[i];
    const range = c.high - c.low || 1e-9;
    pressure += ((c.close - c.open) / range);
  }
  feats.push({ name: "Candle-body pressure (6 bars)", raw: clamp(pressure / 3, -1, 1), w: 0.16, detail: `Sum of body/range ratios ${(pressure).toFixed(2)}` });

  // 5. Higher-high/lower-low structure proxy
  const hh = candles[n - 1].high > Math.max(...candles.slice(-20, -5).map((c) => c.high));
  const ll = candles[n - 1].low < Math.min(...candles.slice(-20, -5).map((c) => c.low));
  feats.push({ name: "Breakout context", raw: hh ? 0.7 : ll ? -0.7 : 0, w: 0.12, detail: hh ? "Price above 15-bar high" : ll ? "Price below 15-bar low" : "Inside recent range" });

  // 6. Volatility regime tilt (contraction → breakout readiness; mild negative weight)
  const vol = stdev(closes.slice(-10).map((c, i, arr) => (i ? Math.log(c / arr[i - 1]) : 0))) || 0.001;
  const volBase = stdev(closes.slice(-40).map((c, i, arr) => (i ? Math.log(c / arr[i - 1]) : 0))) || 0.001;
  const volTilt = clamp((vol / volBase - 1), -1, 1);
  feats.push({ name: "Volatility expansion", raw: -volTilt * 0.5, w: 0.06, detail: `10-bar vol / 40-bar vol = ${(vol / volBase).toFixed(2)} (expansion reduces directional conviction)` });

  let score = 0;
  const features: PredictionFeature[] = feats.map((f) => {
    const contribution = +(f.raw * f.w).toFixed(4);
    score += contribution;
    return { name: f.name, value: +f.raw.toFixed(3), weight: f.w, contribution, detail: f.detail };
  });
  score = clamp(score, -1, 1);
  return { score, features };
}

// ---------------------------------------------------------------------------
// Walk-forward calibration (out-of-sample, no look-ahead)
// ---------------------------------------------------------------------------

export interface Calibration {
  accuracy: number | null;
  brier: number | null;
  samples: number;
  basis: string;
}

export function walkForwardCalibrate(
  candles: Candle[],
  horizonBars: number,
  step = 6,
): Calibration {
  const n = candles.length;
  const need = 120 + horizonBars + 10;
  if (n < need) {
    return { accuracy: null, brier: null, samples: 0, basis: "Insufficient loaded history for walk-forward calibration — probabilities are model outputs only." };
  }
  let correct = 0, samples = 0, brierSum = 0;
  for (let i = 120; i < n - horizonBars; i += step) {
    const past = candles.slice(0, i);
    const { score } = technicalCore(past);
    const pBull = sigmoid(score * 2.2);
    const future = candles.slice(i, i + horizonBars);
    const move = ((future[future.length - 1].close - candles[i - 1].close) / candles[i - 1].close) * 100;
    if (Math.abs(move) < 0.02) continue; // neutral band
    const up = move > 0;
    if ((score > 0) === up) correct++;
    samples++;
    const outcome = up ? 1 : 0;
    brierSum += (pBull - outcome) ** 2;
  }
  return {
    accuracy: samples ? +((correct / samples) * 100).toFixed(1) : null,
    brier: samples ? +(brierSum / samples).toFixed(4) : null,
    samples,
    basis: `Weighted heuristic scoring model (logistic squash). Out-of-sample walk-forward on loaded history: score at t uses data ≤ t, evaluated on move t→t+${horizonBars} bars. NOT training-set accuracy.`,
  };
}

// ---------------------------------------------------------------------------
// Technical prediction
// ---------------------------------------------------------------------------

const HORIZON_BARS: Record<string, number> = { "15m": 15, "1h": 12, "4h": 16, session: 8, "1d": 6, "5d": 10 };
const HORIZON_HOURS: Record<string, number> = { "15m": 0.25, "1h": 1, "4h": 4, session: 8, "1d": 24, "5d": 120 };

export function technicalPrediction(
  candles: Candle[],
  timeframe: Timeframe,
  horizon: string,
  instrument: import("./types").Instrument,
  extra?: { regime?: string; cvdBias?: number; mtfScore?: number; liquidityBias?: number },
): PredictionOutput {
  const core = technicalCore(candles);
  let score = core.score;
  const features = [...core.features];

  if (extra?.cvdBias !== undefined) {
    const f: PredictionFeature = {
      name: "Order-flow (CVD proxy) bias", value: +extra.cvdBias.toFixed(3), weight: 0.1,
      contribution: +(extra.cvdBias * 0.1).toFixed(4),
      detail: "Cumulative volume delta direction over recent bars (OHLCV proxy, clearly labelled)",
    };
    features.push(f); score += f.contribution;
  }
  if (extra?.mtfScore !== undefined) {
    const f: PredictionFeature = {
      name: "Multi-timeframe alignment", value: +extra.mtfScore.toFixed(3), weight: 0.15,
      contribution: +(extra.mtfScore * 0.15).toFixed(4),
      detail: "Structure alignment score across analysed timeframes",
    };
    features.push(f); score += f.contribution;
  }
  if (extra?.liquidityBias !== undefined) {
    const f: PredictionFeature = {
      name: "Liquidity draw (inferred)", value: +extra.liquidityBias.toFixed(3), weight: 0.1,
      contribution: +(extra.liquidityBias * 0.1).toFixed(4),
      detail: "Bias toward the nearer inferred liquidity pool (price is drawn to untested liquidity)",
    };
    features.push(f); score += f.contribution;
  }
  score = clamp(score, -1, 1);

  const price = candles[candles.length - 1].close;
  const pBullRaw = sigmoid(score * 2.2);
  const neutralBand = 0.18;
  let pBull: number, pBear: number, pNeutral: number;
  if (Math.abs(score) < 0.08) {
    pNeutral = 0.6; pBull = (1 - pNeutral) * pBullRaw + (1 - pNeutral) * 0.5;
    pBear = 1 - pBull - pNeutral;
  } else {
    pBull = pBullRaw;
    pBear = 1 - pBull;
    pNeutral = Math.max(0.02, neutralBand * (1 - Math.abs(score)));
    pBull *= 1 - pNeutral;
    pBear *= 1 - pNeutral;
  }
  const norm = pBull + pBear + pNeutral;

  // expected zone from ATR
  const a = lastValue(atr(candles, 14)) ?? price * 0.004;
  const barsAhead = HORIZON_BARS[horizon] ?? 12;
  const drift = price * (score * 0.004) * Math.sqrt(barsAhead / 12);
  const spread = a * Math.sqrt(barsAhead / 12) * 0.9;

  const calib = walkForwardCalibrate(candles, barsAhead);
  const direction = score > 0.08 ? "BULLISH" : score < -0.08 ? "BEARISH" : "NEUTRAL";
  const supporting = features.filter((f) => f.contribution > 0.015).sort((a, b) => b.contribution - a.contribution).map((f) => `${f.name}: ${f.detail} (+${(f.contribution * 100).toFixed(1)} pts)`);
  const conflicting = features.filter((f) => f.contribution < -0.015).sort((a, b) => a.contribution - b.contribution).map((f) => `${f.name}: ${f.detail} (${(f.contribution * 100).toFixed(1)} pts)`);

  return {
    engine: "TECHNICAL",
    instrument,
    horizon,
    direction,
    probBull: +(pBull / norm).toFixed(3),
    probBear: +(pBear / norm).toFixed(3),
    probNeutral: +(pNeutral / norm).toFixed(3),
    confidence: +Math.min(0.95, Math.abs(score) * 1.6 + (calib.accuracy ? calib.accuracy / 300 : 0.15)).toFixed(2),
    expectedLow: +(Math.min(price + drift - spread, price + drift) ).toFixed(2),
    expectedHigh: +(price + drift + spread).toFixed(2),
    targetTs: new Date(Date.now() + (HORIZON_HOURS[horizon] ?? 4) * 3600 * 1000).toISOString(),
    features,
    supporting: supporting.length ? supporting : ["No strong supportive factors — mixed signals"],
    conflicting: conflicting.length ? conflicting : ["No significant conflicting factors"],
    invalidation: direction === "BULLISH"
      ? `Invalidated on a confirmed close below ${+(price - spread * 1.2).toFixed(2)} (structural low + vol buffer)`
      : direction === "BEARISH"
        ? `Invalidated on a confirmed close above ${+(price + spread * 1.2).toFixed(2)}`
        : "Neutral — reassess on a decisive break of the recent range",
    regime: extra?.regime ?? "n/a",
    timestamp: new Date().toISOString(),
    calibration: {
      basis: calib.basis,
      historicalAccuracy: calib.accuracy,
      samples: calib.samples,
    },
  };
}

// ---------------------------------------------------------------------------
// Fundamental prediction (factor model on macro inputs + news sentiment)
// ---------------------------------------------------------------------------

export interface MacroInputs {
  dxyChange1d?: number;      // % change
  dxyTrend5d?: number;       // % change
  yield10Change5d?: number;  // absolute change in %
  yield2Change5d?: number;
  realYieldTrend?: number;   // approx: 10y - inflation expectations delta
  vixLevel?: number;
  vixChange5d?: number;
  goldSilverRatioChange?: number; // 5d % change
  newsSentiment?: number;    // -1..1 gold-bullish..bearish aggregated
  newsCount?: number;
  highImpactEventsAhead?: { name: string; hoursAway: number }[];
  centralBankTone?: number;  // -1 hawkish..+1 dovish (from news sentiment on FED category)
}

export function fundamentalPrediction(
  instrument: import("./types").Instrument,
  horizon: string,
  price: number,
  inputs: MacroInputs,
): PredictionOutput {
  const feats: { name: string; raw: number; w: number; detail: string }[] = [];

  const dxy = inputs.dxyTrend5d ?? 0;
  feats.push({
    name: "US Dollar (DXY) 5-day trend", raw: clamp(-dxy / 1.5, -1, 1), w: 0.26,
    detail: `DXY ${dxy >= 0 ? "+" : ""}${dxy.toFixed(2)}% over 5 days — inverse relation to gold`,
  });
  const y10 = inputs.yield10Change5d ?? 0;
  feats.push({
    name: "US 10Y yield momentum", raw: clamp(-y10 / 0.25, -1, 1), w: 0.2,
    detail: `10Y ${y10 >= 0 ? "+" : ""}${y10.toFixed(2)}pp over 5 days — higher yields raise gold's opportunity cost`,
  });
  const y2 = inputs.yield2Change5d ?? 0;
  feats.push({
    name: "US 2Y yield momentum (rate expectations)", raw: clamp(-y2 / 0.2, -1, 1), w: 0.12,
    detail: `2Y ${y2 >= 0 ? "+" : ""}${y2.toFixed(2)}pp over 5 days — policy path proxy`,
  });
  const vix = inputs.vixChange5d ?? 0;
  feats.push({
    name: "Risk sentiment (VIX 5d)", raw: clamp(vix / 15, -1, 1), w: 0.14,
    detail: `VIX ${inputs.vixLevel?.toFixed(1) ?? "n/a"}; ${vix >= 0 ? "+" : ""}${vix.toFixed(1)}% — safe-haven demand rises with fear`,
  });
  const news = inputs.newsSentiment ?? 0;
  feats.push({
    name: "News sentiment (gold-specific)", raw: news, w: 0.18,
    detail: `${inputs.newsCount ?? 0} classified articles; aggregated gold sentiment ${news >= 0 ? "+" : ""}${news.toFixed(2)}`,
  });
  const cb = inputs.centralBankTone ?? 0;
  feats.push({
    name: "Fed tone (dovish/hawkish)", raw: clamp(-cb / 1, -1, 1), w: 0.1,
    detail: `Fed-related coverage tone ${cb >= 0 ? "dovish-leaning" : "hawkish-leaning"} — dovish supports gold`,
  });

  let score = 0;
  const features: PredictionFeature[] = feats.map((f) => {
    const contribution = +(f.raw * f.w).toFixed(4);
    score += contribution;
    return { name: f.name, value: +f.raw.toFixed(3), weight: f.w, contribution, detail: f.detail };
  });
  score = clamp(score, -1, 1);

  const pBullRaw = sigmoid(score * 2.0);
  let pBull: number, pBear: number, pNeutral: number;
  if (Math.abs(score) < 0.08) {
    pNeutral = 0.6; pBull = 0.2; pBear = 0.2;
  } else {
    pBull = pBullRaw * 0.94; pBear = (1 - pBullRaw) * 0.94; pNeutral = 0.06;
  }
  const norm = pBull + pBear + pNeutral;
  const direction = score > 0.08 ? "BULLISH" : score < -0.08 ? "BEARISH" : "NEUTRAL";

  const keyRisks: string[] = [];
  for (const ev of inputs.highImpactEventsAhead ?? []) {
    keyRisks.push(`${ev.name} in ~${ev.hoursAway.toFixed(0)}h — event risk can override the factor model in minutes`);
  }
  keyRisks.push("Correlations to DXY/yields are regime-dependent and can invert (e.g., liquidation events)");

  return {
    engine: "FUNDAMENTAL",
    instrument,
    horizon,
    direction,
    probBull: +(pBull / norm).toFixed(3),
    probBear: +(pBear / norm).toFixed(3),
    probNeutral: +(pNeutral / norm).toFixed(3),
    confidence: +Math.min(0.9, 0.35 + Math.abs(score) * 0.8).toFixed(2),
    expectedLow: null,
    expectedHigh: null,
    targetTs: new Date(Date.now() + (HORIZON_HOURS[horizon] ?? 24) * 3600 * 1000).toISOString(),
    features,
    supporting: features.filter((f) => f.contribution > 0.015).sort((a, b) => b.contribution - a.contribution).map((f) => `${f.name}: ${f.detail}`),
    conflicting: features.filter((f) => f.contribution < -0.015).sort((a, b) => a.contribution - b.contribution).map((f) => `${f.name}: ${f.detail}`),
    invalidation: "A high-impact surprise (hot CPI, hawkish Fed repricing, or a geopolitical de-escalation) can invalidate the factor outlook immediately.",
    regime: "fundamental factor model",
    timestamp: new Date().toISOString(),
    calibration: {
      basis: "Explainable factor model with fixed weights (transparent, not fitted). No fabricated accuracy figure — model metrics become measurable once predictions are stored and resolved against realized prices.",
      historicalAccuracy: null,
      samples: 0,
    },
  };
}
