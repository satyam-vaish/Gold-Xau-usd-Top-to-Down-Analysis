/**
 * Volatility engine — ATR (multi-TF), ADR/AWR, range consumption, historical
 * volatility + percentile, expansion/contraction regime, session volatility.
 */
import type { Candle, Timeframe, VolatilityReport } from "./types";
import { atr, lastValue, mean, percentile, stdev } from "./indicators";

const DAY = 86400;

export function buildVolatilityReport(
  hourly: Candle[],
  daily: Candle[],
  weekly: Candle[],
  now: number = Math.floor(Date.now() / 1000),
): VolatilityReport {
  const atrH1 = lastValue(atr(hourly, 14)) ?? 0;
  const atrM15 = lastValue(atr(hourly, 14)) ?? 0;
  const atrD = lastValue(atr(daily, 14)) ?? 0;

  // ADR: average high-low of last 14 completed days
  const todayKey = Math.floor(now / DAY);
  const completedDays = daily.filter((c) => Math.floor(c.time / DAY) < todayKey).slice(-14);
  const ranges = completedDays.map((c) => c.high - c.low);
  const adr = mean(ranges);
  const lastClose = daily.length ? daily[daily.length - 1].close : 0;

  // today's range from intraday (hourly) candles
  const todayCandles = hourly.filter((c) => c.time >= todayKey * DAY);
  const dailyRange = todayCandles.length
    ? Math.max(...todayCandles.map((c) => c.high)) - Math.min(...todayCandles.map((c) => c.low))
    : 0;
  const rangeConsumedPct = adr > 0 ? +((dailyRange / adr) * 100).toFixed(1) : 0;

  // AWR
  const completedWeeks: Candle[] = [];
  const weekMap = new Map<number, Candle[]>();
  for (const c of daily.filter((x) => Math.floor(x.time / DAY) < todayKey)) {
    const d = new Date(c.time * 1000);
    const monday = Math.floor(c.time / DAY) - ((d.getUTCDay() + 6) % 7);
    if (!weekMap.has(monday)) weekMap.set(monday, []);
    weekMap.get(monday)!.push(c);
  }
  for (const [, cs] of [...weekMap.entries()].sort((a, b) => b[0] - a[0]).slice(0, 8)) {
    if (cs.length >= 3) completedWeeks.push({ time: cs[0].time, open: cs[0].open, high: Math.max(...cs.map((c) => c.high)), low: Math.min(...cs.map((c) => c.low)), close: cs[cs.length - 1].close });
  }
  const awr = mean(completedWeeks.map((c) => c.high - c.low));

  // Historical volatility: stdev of daily log returns × √252
  const rets: number[] = [];
  for (let i = 1; i < daily.length; i++) {
    rets.push(Math.log(daily[i].close / daily[i - 1].close));
  }
  const sd = stdev(rets.slice(-60));
  const hv = sd * Math.sqrt(252) * 100;
  const hvWindow = [];
  for (let i = 20; i <= rets.length; i++) {
    hvWindow.push(stdev(rets.slice(i - 20, i)) * Math.sqrt(252) * 100);
  }
  const hvPercentile = hvWindow.length
    ? +((hvWindow.filter((v) => v <= hv).length / hvWindow.length) * 100).toFixed(0)
    : 50;

  // Expansion / contraction: 5-day ATR vs 20-day ATR
  const atr5 = mean(daily.slice(-5).map((c) => c.high - c.low));
  const atr20 = mean(daily.slice(-20).map((c) => c.high - c.low));
  const ratio = atr20 > 0 ? atr5 / atr20 : 1;
  const expansion = ratio > 1.25;
  const contraction = ratio < 0.75;

  // Session volatility (avg range by session over hourly data)
  const sessionVol: Record<string, number> = {};
  const sessionDefs: Record<string, [number, number]> = {
    ASIAN: [0, 9], LONDON: [7, 16], NEW_YORK: [12, 21],
  };
  for (const [name, [o, c]] of Object.entries(sessionDefs)) {
    const cs = hourly.filter((x) => {
      const h = new Date(x.time * 1000).getUTCHours();
      return h >= o && h < c;
    }).slice(-14 * 24);
    const byDay = new Map<number, Candle[]>();
    for (const x of cs) {
      const k = Math.floor(x.time / DAY);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k)!.push(x);
    }
    const rs = [...byDay.values()].map((arr) => Math.max(...arr.map((c) => c.high)) - Math.min(...arr.map((c) => c.low)));
    sessionVol[name] = rs.length ? +mean(rs).toFixed(2) : 0;
  }

  // News-driven volatility: biggest 1h range in the last 5 days vs median
  const last120 = hourly.slice(-120);
  const hourRanges = last120.map((c) => c.high - c.low);
  const medianRange = hourRanges.length ? [...hourRanges].sort((a, b) => a - b)[Math.floor(hourRanges.length / 2)] : 0;
  const maxRange = hourRanges.length ? Math.max(...hourRanges) : 0;
  const newsDrivenVol = medianRange > 0 ? +(maxRange / medianRange).toFixed(2) : null;

  const stdevDaily = stdev(ranges);

  return {
    atr: { "1h": +(atrH1 ?? 0).toFixed(2), "15m": +(atrM15 ?? 0).toFixed(2), "1d": +(atrD ?? 0).toFixed(2) },
    adr: +adr.toFixed(2),
    adrPct: lastClose ? +((adr / lastClose) * 100).toFixed(2) : 0,
    awr: +awr.toFixed(2),
    dailyRange: +dailyRange.toFixed(2),
    rangeConsumedPct,
    remainingRange: +Math.max(adr - dailyRange, 0).toFixed(2),
    historicalVolAnnual: +hv.toFixed(1),
    hvPercentile,
    regime: expansion ? "EXPANSION" : contraction ? "CONTRACTION" : "NORMAL",
    expansion,
    contraction,
    stdevDaily: +stdevDaily.toFixed(2),
    sessionVol,
    newsDrivenVol,
    atrTimeframe: "1d",
  };
}
