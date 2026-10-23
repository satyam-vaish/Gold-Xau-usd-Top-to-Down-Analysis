import { NextResponse } from "next/server";
import { fetchAndStoreNews, aggregateSentiment } from "@/lib/server/news";
import { getUpcomingEvents } from "@/lib/server/calendar";
import { getMacroAssets, getCandles } from "@/lib/server/marketData";
import { yahooCandles, YAHOO_SYMBOLS } from "@/lib/providers/yahoo";
import { buildIntermarketReport, goldSilverRatio } from "@/lib/engines/intermarket";

export const dynamic = "force-dynamic";

/**
 * GET /api/fundamental/[action]
 *   news      — classified live news + aggregate sentiment
 *   calendar  — economic calendar with countdown + typical reactions
 *   macro     — macro dashboard assets
 *   intermarket — correlation matrix, rolling correlations, RS, divergences
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  const url = new URL(request.url);
  try {
    switch (action) {
      case "news": {
        const news = await fetchAndStoreNews();
        return NextResponse.json({
          articles: news,
          aggregateSentiment: aggregateSentiment(news),
          count: news.length,
          serverTime: new Date().toISOString(),
        });
      }
      case "calendar": {
        const events = await getUpcomingEvents();
        return NextResponse.json({
          events,
          serverTime: new Date().toISOString(),
          note: "Event schedule is ESTIMATED (typical release cadence) unless a Finnhub key is configured. Typical-reaction figures are literature-based bands, not measurements from tick data.",
        });
      }
      case "macro": {
        const assets = await getMacroAssets();
        return NextResponse.json({ assets, serverTime: new Date().toISOString() });
      }
      case "intermarket": {
        const windowBars = Math.min(Number(url.searchParams.get("window") ?? 90), 250);
        const [gold, dxy, y10, silver, spx, vix, wti, usdinr] = await Promise.all([
          getCandles("GC1!", "1d", 300),
          yahooCandles(YAHOO_SYMBOLS.DXY, "1d", 300).catch(() => null),
          yahooCandles(YAHOO_SYMBOLS.US10Y, "1d", 300).catch(() => null),
          yahooCandles(YAHOO_SYMBOLS.SILVER, "1d", 300).catch(() => null),
          yahooCandles(YAHOO_SYMBOLS.SPX, "1d", 300).catch(() => null),
          yahooCandles(YAHOO_SYMBOLS.VIX, "1d", 300).catch(() => null),
          yahooCandles(YAHOO_SYMBOLS.WTI, "1d", 300).catch(() => null),
          yahooCandles(YAHOO_SYMBOLS.USDINR, "1d", 300).catch(() => null),
        ]);
        const assets = [
          { name: "DXY", candles: dxy?.candles ?? [], inverse: true },
          { name: "US 10Y Yield", candles: y10?.candles ?? [], inverse: true },
          { name: "Silver", candles: silver?.candles ?? [] },
          { name: "S&P 500", candles: spx?.candles ?? [] },
          { name: "VIX", candles: vix?.candles ?? [] },
          { name: "WTI Crude", candles: wti?.candles ?? [] },
          { name: "USD/INR", candles: usdinr?.candles ?? [], inverse: true },
        ].filter((a) => a.candles.length > 30);
        const report = buildIntermarketReport(gold.candles, assets, windowBars);
        const ratio = silver ? goldSilverRatio(gold.candles, silver.candles) : [];
        return NextResponse.json({ ...report, goldSilverRatio: ratio.slice(-120), serverTime: new Date().toISOString() });
      }
      default:
        return NextResponse.json({ error: `Unknown fundamental action: ${action}` }, { status: 404 });
    }
  } catch (e) {
    console.error(`fundamental/${action} error`, e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "fundamental error" }, { status: 500 });
  }
}
