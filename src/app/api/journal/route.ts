import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDefaultUser } from "@/lib/server/compute";

export const dynamic = "force-dynamic";

/** GET /api/journal — list entries; POST — create; PATCH — update; DELETE — remove */
export async function GET() {
  try {
    const user = await ensureDefaultUser();
    const entries = await db.journalEntry.findMany({
      where: { userId: user.id },
      orderBy: { tradeDate: "desc" },
      take: 200,
    });
    return NextResponse.json({ entries });
  } catch (e) {
    console.error("journal GET error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "journal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await ensureDefaultUser();
    const b = (await request.json()) as Record<string, unknown>;
    const entry = await db.journalEntry.create({
      data: {
        userId: user.id,
        tradeDate: b.tradeDate ? new Date(b.tradeDate as string) : new Date(),
        instrument: (b.instrument as string) ?? "XAUUSD",
        direction: (b.direction as string) ?? "LONG",
        entry: Number(b.entry ?? 0),
        stopLoss: b.stopLoss != null ? Number(b.stopLoss) : null,
        takeProfit: b.takeProfit != null ? Number(b.takeProfit) : null,
        exit: b.exit != null ? Number(b.exit) : null,
        risk: b.risk != null ? Number(b.risk) : null,
        reward: b.reward != null ? Number(b.reward) : null,
        rr: b.rr != null ? Number(b.rr) : null,
        size: b.size != null ? Number(b.size) : null,
        session: (b.session as string) ?? null,
        timeframe: (b.timeframe as string) ?? null,
        setupType: (b.setupType as string) ?? null,
        fundBias: (b.fundBias as string) ?? null,
        techBias: (b.techBias as string) ?? null,
        liquidityNote: (b.liquidityNote as string) ?? null,
        confirmations: JSON.stringify(b.confirmations ?? []),
        outcome: (b.outcome as string) ?? "OPEN",
        pnl: b.pnl != null ? Number(b.pnl) : null,
        notes: (b.notes as string) ?? null,
      },
    });
    return NextResponse.json({ entry });
  } catch (e) {
    console.error("journal POST error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "journal error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const b = (await request.json()) as { id: string } & Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const k of ["outcome", "exit", "pnl", "rr", "notes", "reward", "risk"]) {
      if (b[k] !== undefined) data[k] = k === "outcome" || k === "notes" ? b[k] : Number(b[k]);
    }
    const entry = await db.journalEntry.update({ where: { id: b.id }, data: data as never });
    return NextResponse.json({ entry });
  } catch (e) {
    console.error("journal PATCH error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "journal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await db.journalEntry.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("journal DELETE error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "journal error" }, { status: 500 });
  }
}
