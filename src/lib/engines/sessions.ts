/**
 * Gold session intelligence — timezone-aware sessions, killzones, opening
 * ranges, session high/low, and historical session statistics.
 *
 * Sessions (UTC): Sydney 21:00–06:00, Asia (Tokyo) 00:00–09:00,
 * London 07:00–16:00, New York 12:00–21:00.
 * Killzones (ICT convention, expressed in New York time → UTC):
 *   London KZ 02:00–05:00 ET, NY KZ 07:00–10:00 ET.
 * Weekend sessions are skipped for metals.
 */
import type { Candle, SessionKey, SessionState, SessionStats } from "./types";

export const SESSIONS: Record<Exclude<SessionKey, "LONDON_KZ" | "NY_KZ">, { name: string; openMin: number; closeMin: number }> = {
  SYDNEY: { name: "Sydney", openMin: 21 * 60, closeMin: 30 * 60 + 0 }, // 21:00 → 06:00 (+1d)
  ASIAN: { name: "Asian (Tokyo)", openMin: 0, closeMin: 9 * 60 },
  LONDON: { name: "London", openMin: 7 * 60, closeMin: 16 * 60 },
  NEW_YORK: { name: "New York", openMin: 12 * 60, closeMin: 21 * 60 },
};

export const KILLZONES = {
  LONDON_KZ: { name: "London Killzone", openMin: 7 * 60, closeMin: 10 * 60 }, // 02:00–05:00 ET ≈ 07:00–10:00 UTC (winter)
  NY_KZ: { name: "New York Killzone", openMin: 12 * 60, closeMin: 15 * 60 }, // 07:00–10:00 ET ≈ 12:00–15:00 UTC (winter)
};

const MIN = 60;

function inWindow(minOfDay: number, openMin: number, closeMin: number): boolean {
  if (openMin <= closeMin) return minOfDay >= openMin && minOfDay < closeMin;
  return minOfDay >= openMin || minOfDay < closeMin;
}

function isWeekend(t: number): boolean {
  const d = new Date(t * 1000);
  const day = d.getUTCDay();
  // Metals closed Sat (day 6) and until Sun 22:00 UTC (approx CME open)
  if (day === 6) return true;
  if (day === 0 && d.getUTCHours() < 22) return true;
  if (day === 5 && d.getUTCHours() >= 21) return true; // Fri after 21:00 UTC ≈ 5pm ET close
  return false;
}

