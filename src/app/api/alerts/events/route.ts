import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/alerts/events — recent fired alert events (for the bell/toast feed) */
export async function GET() {
  try {
    const events = await db.alertEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { alert: { select: { kind: true, instrument: true } } },
    });
    return NextResponse.json({ events });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "events error" }, { status: 500 });
  }
}
