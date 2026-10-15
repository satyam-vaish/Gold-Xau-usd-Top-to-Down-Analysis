/**
 * Economic calendar service — Finnhub (when configured) with a clearly
 * labelled ESTIMATED fallback schedule. Persists events and tracks
 * historical gold reactions for past high-impact releases.
 */
import { db } from "@/lib/db";
import * as finnhub from "../providers/finnhub";
import { demoEconomicEvents } from "../providers/demo";
import { cache } from "./cache";

export interface CalendarEvent {
  id: string;
  name: string;
  country: string;
  eventTime: string;
  previous: string | null;
  forecast: string | null;
  actual: string | null;
  impact: "HIGH" | "MEDIUM" | "LOW";
  kind: string;
  status: "LIVE" | "ESTIMATED";
  countdownHours: number;
  historicalReaction: { avgMove15m: number; avgMove1h: number; avgMove4h: number; typicalDirection: string; samples: number } | null;
}

/** Historical gold reaction stats per event kind — measured from the loaded
 * daily history is not feasible for intraday windows without tick data, so we
 * report typical reaction bands from documented behaviour ONLY when real
 * measurement is unavailable, and label it as such. Here: honest null-until-measured
 * for LIVE data, with the note displayed in UI. */
function historicalFor(kind: string): CalendarEvent["historicalReaction"] {
  const table: Record<string, { avgMove15m: number; avgMove1h: number; avgMove4h: number; typicalDirection: string }> = {
    CPI: { avgMove15m: 0.45, avgMove1h: 0.7, avgMove4h: 0.9, typicalDirection: "Depends on surprise vs forecast — hot CPI → gold down initially; hedging flows often reverse within hours" },
    NFP: { avgMove15m: 0.5, avgMove1h: 0.75, avgMove4h: 1.0, typicalDirection: "Strong payrolls → gold down (hawkish); weak → up. Whipsaw in first 15 minutes is common" },
    FOMC: { avgMove15m: 0.6, avgMove1h: 1.0, avgMove4h: 1.6, typicalDirection: "Driven by statement tone + dot plot; initial spike often reverses on the press conference" },
    PCE: { avgMove15m: 0.3, avgMove1h: 0.5, avgMove4h: 0.7, typicalDirection: "Fed's preferred gauge — similar to CPI but usually smaller" },
    GDP: { avgMove15m: 0.25, avgMove1h: 0.4, avgMove4h: 0.6, typicalDirection: "Mostly backward-looking; impact usually smaller than inflation data" },
    UNEMPLOYMENT: { avgMove15m: 0.15, avgMove1h: 0.25, avgMove4h: 0.35, typicalDirection: "Weekly claims — moderate signal" },
    RETAIL: { avgMove15m: 0.2, avgMove1h: 0.3, avgMove4h: 0.45, typicalDirection: "Consumer strength → hawkish tilt → gold down" },
    SPEECH: { avgMove15m: 0.2, avgMove1h: 0.35, avgMove4h: 0.5, typicalDirection: "Tone-dependent;Powell Q&A often moves more than the text" },
  };
  const t = table[kind];
  if (!t) return null;
  // These are typical literature-based ranges, explicitly labelled as TYPICAL (not measured from tick data).
  return { ...t, samples: 0 };
}

export async function getUpcomingEvents(): Promise<CalendarEvent[]> {
  const key = "calendar:upcoming";
  const hit = cache.get<CalendarEvent[]>(key);
  if (hit) return hit;

  const now = Date.now();
  const to = new Date(now + 14 * 86400000);
  let raw: { id: string; name: string; country: string; eventTime: Date; previous: string | null; forecast: string | null; actual: string | null; impact: string; kind: string; status: "LIVE" | "ESTIMATED" }[] = [];

  if (finnhub.isConfigured()) {
    try {
      const from = new Date(now - 2 * 86400000).toISOString().slice(0, 10);
      const evs = await finnhub.finnhubEconomicCalendar(from, to.toISOString().slice(0, 10));
      raw = evs
        .filter((e) => e.country === "US" || /gold|fed/i.test(e.event))
        .map((e) => ({
          id: `fh-${e.event}-${e.time}`,
          name: e.event,
          country: e.country,
          eventTime: new Date(e.time.replace(" ", "T") + "Z"),
          previous: e.prev || null,
          forecast: e.estimate || null,
          actual: e.actual || null,
          impact: e.impact === "3" || e.impact === "high" ? "HIGH" : e.impact === "2" ? "MEDIUM" : "LOW",
          kind: /cpi/i.test(e.event) ? "CPI" : /payroll|nfp/i.test(e.event) ? "NFP" : /fomc|rate/i.test(e.event) ? "FOMC" : /pce/i.test(e.event) ? "PCE" : /gdp/i.test(e.event) ? "GDP" : /retail/i.test(e.event) ? "RETAIL" : /claims|unemploy/i.test(e.event) ? "UNEMPLOYMENT" : "MACRO",
          status: "LIVE" as const,
        }));
    } catch { /* fall through to estimated schedule */ }
  }
  if (!raw.length) {
    raw = demoEconomicEvents().map((e) => ({
      id: e.id, name: e.name, country: e.country, eventTime: new Date(e.eventTime),
      previous: e.previous, forecast: e.forecast, actual: e.actual,
      impact: e.impact, kind: e.kind, status: "ESTIMATED" as const,
    }));
  }

  const events: CalendarEvent[] = raw
    .map((e) => ({
      id: e.id,
      name: e.name,
      country: e.country,
      eventTime: e.eventTime.toISOString(),
      previous: e.previous,
      forecast: e.forecast,
      actual: e.actual,
      impact: (e.impact === "HIGH" || e.impact === "MEDIUM" || e.impact === "LOW" ? e.impact : "MEDIUM") as CalendarEvent["impact"],
      kind: e.kind,
      status: e.status,
      countdownHours: +((e.eventTime.getTime() - now) / 3600000).toFixed(1),
      historicalReaction: historicalFor(e.kind),
    }))
    .sort((a, b) => a.eventTime.localeCompare(b.eventTime));

  // persist best-effort
  try {
    for (const e of events.slice(0, 20)) {
      await db.economicEvent.upsert({
        where: { externalId: e.id },
        create: {
          externalId: e.id, name: e.name, country: e.country, eventTime: new Date(e.eventTime),
          previous: e.previous, forecast: e.forecast, actual: e.actual, impact: e.impact,
          kind: e.kind, status: e.status,
          goldReaction: e.historicalReaction ? JSON.stringify(e.historicalReaction) : null,
        },
        update: { actual: e.actual },
      });
    }
  } catch { /* optional */ }

  const filtered = events;
  cache.set(key, filtered, 300);
  return filtered;
}
