import { NextResponse } from "next/server";
import { ensureDefaultUser } from "@/lib/server/compute";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET — current settings; PATCH — update */
export async function GET() {
  try {
    const user = await ensureDefaultUser();
    return NextResponse.json({ settings: user.settings ?? null, user: { id: user.id, name: user.name } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "settings error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const user = await ensureDefaultUser();
    const allowed = [
      "defaultInstrument", "defaultTimeframe", "chartType", "timezone",
      "minRiskReward", "requireMss", "requireSweep", "requireDisplacement",
      "requireFvg", "requireHtfAlignment", "requireFundAlignment",
      "sessionFilter", "maxVolatilityGuard", "riskPerTradePercent",
      "accountBalance", "accountCurrency", "dailyLossLimit", "overlayToggles",
    ];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (body[k] !== undefined) data[k] = body[k];
    const settings = await db.userSettings.update({ where: { userId: user.id }, data: data as never });
    return NextResponse.json({ settings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "settings error" }, { status: 500 });
  }
}
