import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { evaluatePredictions } from "@/lib/engines/metrics";
import { resolveDuePredictions } from "@/lib/server/predictions";
import { cache } from "@/lib/server/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/performance — REAL model evaluation from stored predictions vs
 * realized outcomes (both engines separately), plus baselines & drift.
 * Also opportunistically resolves due predictions first.
 */
export async function GET() {
  try {
    const resolved = await resolveDuePredictions().catch(() => 0);

    const rows = await db.prediction.findMany({
      where: { status: "RESOLVED" },
      include: { outcomes: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const build = (engine: string, horizon?: string) => {
      const filtered = rows.filter(
        (r) => r.engine === engine && (!horizon || r.horizon === horizon) && r.outcomes.length,
      );
      return evaluatePredictions(
        filtered.map((r) => ({
          probBull: r.probBull,
          direction: r.direction,
          realizedDir: r.outcomes[0].realizedDir,
          correct: r.outcomes[0].correct,
        })),
        engine,
        horizon ?? "ALL",
      );
    };

    const horizons = [...new Set(rows.filter((r) => r.outcomes.length).map((r) => r.horizon))];
    const techByHorizon = horizons.map((h) => build("TECHNICAL", h));
    const fundByHorizon = horizons.map((h) => build("FUNDAMENTAL", h));

    // drift: compare accuracy of the first vs second half of resolved predictions (1h horizon)
    const drift = (() => {
      const techRows = rows
        .filter((r) => r.engine === "TECHNICAL" && r.horizon === "1h" && r.outcomes.length)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      if (techRows.length < 8) return null;
      const half = Math.floor(techRows.length / 2);
      const acc = (arr: typeof techRows) => (arr.filter((r) => r.outcomes[0].correct).length / arr.length) * 100;
      const older = acc(techRows.slice(0, half));
      const newer = acc(techRows.slice(half));
      return { older: +older.toFixed(1), newer: +newer.toFixed(1), delta: +(newer - older).toFixed(1), samples: techRows.length };
    })();

    return NextResponse.json({
      technical: build("TECHNICAL"),
      fundamental: build("FUNDAMENTAL"),
      technicalByHorizon: techByHorizon,
      fundamentalByHorizon: fundByHorizon,
      drift,
      pending: rows.filter((r) => r.status === "PENDING").length,
      justResolved: resolved,
      cacheStats: cache.stats(),
      note: "Metrics come exclusively from stored predictions resolved against realized prices. Empty until predictions accumulate — figures are never simulated or claimed without data.",
    });
  } catch (e) {
    console.error("performance error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "performance error" }, { status: 500 });
  }
}
