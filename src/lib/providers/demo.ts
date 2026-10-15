/**
 * Demo data generator — SYNTHETIC series used ONLY when no real provider is
 * reachable for an instrument. Every demo payload is stamped status=DEMO and
 * the UI renders a visible DEMO badge. Never mixed silently with real data.
 */
import type { Candle, Timeframe } from "../engines/types";
import type { CandleResponse } from "./types";

/** Deterministic multi-regime random walk (GBM with regime shifts) anchored to `anchor`. */
export function demoCandles(
  timeframe: Timeframe,
  anchor: number,
  count = 600,
  seed = 7,
): CandleResponse {
  const minutes: Record<Timeframe, number> = {
    "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240, "1d": 1440, "1w": 10080, "1M": 43200,
  };
  const step = minutes[timeframe] * 60;
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const volBase = 0.0009 * Math.sqrt(minutes[timeframe] / 15);
  const out: Candle[] = [];
  const now = Math.floor(Date.now() / 1000 / step) * step;
  let price = anchor;
  let drift = 0.00002;

  for (let i = count - 1; i >= 0; i--) {
    if (i % 90 === 0) drift = (rand() - 0.45) * 0.00012; // regime shifts
    const shock = rand() < 0.01 ? (rand() - 0.5) * volBase * 30 : 0;
    const ret = drift + (rand() - 0.5) * 2 * volBase + shock;
    const open = price;
    const close = open * (1 + ret);
    const high = Math.max(open, close) * (1 + rand() * volBase * 0.8);
    const low = Math.min(open, close) * (1 - rand() * volBase * 0.8);
    out.push({
      time: now - i * step,
      open: +open.toFixed(2), high: +high.toFixed(2), low: +low.toFixed(2), close: +close.toFixed(2),
      volume: Math.round(400 + rand() * 900),
    });
    price = close;
  }
  return {
    candles: out,
    source: "Demo simulator (synthetic)",
    status: "DEMO",
    asOf: new Date().toISOString(),
    note: "SYNTHETIC demonstration data — not real market prices. Connect a licensed provider (see Settings) for live data.",
  };
}

/** Demo economic calendar — recurring schedule estimates, clearly labelled ESTIMATED. */
export function demoEconomicEvents(): {
  id: string; name: string; country: string; eventTime: string;
  previous: string | null; forecast: string | null; actual: string | null;
  impact: string; kind: string; status: "ESTIMATED";
}[] {
  const now = new Date();
  const mk = (dayOffset: number, hourUtc: number, minute = 30) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, hourUtc, minute));
    return d.toISOString();
  };
  // Typical monthly cadence anchors (US): CPI/NFP/Retail ~13:30 UTC, FOMC 19:00 UTC.
  // These are schedule ESTIMATES, not confirmed dates — the UI labels them ESTIMATED.
  return [
    { id: "demo-cpi", name: "CPI m/m (US)", country: "US", eventTime: mk(2, 13, 30), previous: "0.3%", forecast: "0.3%", actual: null, impact: "HIGH", kind: "CPI", status: "ESTIMATED" as const },
    { id: "demo-nfp", name: "Non-Farm Payrolls", country: "US", eventTime: mk(5, 13, 30), previous: "185K", forecast: "170K", actual: null, impact: "HIGH", kind: "NFP", status: "ESTIMATED" as const },
    { id: "demo-fomc", name: "FOMC Rate Decision", country: "US", eventTime: mk(9, 19, 0), previous: "4.00%", forecast: "3.75%", actual: null, impact: "HIGH", kind: "FOMC", status: "ESTIMATED" as const },
    { id: "demo-unemp", name: "Unemployment Claims", country: "US", eventTime: mk(1, 13, 30), previous: "221K", forecast: "225K", actual: null, impact: "MEDIUM", kind: "UNEMPLOYMENT", status: "ESTIMATED" as const },
    { id: "demo-pce", name: "Core PCE Price Index y/y", country: "US", eventTime: mk(12, 13, 30), previous: "2.7%", forecast: "2.6%", actual: null, impact: "HIGH", kind: "PCE", status: "ESTIMATED" as const },
    { id: "demo-retail", name: "Retail Sales m/m", country: "US", eventTime: mk(6, 13, 30), previous: "0.4%", forecast: "0.3%", actual: null, impact: "MEDIUM", kind: "RETAIL", status: "ESTIMATED" as const },
    { id: "demo-gdp", name: "GDP q/q (advance)", country: "US", eventTime: mk(15, 13, 30), previous: "2.8%", forecast: "2.5%", actual: null, impact: "HIGH", kind: "GDP", status: "ESTIMATED" as const },
    { id: "demo-speech", name: "Fed Chair Speech", country: "US", eventTime: mk(3, 17, 0), previous: null, forecast: null, actual: null, impact: "MEDIUM", kind: "SPEECH", status: "ESTIMATED" as const },
  ];
}
