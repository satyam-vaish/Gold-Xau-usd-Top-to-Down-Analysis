import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { getFullAnalysis, getConfluence, getSetups, getRulesForInstrument, ensureDefaultUser } from "@/lib/server/compute";
import { getQuote } from "@/lib/server/marketData";
import { fetchAndStoreNews, aggregateSentiment } from "@/lib/server/news";
import { getUpcomingEvents } from "@/lib/server/calendar";
import { db } from "@/lib/db";
import type { Instrument } from "@/lib/engines/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ChatMessage { role: "user" | "assistant"; content: string }

/**
 * POST /api/chat — AI Trading Assistant.
 * Grounding: assembles a live market snapshot (quotes, structure, ICT, liquidity,
 * order flow, predictions, setups, news, calendar, journal stats) and forces the
 * model to answer ONLY from that snapshot, citing data timestamps. The model is
 * never allowed to pretend to see data that is not in the snapshot.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message: string;
      history?: ChatMessage[];
      instrument?: Instrument;
    };
    const message = (body.message ?? "").slice(0, 2000);
    if (!message.trim()) {
      return NextResponse.json({ error: "Message required" }, { status: 400 });
    }
    const instrument: Instrument = body.instrument === "GC1!" ? "GC1!" : "XAUUSD";
    const history = (body.history ?? []).slice(-8);

    // ---- Retrieval: build the live data snapshot ----
    const rules = await getRulesForInstrument(instrument).catch(() => null);
    const [analysis, conf, quote, news, events, setups, user] = await Promise.all([
      getFullAnalysis(instrument).catch(() => null),
      getConfluence(instrument).catch(() => null),
      getQuote(instrument).catch(() => null),
      fetchAndStoreNews().catch(() => []),
      getUpcomingEvents().catch(() => []),
      rules ? getSetups(instrument, rules).catch(() => null) : Promise.resolve(null),
      ensureDefaultUser().catch(() => null),
    ]);

    const journalStats = user
      ? await db.journalEntry.findMany({ where: { userId: user.id }, orderBy: { tradeDate: "desc" }, take: 50 }).catch(() => [])
      : [];
    const wins = journalStats.filter((j) => j.outcome === "WIN").length;
    const decided = journalStats.filter((j) => j.outcome === "WIN" || j.outcome === "LOSS").length;

    const snapshot = {
      meta: {
        instrument,
        snapshotTime: new Date().toISOString(),
        note: "Computed from live provider data at snapshotTime. Cite the timestamp. If something is not here, say you cannot see it.",
      },
      quote: quote ? { price: quote.price, status: quote.status, source: quote.source, asOf: quote.asOf } : null,
      structure: analysis ? Object.fromEntries(
        Object.entries(analysis.structures).map(([tf, s]) => [tf, {
          trend: s.trend,
          lastEvent: s.lastEvent ? `${s.lastEvent.kind} ${s.lastEvent.direction} @ ${s.lastEvent.price}` : null,
          zone: s.zone,
          range: [s.rangeLow, s.rangeHigh],
          labels: [s.lastLabelHigh, s.lastLabelLow],
          support: s.support.slice(0, 2),
          resistance: s.resistance.slice(0, 2),
        }]),
      ) : null,
      mtf: analysis?.mtf.summary ?? null,
      ict: analysis ? {
        activeFvgs: analysis.ict.fvg.filter((f) => !f.filled).slice(-3).map((f) => `${f.direction} ${f.bottom}-${f.top}`),
        orderBlocks: analysis.ict.orderBlocks.slice(-3).map((o) => `${o.direction} ${o.kind} ${o.bottom}-${o.top}`),
        recentSweeps: analysis.ict.sweeps.slice(-2).map((s) => `${s.kind} @ ${s.sweepPrice}${s.reclaimed ? " reclaimed" : ""}`),
        quasimodo: analysis.ict.quasimodo ? `${analysis.ict.quasimodo.direction} neckline ${analysis.ict.quasimodo.neckline}` : null,
        ote: analysis.ict.ote ? `${analysis.ict.ote.bottom}-${analysis.ict.ote.top}${analysis.ict.inOte ? " (price inside)" : ""}` : null,
        displacement: analysis.ict.displacement ? `${analysis.ict.displacement.direction} ${analysis.ict.displacement.bodyAtr}xATR` : null,
      } : null,
      liquidity: analysis ? {
        basis: "inferred from price action — NOT order-book depth",
        nearestBsl: analysis.liquidity.nearestBsl ? `${analysis.liquidity.nearestBsl.price} (${analysis.liquidity.nearestBsl.label})` : null,
        nearestSsl: analysis.liquidity.nearestSsl ? `${analysis.liquidity.nearestSsl.price} (${analysis.liquidity.nearestSsl.label})` : null,
        likelyTarget: analysis.liquidity.likelyTarget ? `${analysis.liquidity.likelyTarget.price} ${analysis.liquidity.likelyTarget.side}-side, confidence ${analysis.liquidity.targetConfidence}%` : null,
      } : null,
      sessions: analysis ? { active: analysis.activeSessionName, open: analysis.sessions.filter((s) => s.isOpen).map((s) => s.name), ranges: analysis.sessions.filter((s) => s.high != null).map((s) => `${s.short}: ${s.low}-${s.high}`) } : null,
      volatility: analysis ? { adr: analysis.volatility.adr, adrPct: analysis.volatility.adrPct, todayRange: analysis.volatility.dailyRange, consumedPct: analysis.volatility.rangeConsumedPct, regime: analysis.volatility.regime, hvPercentile: analysis.volatility.hvPercentile, atr: analysis.volatility.atr } : null,
      orderFlow: analysis ? { buyerPct: analysis.orderFlow.buyerPct, sellerPct: analysis.orderFlow.sellerPct, cvd: analysis.orderFlow.cvd, dataBasis: "OHLCV proxy", divergence: analysis.orderFlow.divergence.kind, absorption: analysis.orderFlow.absorption?.note ?? null } : null,
      regime: analysis ? { regime: analysis.regime.regime, confidence: analysis.regime.confidence, topEvidence: analysis.regime.evidence.slice(0, 2) } : null,
      confluence: conf ? { overallBias: conf.overallBias, score: conf.confluenceScore, probBull: conf.probBull, probBear: conf.probBear, top: conf.supporting.slice(0, 3), against: conf.conflicting.slice(0, 2), invalidation: conf.invalidation } : null,
      setups: setups ? { count: setups.setups.length, noSetupReasons: setups.noSetupReasons.slice(0, 3), top: setups.setups[0] ? { dir: setups.setups[0].direction, type: setups.setups[0].setupType, entry: setups.setups[0].entryZone, sl: setups.setups[0].stopLoss, tps: setups.setups[0].takeProfits, rr: setups.setups[0].riskReward, quality: setups.setups[0].quality } : null } : null,
      news: { sentiment: aggregateSentiment(news), top: news.slice(0, 4).map((n) => `[${n.sentiment}/${n.importance}] ${n.headline.slice(0, 90)} (${n.source})`) },
      calendar: events.slice(0, 3).map((e) => `${e.name} (${e.impact}, ${e.status}) in ${e.countdownHours.toFixed(1)}h`),
      journal: { entries: journalStats.length, winRate: decided ? +((wins / decided) * 100).toFixed(1) : null },
    };

    const systemPrompt = `You are the GOLD INTELLIGENCE AI Assistant — an institutional gold-market analyst embedded in a trading platform.

RULES (strict):
1. Base every factual claim on the MARKET SNAPSHOT below (it contains live quotes, ICT/SMC structure, liquidity, order flow, setups, news and calendar with timestamps).
2. ALWAYS cite the snapshot time for price/level claims.
3. If asked about something NOT in the snapshot (chart images, hidden stop orders, guaranteed outcomes), say explicitly that you cannot see it.
4. Liquidity figures are INFERRED from price action — never describe them as real order-book depth or known stop-loss orders.
5. Order-flow numbers are an OHLCV PROXY unless stated otherwise.
6. Never guarantee outcomes. Frame views as analytical estimates with invalidation levels.
7. STYLE: respond in concise human-readable markdown — short headers, bullets, numbers. Write for a trader. NEVER output raw JSON, never dump the snapshot, never repeat schema keys.

MARKET SNAPSHOT (structured reference — do NOT echo it):
<snapshot>
${JSON.stringify(snapshot)}
</snapshot>
END OF SNAPSHOT — now answer the user's question in clean prose.`;

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: systemPrompt },
        ...history.map((h) => ({ role: h.role, content: h.content })),
        { role: "user", content: message },
      ],
      thinking: { type: "disabled" },
    });

    const answer = completion.choices[0]?.message?.content ?? "The assistant could not produce a response.";
    return NextResponse.json({
      answer,
      snapshotTime: snapshot.meta.snapshotTime,
      sources: [quote?.source ?? "n/a", "engine suite (structure/ICT/liquidity/order-flow)", news.length ? "Yahoo Finance news" : "no news source"],
      dataSnapshot: { price: quote?.price ?? null, status: quote?.status ?? null },
    });
  } catch (e) {
    console.error("chat error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "assistant unavailable" },
      { status: 500 },
    );
  }
}
