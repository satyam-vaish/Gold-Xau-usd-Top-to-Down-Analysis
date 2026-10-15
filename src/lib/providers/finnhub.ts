/**
 * Finnhub adapter — licensed news + economic calendar.
 * ACTIVATION: requires FINNHUB_API_KEY. Without it the platform uses the
 * Yahoo news search (live) and a clearly-labelled ESTIMATED calendar.
 */
export interface FinnhubNewsItem {
  id: number;
  category: string;
  datetime: number;
  headline: string;
  summary: string;
  source: string;
  url: string;
  related: string;
}

export interface FinnhubCalendarEvent {
  event: string;
  country: string;
  time: string; // "2026-11-05 08:30:00"
  estimate: string;
  prev: string;
  actual: string;
  impact: string;
}

export function isConfigured(): boolean {
  return !!process.env.FINNHUB_API_KEY;
}

export async function finnhubNews(category = "general", count = 30): Promise<FinnhubNewsItem[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY not configured");
  const res = await fetch(`https://finnhub.io/api/v1/news?category=${category}&token=${key}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Finnhub status ${res.status}`);
  return (await res.json()) as FinnhubNewsItem[];
}

export async function finnhubEconomicCalendar(from: string, to: string): Promise<FinnhubCalendarEvent[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY not configured");
  const res = await fetch(`https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${key}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Finnhub calendar status ${res.status}`);
  const j = (await res.json()) as { economicCalendar?: FinnhubCalendarEvent[] };
  return j.economicCalendar ?? [];
}
