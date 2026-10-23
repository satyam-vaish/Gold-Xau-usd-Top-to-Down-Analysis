import { NextResponse } from "next/server";
import { getCandles, getQuote, getMacroAssets, getFuturesCurve, INSTRUMENTS } from "@/lib/server/marketData";
import { buildVolatilityReport } from "@/lib/engines/volatility";
import { sessionStates, activeSession, marketOpen } from "@/lib/engines/sessions";
import { fetchAndStoreNews, aggregateSentiment } from "@/lib/server/news";
import { cache } from "@/lib/server/cache";
import type { Instrument, Timeframe } from "@/lib/engines/types";

export const dynamic = "force-dynamic";

function parseInstrument(v: string | null): Instrument {
  return v === "GC1!" || v === "gc" ? "GC1!" : "XAUUSD";
}

/**
 * GET /api/market/[action]
 *   ticker   — top market bar payload (both instruments + session + provider)
 *   quote    — single instrument quote (?instrument=)
 *   candles  — OHLCV (?instrument=&tf=&limit=)
 *   overview — dashboard overview cards
 *   macro    — DXY/yields/silver/etc assets
 *   curve    — COMEX futures term structure
 *   cot      — CFTC COT gold positioning
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  const url = new URL(request.url);
  try {
    switch (action) {
      case "ticker": {
        const [xau, gc, gcDaily, xauDaily] = await Promise.all([
          getQuote("XAUUSD"),
          getQuote("GC1!"),
          getCandles("GC1!", "1d", 10),
          getCandles("XAUUSD", "1d", 10),
        ]);
        const change = (candles: { close: number }[]) => {
          if (candles.length < 2) return null;
          const a = candles[candles.length - 2].close, b = candles[candles.length - 1].close;
          return { abs: +(b - a).toFixed(2), pct: +(((b - a) / a) * 100).toFixed(2) };
        };
        const sessions = sessionStates([]);
        return NextResponse.json({
          xauusd: { ...xau, change: change(xauDaily.candles) },
          gc1: { ...gc, change: change(gcDaily.candles) },
          session: activeSession(sessions),
          marketOpen: marketOpen(),
          serverTime: new Date().toISOString(),
          instruments: INSTRUMENTS,
        });
      }
      case "quote": {
        const q = await getQuote(parseInstrument(url.searchParams.get("instrument")));
        return NextResponse.json(q);
      }
      case "candles": {
        const instrument = parseInstrument(url.searchParams.get("instrument"));
        const tf = (url.searchParams.get("tf") ?? "15m") as Timeframe;
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 600), 1500);
        const r = await getCandles(instrument, tf, limit);
        return NextResponse.json(r);
      }
      case "overview": {
        const [xau, gc, macro, news, volCandles] = await Promise.all([
          getQuote("XAUUSD").catch(() => null),
          getQuote("GC1!").catch(() => null),
          getMacroAssets().catch(() => []),
          fetchAndStoreNews().catch(() => []),
          getCandles("GC1!", "1d", 60).catch(() => null),
        ]);
        const vol = volCandles ? buildVolatilityReport([], volCandles.candles, volCandles.candles.slice(-20)) : null;
        const byKey = new Map(macro.map((m) => [m.key, m]));
        return NextResponse.json({
          cards: [
            { key: "XAUUSD", label: "Gold Spot XAU/USD", quote: xau },
            { key: "GC1!", label: "COMEX Gold GC1!", quote: gc },
            { key: "DXY", label: "US Dollar Index", asset: byKey.get("DXY") ?? null },
            { key: "US10Y", label: "US 10Y Treasury Yield", asset: byKey.get("US10Y") ?? null },
            { key: "US2Y", label: "US 2Y Treasury Yield", asset: byKey.get("US2Y") ?? null },
            { key: "SILVER", label: "Silver (COMEX)", asset: byKey.get("SILVER") ?? null },
            { key: "VOL", label: "Gold Volatility (realized)", value: vol ? `${vol.historicalVolAnnual}% HV` : "unavailable", note: "Implied vol (GVZ) needs a licensed options feed — realized HV shown instead", status: vol ? "LIVE" : "UNAVAILABLE" },
            { key: "SENTIMENT", label: "Market Sentiment (news)", value: aggregateSentiment(news), note: `${news.length} classified articles` },
          ],
          serverTime: new Date().toISOString(),
        });
      }
      case "macro": {
        const assets = await getMacroAssets();
        return NextResponse.json({ assets, serverTime: new Date().toISOString() });
      }
      case "curve": {
        const curve = await getFuturesCurve();
        return NextResponse.json(curve);
      }
      case "cot": {
        const hit = cache.get<unknown>("cot:gold");
        if (hit) return NextResponse.json(hit);
        const { fetchCotGold } = await import("@/lib/providers/cftc");
        const cot = await fetchCotGold(60);
        cache.set("cot:gold", cot, 3600);
        return NextResponse.json(cot);
      }
      default:
        return NextResponse.json({ error: `Unknown market action: ${action}` }, { status: 404 });
    }
  } catch (e) {
    console.error(`market/${action} error`, e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "market data error" }, { status: 500 });
  }
}
