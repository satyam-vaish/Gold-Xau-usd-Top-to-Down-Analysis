/**
 * Provider abstraction — every data source implements this interface so the
 * platform is provider-independent (spec §31). Each response carries source,
 * timestamp, instrument and live/delayed/demo status.
 */
import type { Candle, DataStatus, Instrument, Timeframe } from "../engines/types";

export interface CandleResponse {
  candles: Candle[];
  source: string;
  status: DataStatus;
  asOf: string;
  note?: string;
}

export interface QuoteResponse {
  instrument: Instrument | string;
  price: number | null;
  bid: number | null;
  ask: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayOpen: number | null;
  volume: number | null;
  status: DataStatus;
  source: string;
  asOf: string;
  note?: string;
}

export interface Provider {
  name: string;
  isConfigured(): boolean;
}

/** Map our timeframes to provider-native intervals. */
export const YAHOO_INTERVAL: Record<Timeframe, { interval: string; range: string }> = {
  "1m": { interval: "1m", range: "5d" },
  "3m": { interval: "1m", range: "5d" }, // resampled
  "5m": { interval: "5m", range: "1mo" },
  "15m": { interval: "15m", range: "1mo" },
  "30m": { interval: "30m", range: "1mo" },
  "1h": { interval: "1h", range: "3mo" },
  "2h": { interval: "1h", range: "6mo" }, // resampled
  "4h": { interval: "1h", range: "1y" }, // resampled
  "1d": { interval: "1d", range: "2y" },
  "1w": { interval: "1wk", range: "5y" },
  "1M": { interval: "1mo", range: "10y" },
};

export const BINANCE_INTERVAL: Partial<Record<Timeframe, string>> = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "2h": "2h", "4h": "4h", "1d": "1d", "1w": "1w", "1M": "1M",
};

/** Resample candles into a higher timeframe (e.g., 1m → 3m, 1h → 4h). */
export function resample(candles: Candle[], minutes: number): Candle[] {
  if (!candles.length) return [];
  const bucketMs = minutes * 60;
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of candles) {
    const bucket = Math.floor(c.time / bucketMs) * bucketMs;
    if (!cur || cur.time !== bucket) {
      if (cur) out.push(cur);
      cur = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume = (cur.volume ?? 0) + (c.volume ?? 0);
    }
  }
  if (cur) out.push(cur);
  return out;
}
