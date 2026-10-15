/**
 * Twelve Data provider adapter — direct XAU/USD (spot) candles & quotes.
 * ACTIVATION: requires TWELVEDATA_API_KEY in environment.
 * Includes in-memory caching to respect Twelve Data free-tier rate limits (8 calls/min).
 */
import type { Candle, Timeframe } from "../engines/types";
import type { CandleResponse, QuoteResponse } from "./types";
import { resample } from "./types";

const TD_INTERVAL: Partial<Record<Timeframe, string>> = {
  "1m": "1min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "2h": "2h", "4h": "4h", "1d": "1day", "1w": "1week", "1M": "1month",
};

let cachedQuote: { data: QuoteResponse; ts: number } | null = null;
const candleCache = new Map<string, { data: CandleResponse; ts: number }>();

export function isConfigured(): boolean {
  return !!process.env.TWELVEDATA_API_KEY;
}

export async function twelvedataCandles(timeframe: Timeframe, limit = 900): Promise<CandleResponse> {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error("TWELVEDATA_API_KEY not configured");

  const cacheKey = `${timeframe}:${limit}`;
  const now = Date.now();
  const hit = candleCache.get(cacheKey);
  // Cache candles for 20 seconds to stay well within free tier limits
  if (hit && now - hit.ts < 20000) {
    return hit.data;
  }

  const interval = TD_INTERVAL[timeframe] ?? "15min";
  const fetchInterval = timeframe === "3m" ? "1min" : interval;
  const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${fetchInterval}&outputsize=${Math.min(limit, 500)}&timezone=UTC&apikey=${key}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Twelve Data status ${res.status}`);
  const j = (await res.json()) as {
    status?: string; message?: string; code?: number;
    values?: { datetime: string; open: string; high: string; low: string; close: string; volume?: string }[];
  };

  if (j.status === "error" || !j.values) {
    if (hit) return hit.data; // Serve stale cache if rate-limited
    throw new Error(j.message ?? "Twelve Data error");
  }

  let candles: Candle[] = j.values.map((v) => {
    const t = Math.floor(new Date(v.datetime.replace(" ", "T") + "Z").getTime() / 1000);
    return { time: t, open: +parseFloat(v.open).toFixed(2), high: +parseFloat(v.high).toFixed(2), low: +parseFloat(v.low).toFixed(2), close: +parseFloat(v.close).toFixed(2), volume: v.volume ? +v.volume : undefined };
  }).reverse();

  if (timeframe === "3m") candles = resample(candles, 3);

  const result: CandleResponse = {
    candles: candles.slice(-limit),
    source: "Twelve Data (Real XAU/USD Spot)",
    status: "LIVE",
    asOf: candles.length ? new Date(candles[candles.length - 1].time * 1000).toISOString() : new Date().toISOString(),
    note: "Direct institutional OTC XAU/USD spot feed via Twelve Data API.",
  };

  candleCache.set(cacheKey, { data: result, ts: now });
  return result;
}

export async function twelvedataQuote(): Promise<QuoteResponse> {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error("TWELVEDATA_API_KEY not configured");

  const now = Date.now();
  if (cachedQuote && now - cachedQuote.ts < 8000) {
    return cachedQuote.data;
  }

  const res = await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${key}`, { cache: "no-store" });
  const j = (await res.json()) as { price?: string; status?: string; message?: string };
  if (!j.price) {
    if (cachedQuote) return cachedQuote.data;
    throw new Error(j.message ?? "Twelve Data quote error");
  }

  const result: QuoteResponse = {
    instrument: "XAUUSD",
    price: +parseFloat(j.price).toFixed(2),
    bid: null, ask: null, dayHigh: null, dayLow: null, dayOpen: null, volume: null,
    status: "LIVE",
    source: "Twelve Data (Real XAU/USD Spot)",
    asOf: new Date().toISOString(),
    note: "Official Twelve Data live spot gold price.",
  };

  cachedQuote = { data: result, ts: now };
  return result;
}
