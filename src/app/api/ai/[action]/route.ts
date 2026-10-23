import { NextResponse } from "next/server";
import { getTechnicalPredictions, getFundamentalPrediction, getConfluence, getSetups, getRulesForInstrument, ensureDefaultUser } from "@/lib/server/compute";
import { storePrediction } from "@/lib/server/predictions";
import { db } from "@/lib/db";
import type { Instrument } from "@/lib/engines/types";

export const dynamic = "force-dynamic";

function parseInstrument(v: string | null): Instrument {
  return v === "GC1!" || v === "gc" ? "GC1!" : "XAUUSD";
}

/**
 * GET /api/ai/[action]?instrument=
 *   predictions — both engines (kept independent) across horizons
 *   confluence  — master confluence engine output
 *   setups      — trade setup generator (rules from user settings)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  const url = new URL(request.url);
  const instrument = parseInstrument(url.searchParams.get("instrument"));
  try {
    switch (action) {
      case "predictions": {
        const [technical, fundamental] = await Promise.all([
          getTechnicalPredictions(instrument),
          getFundamentalPrediction(instrument).catch(() => null),
        ]);
        // persist for future evaluation (best-effort, deduped by engine+horizon+10min window)
        try {
          const latest = technical[0];
          if (latest) {
            const recent = await db.prediction.findFirst({
              where: { engine: "TECHNICAL", instrument, horizon: latest.horizon, createdAt: { gte: new Date(Date.now() - 10 * 60000) } },
            });
            if (!recent) {
              for (const p of [...technical, fundamental].filter((x): x is NonNullable<typeof x> => !!x)) {
                await storePrediction(p);
              }
            }
          }
        } catch { /* persistence optional */ }
        return NextResponse.json({
          technical,
          fundamental,
          keptIndependent: true,
          serverTime: new Date().toISOString(),
        });
      }
      case "confluence": {
        const conf = await getConfluence(instrument);
        return NextResponse.json(conf);
      }
      case "setups": {
        const rules = await getRulesForInstrument(instrument);
        const result = await getSetups(instrument, rules);
        // persist generated setups (best effort)
        try {
          for (const s of result.setups.slice(0, 5)) {
            const dup = await db.detectedSetup.findFirst({
              where: { instrument, setupType: s.setupType, createdAt: { gte: new Date(Date.now() - 10 * 60000) } },
            });
            if (!dup) {
              await db.detectedSetup.create({
                data: {
                  instrument, direction: s.direction, setupType: s.setupType, timeframe: s.timeframe,
                  session: s.session, entryLow: s.entryZone.bottom, entryHigh: s.entryZone.top,
                  entryConfirm: s.entryConfirmation, stopLoss: s.stopLoss,
                  takeProfit1: s.takeProfits[0] ?? 0, takeProfit2: s.takeProfits[1] ?? 0, takeProfit3: s.takeProfits[2] ?? 0,
                  riskReward: s.riskReward, quality: s.quality, confluences: JSON.stringify(s.confluences),
                  invalidation: s.invalidation, horizon: s.horizon, status: "ACTIVE",
                  biasSnapshot: JSON.stringify({ confluence: conf?.overallBias ?? null }),
                },
              });
            }
          }
        } catch { /* optional */ }
        return NextResponse.json({ ...result, rules });
      }
      default:
        return NextResponse.json({ error: `Unknown ai action: ${action}` }, { status: 404 });
    }
  } catch (e) {
    console.error(`ai/${action} error`, e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "ai error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  const url = new URL(request.url);
  const instrument = parseInstrument(url.searchParams.get("instrument"));
  try {
    if (action === "setups") {
      // re-scan with custom rules from body
      const body = (await request.json()) as Partial<import("@/lib/engines/setups").SetupRules>;
      const defaults = await getRulesForInstrument(instrument);
      const rules = { ...defaults, ...body };
      const result = await getSetups(instrument, rules);
      return NextResponse.json({ ...result, rules });
    }
    if (action === "settings") {
      const body = (await request.json()) as Record<string, unknown>;
      const user = await ensureDefaultUser();
      const s = await db.userSettings.update({
        where: { userId: user.id },
        data: body as never,
      });
      return NextResponse.json(s);
    }
    return NextResponse.json({ error: `Unknown ai POST action: ${action}` }, { status: 404 });
  } catch (e) {
    console.error(`ai/${action} POST error`, e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "ai error" }, { status: 500 });
  }
}
