import { NextResponse } from "next/server";
import { getFullAnalysis } from "@/lib/server/compute";
import { getCandles } from "@/lib/server/marketData";
import type { Instrument, Timeframe } from "@/lib/engines/types";

export const dynamic = "force-dynamic";

function parseInstrument(v: string | null): Instrument {
  return v === "GC1!" || v === "gc" ? "GC1!" : "XAUUSD";
}

/**
 * GET /api/analysis/[action]?instrument=&tf=
 *   full      — entire analysis bundle (structure, ICT, liquidity, sessions, vol, orderflow, regime, fib, vwap, profile)
 *   heatmap   — liquidity heatmap payload
 *   patterns  — historical pattern recognition
 *   candles+analysis convenience for the chart page
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  const url = new URL(request.url);
  const instrument = parseInstrument(url.searchParams.get("instrument"));
  const tf = (url.searchParams.get("tf") ?? "15m") as Timeframe;
  try {
    switch (action) {
      case "full": {
        const a = await getFullAnalysis(instrument, tf);
        return NextResponse.json(a);
      }
      case "heatmap": {
        const a = await getFullAnalysis(instrument, tf);
        return NextResponse.json(a.heatmap);
      }
      case "patterns": {
        const a = await getFullAnalysis(instrument, tf);
        return NextResponse.json(a.patterns);
      }
      case "overlay": {
        // chart overlay payload: candles + zones + levels for the chart engine
        const [candles, a] = await Promise.all([
          getCandles(instrument, tf, 600),
          getFullAnalysis(instrument, tf),
        ]);
        return NextResponse.json({
          candles: candles.candles,
          source: candles.source,
          status: candles.status,
          asOf: candles.asOf,
          note: candles.note,
          overlays: {
            fvg: a.ict.fvg,
            orderBlocks: a.ict.orderBlocks,
            sweeps: a.ict.sweeps,
            equalLevels: a.ict.equalLevels,
            quasimodo: a.ict.quasimodo,
            liquidityPools: a.liquidity.pools,
            fib: a.fib,
            vwap: a.vwap.daily.series,
            vwapWeekly: a.vwap.weekly.series,
            vwapBands: { upper: a.vwap.daily.stdevUpper, lower: a.vwap.daily.stdevLower, upper2: a.vwap.daily.stdev2Upper, lower2: a.vwap.daily.stdev2Lower },
            profile: a.profile,
            structure: a.structures[tf] ?? a.structures["15m"],
            premiumDiscount: {
              high: a.structures["1d"]?.rangeHigh ?? null,
              low: a.structures["1d"]?.rangeLow ?? null,
              equilibrium: a.structures["1d"]?.equilibrium ?? null,
            },
            sessions: a.sessions,
            pdhPdl: a.liquidity.pools.filter((p) => ["PDH", "PDL", "PWH", "PWL"].includes(p.kind)),
          },
        });
      }
      default:
        return NextResponse.json({ error: `Unknown analysis action: ${action}` }, { status: 404 });
    }
  } catch (e) {
    console.error(`analysis/${action} error`, e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "analysis error" }, { status: 500 });
  }
}
