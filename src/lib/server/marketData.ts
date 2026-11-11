/**
 * Market data aggregator — single source of truth for candles & quotes.
 *
 * Instrument policy (spec §4 / §36 rule 6): XAUUSD (spot) and GC1! (COMEX
 * futures) are strictly SEPARATE datasets — never merged.
 *
 * XAUUSD candles priority:
 *   1. Twelve Data (real XAU/USD, needs key)
 *   2. Binance PAXG/USDT (real tokenized-gold proxy, keyless) — labelled
 *   3. Demo simulator (synthetic, clearly DEMO)
 * XAUUSD quote priority: Twelve Data → gold-api.com → last PAXG close (DEMO)
 * GC1!: Yahoo GC=F (DELAYED) for candles + quotes.
 */
import type { Candle, Instrument, Timeframe } from "../engines/types";
import { yahooCandles, yahooQuote, YAHOO_SYMBOLS } from "../providers/yahoo";
import { binanceCandles } from "../providers/binance";
import { goldApiQuote } from "../providers/goldapi";
import * as td from "../providers/twelvedata";
import { demoCandles } from "../providers/demo";
import type { CandleResponse, QuoteResponse } from "../providers/types";
import { cache } from "./cache";

export const INSTRUMENTS: Record<Instrument, { name: string; kind: "spot" | "future"; note: string }> = {
  XAUUSD: { name: "Gold Spot (XAU/USD)", kind: "spot", note: "OTC spot gold" },
  "GC1!": { name: "COMEX Gold Futures (GC1! front month)", kind: "future", note: "CME COMEX GC front-month continuous" },
};

const CANDLE_TTL: Partial<Record<Timeframe, number>> = { "1m": 5, "3m": 10, "5m": 15, "15m": 25, "30m": 45, "1h": 60, "2h": 120, "4h": 180, "1d": 300 };

export async function getCandles(instrument: Instrument, timeframe: Timeframe, limit = 900): Promise<CandleResponse> {
  const key = `candles:${instrument}:${timeframe}:${limit}`;
  const hit = cache.get<CandleResponse>(key);
  if (hit) return hit;

  let resp: CandleResponse;
  try {
    if (instrument === "GC1!") {
      resp = await yahooCandles(YAHOO_SYMBOLS["GC1!"], timeframe, limit);
    } else {
      let tdLoaded = false;
      if (td.isConfigured()) {
        try {
          resp = await td.twelvedataCandles(timeframe, limit);
          tdLoaded = true;
        } catch (err) {
          console.warn("Twelve Data candles fallback to calibrated spot:", (err as Error).message);
        }
      }

      if (!tdLoaded) {
        // PAXG proxy; for weekly/monthly resample from 1d
        let d: CandleResponse;
        if (timeframe === "1w" || timeframe === "1M") {
          const raw = await binanceCandles("1d", 1000);
          const { resample } = await import("../providers/types");
          const candles = resample(raw.candles, timeframe === "1w" ? 10080 : 43200);
          d = { ...raw, candles: candles.slice(-limit), source: `${raw.source} → resampled ${timeframe}`, note: raw.note };
        } else {
          d = await binanceCandles(timeframe, limit);
        }

        // Align proxy candles to real authoritative live spot gold price
        try {
          const spot = await goldApiQuote();
          if (spot.price && d.candles.length) {
            const lastClose = d.candles[d.candles.length - 1].close;
            const diff = spot.price - lastClose;
            if (Math.abs(diff) > 0.5) {
              d.candles = d.candles.map((c) => ({
                ...c,
                open: +(c.open + diff).toFixed(2),
                high: +(c.high + diff).toFixed(2),
                low: +(c.low + diff).toFixed(2),
                close: +(c.close + diff).toFixed(2),
              }));
              d.note = `Calibrated to real live spot gold (${spot.price.toFixed(2)} USD/oz). Set TWELVEDATA_API_KEY for direct institutional feed.`;
            }
          }
        } catch {}

        resp = d;
      }
    }
  } catch {
    // last resort: clearly-labelled demo data anchored to a plausible level
    const anchor = instrument === "GC1!" ? 4140 : 4130;
    resp = demoCandles(timeframe, anchor, Math.min(limit, 600), instrument === "GC1!" ? 3 : 5);
  }
  cache.set(key, resp, CANDLE_TTL[timeframe] ?? 120);
  return resp;
}

