import { NextResponse } from "next/server";
import { getQuote } from "@/lib/server/marketData";
import { cache } from "@/lib/server/cache";
import { marketOpen } from "@/lib/engines/sessions";
import * as twelvedata from "@/lib/providers/twelvedata";
import * as finnhub from "@/lib/providers/finnhub";

export const dynamic = "force-dynamic";

/** GET /api/health — service + provider health for monitoring */
export async function GET() {
  const providers: Record<string, { configured: boolean; reachable: boolean | null; note: string }> = {
    yahoo: { configured: true, reachable: null, note: "GC1! candles/quotes + macro assets (delayed futures)" },
    "gold-api": { configured: true, reachable: null, note: "XAUUSD live spot quote" },
    binance: { configured: true, reachable: null, note: "XAUUSD candle proxy (PAXG/USDT)" },
    twelvedata: { configured: twelvedata.isConfigured(), reachable: null, note: "Direct XAU/USD spot OHLC — set TWELVEDATA_API_KEY to activate" },
    finnhub: { configured: finnhub.isConfigured(), reachable: null, note: "Licensed news + economic calendar — set FINNHUB_API_KEY to activate" },
    cftc: { configured: true, reachable: null, note: "Official COT positioning" },
  };

  const checks = await Promise.allSettled([
    getQuote("XAUUSD"),
    getQuote("GC1!"),
  ]);
  if (checks[0].status === "fulfilled") providers["gold-api"].reachable = checks[0].value.status === "LIVE" || checks[0].value.status === "DELAYED";
  if (checks[1].status === "fulfilled") providers.yahoo.reachable = checks[1].value.status === "LIVE" || checks[1].value.status === "DELAYED";

  return NextResponse.json({
    status: "ok",
    service: "GOLD INTELLIGENCE AI",
    time: new Date().toISOString(),
    marketOpen: marketOpen(),
    providers,
    cache: cache.stats(),
    disclaimer: "AI outputs are analytical estimates, not financial advice.",
  });
}