export function sessionStates(candles: Candle[], now: number = Math.floor(Date.now() / 1000)): SessionState[] {
  const d = new Date(now * 1000);
  const minOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  const states: SessionState[] = [];

  const buildState = (key: SessionKey, name: string, openMin: number, closeMin: number): SessionState => {
    const open = inWindow(minOfDay, openMin, closeMin) && !isWeekend(now);
    // today's open time
    const dayStart = Math.floor(now / 86400) * 86400;
    const openSec = openMin <= closeMin ? dayStart + openMin * 60 : dayStart + openMin * 60;
    const closeSecRaw = openMin <= closeMin ? dayStart + closeMin * 60 : dayStart + closeMin * 60 + 86400;
    const closeSec = minOfDay >= openMin || openMin > closeMin ? closeSecRaw : closeSecRaw - 86400;
    // session candles: since most recent open
    const rel = candles.filter((c) => c.time >= openSec - 86400);
    let high: number | null = null, low: number | null = null;
    let orHigh: number | null = null, orLow: number | null = null;
    const windowCandles = rel.filter((c) => c.time >= openSec - (openMin > closeMin && minOfDay < closeMin ? 86400 : 0));
    const inSession = windowCandles.filter((c) => {
      const cd = new Date(c.time * 1000);
      const m = cd.getUTCHours() * 60 + cd.getUTCMinutes();
      return inWindow(m, openMin, closeMin);
    });
    if (inSession.length) {
      high = +Math.max(...inSession.map((c) => c.high)).toFixed(2);
      low = +Math.min(...inSession.map((c) => c.low)).toFixed(2);
      const firstHour = inSession[0].time + 3600;
      const orC = inSession.filter((c) => c.time < firstHour);
      if (orC.length) {
        orHigh = +Math.max(...orC.map((c) => c.high)).toFixed(2);
        orLow = +Math.min(...orC.map((c) => c.low)).toFixed(2);
      }
    }
    return {
      name, short: key,
      isOpen: open,
      openTime: new Date(openSec * 1000).toISOString(),
      closeTime: new Date(closeSec * 1000).toISOString(),
      high, low,
      range: high !== null && low !== null ? +(high - low).toFixed(2) : null,
      openingRange: orHigh !== null && orLow !== null ? { high: orHigh, low: orLow } : null,
    };
  };

  states.push(buildState("SYDNEY", SESSIONS.SYDNEY.name, SESSIONS.SYDNEY.openMin, SESSIONS.SYDNEY.closeMin));
  states.push(buildState("ASIAN", SESSIONS.ASIAN.name, SESSIONS.ASIAN.openMin, SESSIONS.ASIAN.closeMin));
  states.push(buildState("LONDON", SESSIONS.LONDON.name, SESSIONS.LONDON.openMin, SESSIONS.LONDON.closeMin));
  states.push(buildState("NEW_YORK", SESSIONS.NEW_YORK.name, SESSIONS.NEW_YORK.openMin, SESSIONS.NEW_YORK.closeMin));
  states.push(buildState("LONDON_KZ", KILLZONES.LONDON_KZ.name, KILLZONES.LONDON_KZ.openMin, KILLZONES.LONDON_KZ.closeMin));
  states.push(buildState("NY_KZ", KILLZONES.NY_KZ.name, KILLZONES.NY_KZ.openMin, KILLZONES.NY_KZ.closeMin));
  return states;
}

export function activeSession(states: SessionState[]): string {
  const open = states.filter((s) => s.isOpen);
  if (!open.length) return "CLOSED (weekend / no session)";
  if (open.some((s) => s.short === "LONDON_KZ")) return "LONDON KILLZONE";
  if (open.some((s) => s.short === "NY_KZ")) return "NEW YORK KILLZONE";
  return open[0].name.toUpperCase();
}

export function marketOpen(now: number = Math.floor(Date.now() / 1000)): boolean {
  return !isWeekend(now);
}

// ---------------------------------------------------------------------------
// Historical session statistics
// ---------------------------------------------------------------------------

function sessionRangeForDay(candles: Candle[], dayTs: number, openMin: number, closeMin: number): { high: number; low: number; open: number; close: number } | null {
  const d = new Date(dayTs * 1000);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (!inWindow(m, openMin, closeMin)) return null;
  const cs = candles.filter((c) => {
    const cd = new Date(c.time * 1000);
    const cm = cd.getUTCHours() * 60 + cd.getUTCMinutes();
    return inWindow(cm, openMin, closeMin);
  });
  if (cs.length < 2) return null;
  return {
    high: Math.max(...cs.map((c) => c.high)),
    low: Math.min(...cs.map((c) => c.low)),
    open: cs[0].open,
    close: cs[cs.length - 1].close,
  };
}

