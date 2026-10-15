/**
 * Yahoo Finance provider — market candles & quotes for GC1! (COMEX gold
 * futures front month GC=F) and macro assets, plus gold-relevant news search.
 * Free public endpoint; futures quotes are typically delayed ~10 minutes.
 */
import type { Candle, Timeframe } from "../engines/types";
import { YAHOO_INTERVAL, resample, type CandleResponse, type QuoteResponse } from "./types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];

export const YAHOO_SYMBOLS: Record<string, string> = {
  "GC1!": "GC=F",
  DXY: "DX-Y.NYB",
  US10Y: "^TNX",
  US2Y: "2YY=F",
  SILVER: "SI=F",
  SPX: "^GSPC",
  VIX: "^VIX",
  WTI: "CL=F",
  USDINR: "USDINR=X",
  "GOLD_ETF": "GLD",
};

async function fetchJson(url: string, timeoutMs = 9000): Promise<unknown> {
  for (const host of HOSTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(host + url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: ctrl.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      return await res.json();
    } catch {
      clearTimeout(timer);
    }
  }
  throw new Error("Yahoo fetch failed");
}

interface YahooChart {
  chart: {
    result: {
      meta: { regularMarketPrice?: number; regularMarketTime?: number; regularMarketDayHigh?: number; regularMarketDayLow?: number; chartPreviousClose?: number; previousClose?: number; instrumentType?: string };
      timestamp?: number[];
      indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }[] };
    }[] | null;
    error: unknown;
  };
}

export async function yahooCandles(yahooSymbol: string, timeframe: Timeframe, limit = 900): Promise<CandleResponse> {
  const cfg = YAHOO_INTERVAL[timeframe];
  const data = (await fetchJson(`/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${cfg.interval}&range=${cfg.range}&includePrePost=false`)) as YahooChart;
  const r = data.chart.result?.[0];
  if (!r || !r.timestamp) throw new Error(`No Yahoo data for ${yahooSymbol}`);
  const q = r.indicators.quote[0];
  let candles: Candle[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ time: r.timestamp[i], open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? undefined });
  }
  // resample where needed
  if (timeframe === "3m") candles = resample(candles, 3);
  if (timeframe === "2h") candles = resample(candles, 120);
  if (timeframe === "4h") candles = resample(candles, 240);
  candles = candles.slice(-limit);
  const asOf = r.meta.regularMarketTime ? new Date(r.meta.regularMarketTime * 1000).toISOString() : new Date().toISOString();
  const isFuture = r.meta.instrumentType === "FUTURE";
  return {
    candles,
    source: "Yahoo Finance (GC=F / index feeds)",
    status: isFuture ? "DELAYED" : "LIVE",
    asOf,
    note: isFuture ? "Yahoo futures quotes are typically delayed up to 10 minutes." : undefined,
  };
}

export async function yahooQuote(yahooSymbol: string, displayName: string): Promise<QuoteResponse> {
  const data = (await fetchJson(`/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=2d`)) as YahooChart;
  const r = data.chart.result?.[0];
  if (!r) throw new Error(`No Yahoo quote for ${yahooSymbol}`);
  const q = r.indicators.quote[0];
  const closes = q.close.filter((x): x is number => x !== null);
  const last = closes[closes.length - 1] ?? null;
  const prev = closes.length > 1 ? closes[closes.length - 2] : null;
  return {
    instrument: displayName,
    price: r.meta.regularMarketPrice ?? last,
    bid: null,
    ask: null,
    dayHigh: r.meta.regularMarketDayHigh ?? null,
    dayLow: r.meta.regularMarketDayLow ?? null,
    dayOpen: prev ?? null,
    volume: null,
    status: r.meta.instrumentType === "FUTURE" ? "DELAYED" : "LIVE",
    source: "Yahoo Finance",
    asOf: r.meta.regularMarketTime ? new Date(r.meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
  };
}

export interface YahooNewsItem {
  uuid: string;
  title: string;
  publisher: string;
  link: string;
  providerPublishTime: number;
  relatedTickers?: string[];
}

export async function yahooNews(query: string, count = 12): Promise<YahooNewsItem[]> {
  const data = (await fetchJson(`/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=${count}&quotesCount=0&enableFuzzyQuery=false`)) as { news?: YahooNewsItem[] };
  return data.news ?? [];
}
