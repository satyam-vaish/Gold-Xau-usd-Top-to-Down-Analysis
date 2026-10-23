import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDefaultUser } from "@/lib/server/compute";

export const dynamic = "force-dynamic";

/** GET /api/journal/stats — performance analytics from journal entries */
export async function GET() {
  try {
    const user = await ensureDefaultUser();
    const entries = await db.journalEntry.findMany({
      where: { userId: user.id },
      orderBy: { tradeDate: "asc" },
    });

    const closed = entries.filter((e) => e.outcome === "WIN" || e.outcome === "LOSS" || e.outcome === "BE");
    const wins = closed.filter((e) => e.outcome === "WIN");
    const losses = closed.filter((e) => e.outcome === "LOSS");
    const gp = wins.reduce((a, b) => a + (b.pnl ?? 0), 0);
    const gl = Math.abs(losses.reduce((a, b) => a + (b.pnl ?? 0), 0));
    const rr = closed.map((e) => e.rr).filter((x): x is number => x !== null);

    // equity curve from pnl
    let equity = 10000;
    const equityCurve = [{ ts: closed[0]?.tradeDate?.toISOString() ?? new Date().toISOString(), equity }];
    for (const e of closed) {
      equity += e.pnl ?? 0;
      equityCurve.push({ ts: e.tradeDate.toISOString(), equity: +equity.toFixed(2) });
    }
    let peak = 10000, maxDd = 0;
    for (const p of equityCurve) {
      peak = Math.max(peak, p.equity);
      maxDd = Math.max(maxDd, peak - p.equity);
    }

    const group = <T extends string>(fn: (e: (typeof closed)[number]) => T | null) => {
      const m = new Map<T, { n: number; wins: number; pnl: number }>();
      for (const e of closed) {
        const k = fn(e);
        if (!k) continue;
        const cur = m.get(k) ?? { n: 0, wins: 0, pnl: 0 };
        cur.n++;
        if (e.outcome === "WIN") cur.wins++;
        cur.pnl += e.pnl ?? 0;
        m.set(k, cur);
      }
      return [...m.entries()].map(([k, v]) => ({ key: k, trades: v.n, winRate: +((v.wins / v.n) * 100).toFixed(1), pnl: +v.pnl.toFixed(2) })).sort((a, b) => b.pnl - a.pnl);
    };

    return NextResponse.json({
      totals: {
        entries: entries.length,
        closed: closed.length,
        wins: wins.length,
        losses: losses.length,
        open: entries.filter((e) => e.outcome === "OPEN").length,
        winRate: closed.length ? +((wins.length / closed.length) * 100).toFixed(1) : null,
        lossRate: closed.length ? +((losses.length / closed.length) * 100).toFixed(1) : null,
        profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : gp > 0 ? 99 : null,
        avgRR: rr.length ? +(rr.reduce((a, b) => a + b, 0) / rr.length).toFixed(2) : null,
        expectancy: closed.length ? +(((gp - gl) / closed.length)).toFixed(2) : null,
        totalPnl: +(gp - gl).toFixed(2),
        maxDrawdown: +maxDd.toFixed(2),
        avgWinner: wins.length ? +(gp / wins.length).toFixed(2) : null,
        avgLoser: losses.length ? +(-(gl / losses.length)).toFixed(2) : null,
      },
      bySession: group((e) => (e.session ?? null) as string | null),
      bySetup: group((e) => (e.setupType ?? null) as string | null),
      byTimeframe: group((e) => (e.timeframe ?? null) as string | null),
      byInstrument: group((e) => e.instrument),
      equityCurve,
      monthly: (() => {
        const m = new Map<string, number>();
        for (const e of closed) {
          const k = e.tradeDate.toISOString().slice(0, 7);
          m.set(k, (m.get(k) ?? 0) + (e.pnl ?? 0));
        }
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, pnl]) => ({ month, pnl: +pnl.toFixed(2) }));
      })(),
    });
  } catch (e) {
    console.error("journal/stats error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "stats error" }, { status: 500 });
  }
}