export function sessionStatistics(candles: Candle[]): SessionStats[] {
  // candles here = 1h (or finer) covering several weeks
  const stats: SessionStats[] = [];
  const defs: { key: SessionKey; label: string; openMin: number; closeMin: number }[] = [
    { key: "ASIAN", label: "Asian", openMin: SESSIONS.ASIAN.openMin, closeMin: SESSIONS.ASIAN.closeMin },
    { key: "LONDON", label: "London", openMin: SESSIONS.LONDON.openMin, closeMin: SESSIONS.LONDON.closeMin },
    { key: "NEW_YORK", label: "New York", openMin: SESSIONS.NEW_YORK.openMin, closeMin: SESSIONS.NEW_YORK.closeMin },
    { key: "LONDON_KZ", label: "London Killzone", openMin: KILLZONES.LONDON_KZ.openMin, closeMin: KILLZONES.LONDON_KZ.closeMin },
    { key: "NY_KZ", label: "New York Killzone", openMin: KILLZONES.NY_KZ.openMin, closeMin: KILLZONES.NY_KZ.closeMin },
  ];

  // Group candles into UTC days
  const days = new Map<number, Candle[]>();
  for (const c of candles) {
    const k = Math.floor(c.time / 86400);
    if (!days.has(k)) days.set(k, []);
    days.get(k)!.push(c);
  }
  const dayList = [...days.entries()].sort((a, b) => a[0] - b[0]);

  for (const def of defs) {
    const ranges: number[] = [];
    let sweepAsianHigh = 0, sweepAsianLow = 0, asianDays = 0;
    let displacement = 0, continuation = 0, reversal = 0, samples = 0;

    for (let di = 0; di < dayList.length; di++) {
      const [, dc] = dayList[di];
      const r = sessionRangeForDay(dc, dc[0]?.time ?? 0, def.openMin, def.closeMin);
      if (!r) continue;
      ranges.push(r.high - r.low);
      samples++;
      const body = Math.abs(r.close - r.open);
      const range = r.high - r.low || 1e-9;
      if (body >= 0.55 * range) displacement++;
      if (r.close > r.open) continuation++; else reversal++;

      // Asian range sweep check (only for London/NY sessions)
      if (def.key === "LONDON" || def.key === "NEW_YORK") {
        const asianDef = SESSIONS.ASIAN;
        const asian = sessionRangeForDay(dc, dc[0]?.time ?? 0, asianDef.openMin, asianDef.closeMin);
        if (asian) {
          asianDays++;
          if (r.high > asian.high) sweepAsianHigh++;
          if (r.low < asian.low) sweepAsianLow++;
        }
      }
    }
    const sorted = [...ranges].sort((a, b) => a - b);
    stats.push({
      key: def.key,
      label: def.label,
      avgRange: ranges.length ? +(ranges.reduce((a, b) => a + b, 0) / ranges.length).toFixed(2) : 0,
      medianRange: sorted.length ? +(sorted[Math.floor(sorted.length / 2)]).toFixed(2) : 0,
      sweepAsianHighPct: asianDays ? +((sweepAsianHigh / asianDays) * 100).toFixed(1) : 0,
      sweepAsianLowPct: asianDays ? +((sweepAsianLow / asianDays) * 100).toFixed(1) : 0,
      displacementPct: samples ? +((displacement / samples) * 100).toFixed(1) : 0,
      continuationPct: samples ? +((continuation / samples) * 100).toFixed(1) : 0,
      reversalPct: samples ? +((reversal / samples) * 100).toFixed(1) : 0,
      samples,
    });
  }
  return stats;
}

/** Midnight (00:00 UTC) opening price and daily opening range. */
export function dailyOpenings(candles: Candle[], now: number = Math.floor(Date.now() / 1000)) {
  const dayStart = Math.floor(now / 86400) * 86400;
  const today = candles.filter((c) => c.time >= dayStart);
  const midnightOpen = today.length ? today[0].open : null;
  const first30 = today.filter((c) => c.time < dayStart + 1800);
  const firstHour = today.filter((c) => c.time < dayStart + 3600);
  return {
    midnightOpen: midnightOpen ? +midnightOpen.toFixed(2) : null,
    openingRange30: first30.length
      ? { high: +Math.max(...first30.map((c) => c.high)).toFixed(2), low: +Math.min(...first30.map((c) => c.low)).toFixed(2) }
      : null,
    openingRange60: firstHour.length
      ? { high: +Math.max(...firstHour.map((c) => c.high)).toFixed(2), low: +Math.min(...firstHour.map((c) => c.low)).toFixed(2) }
      : null,
  };
}