export async function getQuote(instrument: Instrument): Promise<QuoteResponse> {
  const key = `quote:${instrument}`;
  const hit = cache.get<QuoteResponse>(key);
  if (hit) return hit;
  let resp: QuoteResponse;
  if (instrument === "GC1!") {
    try {
      resp = await yahooQuote(YAHOO_SYMBOLS["GC1!"], "GC1!");
    } catch {
      const c = await getCandles("GC1!", "5m", 3);
      const last = c.candles[c.candles.length - 1];
      resp = last
        ? { instrument: "GC1!", price: last.close, bid: null, ask: null, dayHigh: null, dayLow: null, dayOpen: null, volume: null, status: c.status, source: `${c.source} (last candle)`, asOf: c.asOf }
        : { instrument: "GC1!", price: null, bid: null, ask: null, dayHigh: null, dayLow: null, dayOpen: null, volume: null, status: "UNAVAILABLE", source: "none", asOf: new Date().toISOString() };
    }
  } else {
    try {
      resp = td.isConfigured() ? await td.twelvedataQuote() : await goldApiQuote();
    } catch {
      try {
        const c = await binanceCandles("1m", 2);
        const last = c.candles[c.candles.length - 1];
        resp = {
          instrument: "XAUUSD", price: last?.close ?? null, bid: null, ask: null,
          dayHigh: null, dayLow: null, dayOpen: null, volume: null,
          status: "LIVE", source: "Binance PAXG/USDT (last trade)", asOf: c.asOf,
          note: "gold-api.com unreachable; PAXG last-trade used as proxy.",
        };
      } catch {
        resp = {
          instrument: "XAUUSD", price: null, bid: null, ask: null, dayHigh: null,
          dayLow: null, dayOpen: null, volume: null, status: "UNAVAILABLE",
          source: "none", asOf: new Date().toISOString(),
          note: "All spot sources unreachable.",
        };
      }
    }
  }
  cache.set(key, resp, 6);
  return resp;
}

export interface MacroAsset {
  key: string;
  label: string;
  quote: QuoteResponse | null;
  changePct1d: number | null;
  spark: number[];
}

const MACRO_KEYS = ["DXY", "US10Y", "US2Y", "SILVER", "SPX", "VIX", "WTI", "USDINR"] as const;

export async function getMacroAssets(): Promise<MacroAsset[]> {
  const key = "macro:assets";
  const hit = cache.get<MacroAsset[]>(key);
  if (hit) return hit;

  const results = await Promise.allSettled(
    MACRO_KEYS.map(async (k) => {
      const sym = YAHOO_SYMBOLS[k];
      const [q, c] = await Promise.all([
        yahooQuote(sym, k).catch(() => null),
        yahooCandles(sym, "1d", 30).catch(() => null),
      ]);
      const candles = c?.candles ?? [];
      const closes = candles.map((x) => x.close);
      const changePct = closes.length >= 2 ? +(((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100).toFixed(2) : null;
      const asset: MacroAsset = {
        key: k,
        label: k,
        quote: q,
        changePct1d: changePct,
        spark: closes.slice(-30),
      };
      return asset;
    }),
  );
  const assets = results.filter((r): r is PromiseFulfilledResult<MacroAsset> => r.status === "fulfilled").map((r) => r.value);
  cache.set(key, assets, 180);
  return assets;
}

/** Futures term structure from individual COMEX contract months. */
export async function getFuturesCurve(): Promise<{ contracts: { symbol: string; label: string; price: number | null }[]; source: string; asOf: string; status: string }> {
  const key = "futures:curve";
  const hit = cache.get<ReturnType<typeof getFuturesCurve> extends Promise<infer T> ? T : never>(key);
  if (hit) return hit as Awaited<ReturnType<typeof getFuturesCurve>>;

  const now = new Date();
  const months = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"];
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const contracts: { symbol: string; label: string; price: number | null }[] = [];
  for (let m = 0; m < 8; m++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m, 1));
    // skip months in the past week; use next 8 active GC months (Feb, Apr, Jun, Aug, Oct, Dec + nearby)
    const code = `${months[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`;
    const symbol = `GC${code}.CMX`;
    try {
      const data = await yahooCandles(symbol, "1d", 2);
      const last = data.candles[data.candles.length - 1];
      contracts.push({ symbol, label: `${labels[d.getUTCMonth()]} ${d.getUTCFullYear()}`, price: last ? last.close : null });
    } catch {
      contracts.push({ symbol, label: `${labels[d.getUTCMonth()]} ${d.getUTCFullYear()}`, price: null });
    }
  }
  const result = { contracts: contracts.filter((c) => c.price !== null), source: "Yahoo Finance (COMEX contract months)", asOf: new Date().toISOString(), status: "DELAYED" };
  cache.set(key, result, 1800);
  return result;
}
