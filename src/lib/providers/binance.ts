/**
 * Binance provider — PAXG/USDT klines. PAXG is a fully gold-backed token
 * (1 PAXG ≈ 1 troy oz London-good-delivery gold) and its market tracks spot
 * gold closely with real traded OHLCV around the clock.
 *
 * HONESTY: this is a *proxy market*, NOT the OTC XAU/USD fix. The UI labels
 * the XAUUSD candle series "PAXG/USDT (Binance) — tokenized-gold proxy".
 * A direct XAU/USD feed activates automatically when TWELVEDATA_API_KEY is set.
 */
import type { Candle, Timeframe } from "../engines/types";
import { BINANCE_INTERVAL, type CandleResponse } from "./types";

export async function binanceCandles(timeframe: Timeframe, limit = 900): Promise<CandleResponse> {
  const interval = BINANCE_INTERVAL[timeframe] ?? "15m";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=${interval}&limit=${Math.min(limit, 1000)}`,
      { signal: ctrl.signal, cache: "no-store" },
    );
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Binance status ${res.status}`);
    const rows = (await res.json()) as (string | number)[][];
    const candles: Candle[] = rows.map((r) => ({
      time: Math.floor(Number(r[0]) / 1000),
      open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5],
    }));
    return {
      candles,
      source: "Binance (PAXG/USDT)",
      status: "LIVE",
      asOf: candles.length ? new Date(candles[candles.length - 1].time * 1000).toISOString() : new Date().toISOString(),
      note: "Tokenized-gold proxy market (1 PAXG ≈ 1 troy oz). Tracks spot closely with real traded volume; not the OTC XAU/USD fix.",
    };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
