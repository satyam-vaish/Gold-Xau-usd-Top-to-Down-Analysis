import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runBacktest, STRATEGIES, STRATEGY_LABELS, type StrategyName } from "@/lib/engines/backtest";
import { getCandles } from "@/lib/server/marketData";
import type { Instrument, Timeframe } from "@/lib/engines/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET — list strategies + saved runs; POST — run a backtest */
export async function GET() {
  try {
    const saved = await db.backtestResult.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json({
      strategies: STRATEGIES.map((s) => ({ id: s, label: STRATEGY_LABELS[s] })),
      saved: saved.map((r) => ({ ...r, params: JSON.parse(r.params ?? "{}"), trades: undefined, equityCurve: JSON.parse(r.equityCurve ?? "[]").slice(-1) })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "backtest error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const b = (await request.json()) as {
      instrument?: Instrument;
      timeframe?: Timeframe;
      strategy?: StrategyName;
      sessionFilter?: string;
      days?: number;
      minRR?: number;
      riskPct?: number;
      name?: string;
      walkForward?: boolean;
    };
    const instrument: Instrument = b.instrument === "GC1!" ? "GC1!" : "XAUUSD";
    const timeframe: Timeframe = (b.timeframe ?? "15m") as Timeframe;
    const strategy: StrategyName = STRATEGIES.includes(b.strategy as StrategyName) ? (b.strategy as StrategyName) : "ICT_LIQUIDITY_SWEEP";
    const days = Math.min(Math.max(b.days ?? 30, 5), 180);
    const dateTo = Math.floor(Date.now() / 1000);
    const dateFrom = dateTo - days * 86400;

    const data = await getCandles(instrument, timeframe, 1500);
    const report = runBacktest({
      candles: data.candles,
      instrument,
      timeframe,
      strategy,
      sessionFilter: b.sessionFilter ?? "ALL",
      dateFrom,
      dateTo,
      minRR: b.minRR ?? 3,
      riskPct: b.riskPct ?? 1,
    });

    // persist
    try {
      await db.backtestResult.create({
        data: {
          name: b.name ?? `${STRATEGY_LABELS[strategy]} ${days}d`,
          instrument, timeframe, strategy,
          sessionFilter: b.sessionFilter ?? "ALL",
          dateFrom: new Date(dateFrom * 1000),
          dateTo: new Date(dateTo * 1000),
          params: JSON.stringify({ minRR: b.minRR ?? 3, riskPct: b.riskPct ?? 1 }),
          totalTrades: report.metrics.totalTrades,
          winRate: report.metrics.winRate,
          profitFactor: report.metrics.profitFactor,
          netReturn: report.metrics.netReturnPct,
          maxDrawdown: report.metrics.maxDrawdownPct,
          avgRR: report.metrics.avgRR,
          expectancy: report.metrics.expectancyR,
          sharpe: report.metrics.sharpe,
          equityCurve: JSON.stringify(report.equityCurve.map((p) => ({ time: p.time, equity: p.equity })).filter((_, i) => i % 5 === 0)),
          trades: JSON.stringify(report.trades.slice(0, 200)),
          assumptions: JSON.stringify(report.assumptions),
          walkForward: JSON.stringify(report.walkForward),
        },
      });
    } catch (e) {
      console.error("backtest persist failed", e);
    }

    return NextResponse.json(report);
  } catch (e) {
    console.error("backtest POST error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "backtest error" }, { status: 500 });
  }
}
