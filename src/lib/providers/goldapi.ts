/**
 * gold-api.com provider — free, keyless live spot XAU (troy ounce, USD) price.
 * Provides the XAUUSD headline quote (price only, no OHLC history).
 */
import type { QuoteResponse } from "./types";

export async function goldApiQuote(): Promise<QuoteResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("https://api.gold-api.com/price/XAU", {
      signal: ctrl.signal, cache: "no-store",
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`gold-api status ${res.status}`);
    const j = (await res.json()) as { price?: number; updatedAt?: string; name?: string };
    if (typeof j.price !== "number") throw new Error("gold-api missing price");
    return {
      instrument: "XAUUSD",
      price: +j.price.toFixed(2),
      bid: null, ask: null, dayHigh: null, dayLow: null, dayOpen: null, volume: null,
      status: "LIVE",
      source: "gold-api.com (spot XAU/USD)",
      asOf: j.updatedAt ?? new Date().toISOString(),
      note: "Spot price only — no bid/ask or volume from this provider.",
    };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
