/**
 * Prediction lifecycle — stores engine predictions and resolves them against
 * realized prices when their horizon expires. This is what makes the Model
 * Performance dashboard show REAL measured accuracy instead of claims.
 */
import { db } from "@/lib/db";
import type { PredictionOutput } from "../engines/types";
import { getCandles } from "./marketData";

export async function storePrediction(p: PredictionOutput): Promise<void> {
  try {
    await db.prediction.create({
      data: {
        engine: p.engine,
        instrument: p.instrument,
        horizon: p.horizon,
        direction: p.direction,
        probBull: p.probBull,
        probBear: p.probBear,
        probNeutral: p.probNeutral,
        confidence: p.confidence,
        expectedLow: p.expectedLow,
        expectedHigh: p.expectedHigh,
        targetTs: new Date(p.targetTs),
        features: JSON.stringify(p.features),
        invalidation: p.invalidation,
        regime: p.regime,
        status: "PENDING",
      },
    });
  } catch (e) {
    console.error("storePrediction failed", e);
  }
}

/** Resolve all PENDING predictions past their horizon. Called by API + stream service. */
export async function resolveDuePredictions(): Promise<number> {
  const due = await db.prediction.findMany({
    where: { status: "PENDING", targetTs: { lte: new Date() } },
    take: 40,
    orderBy: { targetTs: "asc" },
  });
  if (!due.length) return 0;

  // group candles fetch per instrument
  const byInstrument = new Map<string, import("../engines/types").Candle[]>();
  let resolved = 0;

  for (const p of due) {
    try {
      let candles = byInstrument.get(p.instrument);
      if (!candles) {
        const resp = await getCandles(p.instrument as "XAUUSD" | "GC1!", "15m", 1000);
        candles = resp.candles;
        byInstrument.set(p.instrument, candles);
      }
      const startTs = Math.floor(p.createdAt.getTime() / 1000);
      const endTs = Math.floor(p.targetTs.getTime() / 1000);
      const startCandle = candles.find((c) => c.time >= startTs - 900) ?? candles[0];
      const endIdx = candles.findIndex((c) => c.time >= endTs);
      if (endIdx < 0 || !startCandle) continue;
      const base = startCandle.close;
      const end = candles[endIdx].close;
      const movePct = ((end - base) / base) * 100;
      // realized direction with a small dead-band (0.02%)
      const realizedDir = movePct > 0.02 ? "BULLISH" : movePct < -0.02 ? "BEARISH" : "NEUTRAL";
      const window = candles.slice(0, endIdx + 1).filter((c) => c.time >= startTs);
      const mfe = window.length ? +(((Math.max(...window.map((c) => c.high)) - base) / base) * 100).toFixed(3) : null;
      const mae = window.length ? +(((base - Math.min(...window.map((c) => c.low))) / base) * 100).toFixed(3) : null;
      const correct = p.direction === realizedDir || (p.direction === "NEUTRAL" && realizedDir === "NEUTRAL");

      await db.predictionOutcome.create({
        data: {
          predictionId: p.id,
          realizedDir,
          realizedMove: +movePct.toFixed(3),
          mfe, mae,
          correct,
        },
      });
      await db.prediction.update({ where: { id: p.id }, data: { status: "RESOLVED" } });
      resolved++;
    } catch (e) {
      console.error("resolve prediction failed", p.id, e);
    }
  }
  return resolved;
}
