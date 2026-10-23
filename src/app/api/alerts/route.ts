import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDefaultUser } from "@/lib/server/compute";

export const dynamic = "force-dynamic";

/** GET — list alerts; POST — create; PATCH — toggle; DELETE — remove */
export async function GET() {
  try {
    const user = await ensureDefaultUser();
    const alerts = await db.alert.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { events: { orderBy: { createdAt: "desc" }, take: 3 } },
    });
    return NextResponse.json({ alerts });
  } catch (e) {
    console.error("alerts GET error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "alerts error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await ensureDefaultUser();
    const b = (await request.json()) as { kind: string; instrument?: string; params?: Record<string, unknown>; channels?: string[] };
    if (!b.kind) return NextResponse.json({ error: "kind required" }, { status: 400 });
    const alert = await db.alert.create({
      data: {
        userId: user.id,
        kind: b.kind,
        instrument: b.instrument ?? "XAUUSD",
        params: JSON.stringify(b.params ?? {}),
        channels: JSON.stringify(b.channels ?? ["in_app"]),
        active: true,
      },
    });
    return NextResponse.json({ alert });
  } catch (e) {
    console.error("alerts POST error", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "alerts error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const b = (await request.json()) as { id: string; active?: boolean };
    const alert = await db.alert.update({ where: { id: b.id }, data: { active: b.active } });
    return NextResponse.json({ alert });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "alerts error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await db.alert.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "alerts error" }, { status: 500 });
  }
}
