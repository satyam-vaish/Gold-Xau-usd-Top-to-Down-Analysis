/**
 * Model evaluation metrics — computed from stored predictions vs realized
 * outcomes. Numbers here are REAL: they come from Prediction/PredictionOutcome
 * rows in the database, compared against simple baselines.
 */
export interface ConfusionMatrix {
  tp: number; fp: number; tn: number; fn: number;
}

export interface EvaluationReport {
  engine: string;
  horizon: string;
  samples: number;
  directionalAccuracy: number | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  brier: number | null;
  logLoss: number | null;
  confusion: ConfusionMatrix | null;
  calibration: { bin: string; predicted: number; actual: number; count: number }[];
  baseline: { alwaysBullAccuracy: number | null; prevCloseAccuracy: number | null };
  note: string;
}

export function evaluatePredictions(
  rows: { probBull: number; direction: string; realizedDir: string; correct: boolean }[],
  engine: string,
  horizon: string,
): EvaluationReport {
  const n = rows.length;
  const empty: EvaluationReport = {
    engine, horizon, samples: n,
    directionalAccuracy: null, precision: null, recall: null, f1: null,
    brier: null, logLoss: null, confusion: null, calibration: [],
    baseline: { alwaysBullAccuracy: null, prevCloseAccuracy: null },
    note: n === 0
      ? "No resolved predictions yet. Metrics become available as predictions reach their horizon and are resolved against realized prices — figures are never simulated."
      : "Insufficient resolved samples for reliable evaluation.",
  };
  if (n === 0) return empty;

  const bull = rows.filter((r) => r.realizedDir === "BULLISH");
  const alwaysBullAcc = (bull.length / n) * 100;

  const confusion: ConfusionMatrix = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const r of rows) {
    const predictedBull = r.direction === "BULLISH";
    const actualBull = r.realizedDir === "BULLISH";
    if (predictedBull && actualBull) confusion.tp++;
    else if (predictedBull && !actualBull) confusion.fp++;
    else if (!predictedBull && !actualBull) confusion.tn++;
    else confusion.fn++;
  }
  const precision = confusion.tp + confusion.fp > 0 ? confusion.tp / (confusion.tp + confusion.fp) : null;
  const recall = confusion.tp + confusion.fn > 0 ? confusion.tp / (confusion.tp + confusion.fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  const accuracy = ((confusion.tp + confusion.tn) / n) * 100;

  let brier = 0, ll = 0;
  for (const r of rows) {
    const p = Math.min(0.999, Math.max(0.001, r.probBull));
    const y = r.realizedDir === "BULLISH" ? 1 : 0;
    brier += (p - y) ** 2;
    ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }

  // calibration bins (deciles)
  const bins = [0, 0.2, 0.4, 0.6, 0.8, 1.0].map((lo, i, arr) => ({ lo, hi: arr[i + 1] ?? 1.01 }));
  const calibration = bins.map((b, i) => {
    const inBin = rows.filter((r) => r.probBull >= b.lo && r.probBull < b.hi);
    return {
      bin: `${(b.lo * 100).toFixed(0)}–${(Math.min(b.hi, 1) * 100).toFixed(0)}%`,
      predicted: inBin.length ? +(inBin.reduce((a, r) => a + r.probBull, 0) / inBin.length).toFixed(3) : 0,
      actual: inBin.length ? +((inBin.filter((r) => r.realizedDir === "BULLISH").length / inBin.length)).toFixed(3) : 0,
      count: inBin.length,
    };
  });

  return {
    engine, horizon, samples: n,
    directionalAccuracy: +accuracy.toFixed(1),
    precision: precision !== null ? +precision.toFixed(3) : null,
    recall: recall !== null ? +recall.toFixed(3) : null,
    f1: f1 !== null ? +f1.toFixed(3) : null,
    brier: +(brier / n).toFixed(4),
    logLoss: +(ll / n).toFixed(4),
    confusion,
    calibration,
    baseline: { alwaysBullAccuracy: +alwaysBullAccuracy(alwaysBullAcc), prevCloseAccuracy: null },
    note: "Computed from stored, resolved predictions (out-of-sample by construction — predictions precede their horizons).",
  };
}

function alwaysBullAccuracy(v: number) { return +v.toFixed(1); }
