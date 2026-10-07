/**
 * Order-flow engine — buyer/seller pressure, delta, CVD, imbalances,
 * absorption, exhaustion and price/CVD divergence.
 *
 * DATA BASIS HONESTY: unless an aggressor-tagged feed is connected, all
 * buy/sell split values are a PROXY derived from OHLCV candles
 * (volume weighted by candle body position and wick asymmetry). Reports
 * carry `dataBasis` so the UI can label every number correctly.
 */
import type { Candle, OrderFlowReport, Timeframe } from "./types";

/**
 * Proxy aggressor split for one candle:
 * weight = close position in range, adjusted by wick asymmetry.
 */
function candleDelta(c: Candle): { buy: number; sell: number } {
  const v = c.volume ?? 0;
  if (v <= 0) return { buy: 0, sell: 0 };
  const range = c.high - c.low || 1e-9;
  const closeFrac = (c.close - c.low) / range;         // 0..1
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const wickBias = (lowerWick - upperWick) / range;    // >0 → buying absorption at lows
  let buyFrac = 0.5 + (closeFrac - 0.5) * 0.7 + wickBias * 0.15;
  buyFrac = Math.min(0.95, Math.max(0.05, buyFrac));
  return { buy: v * buyFrac, sell: v * (1 - buyFrac) };
}

export function buildOrderFlow(candles: Candle[], timeframe: Timeframe, lookback = 120): OrderFlowReport {
  const window = candles.slice(-lookback);
  const series = [];
  let cvd = 0;
  for (const c of window) {
    const { buy, sell } = candleDelta(c);
    cvd += buy - sell;
    series.push({ time: c.time, buyVolume: +buy.toFixed(1), sellVolume: +sell.toFixed(1), delta: +(buy - sell).toFixed(1), cvd: +cvd.toFixed(1) });
  }
  const buyVolume = series.reduce((a, b) => a + b.buyVolume, 0);
  const sellVolume = series.reduce((a, b) => a + b.sellVolume, 0);
  const total = buyVolume + sellVolume || 1;
  const buyerPct = +((buyVolume / total) * 100).toFixed(1);
  const sellerPct = +((sellVolume / total) * 100).toFixed(1);
  const recent = series.slice(-12);
  const recentDelta = recent.reduce((a, b) => a + b.delta, 0);
  const aggressiveBuying = recentDelta > 0 && buyerPct > 55;
  const aggressiveSelling = recentDelta < 0 && sellerPct > 55;

  // Volume imbalances (proxy): consecutive candles where one side dominates 70%+
  const stackedImbalances: OrderFlowReport["stackedImbalances"] = [];
  for (let i = 2; i < series.length; i++) {
    const s = series.slice(i - 2, i + 1);
    const buyDom = s.every((x) => x.buyVolume > x.sellVolume * 1.8);
    const sellDom = s.every((x) => x.sellVolume > x.buyVolume * 1.8);
    if (buyDom) stackedImbalances.push({ side: "BUY", count: 3, time: s[2].time });
    else if (sellDom) stackedImbalances.push({ side: "SELL", count: 3, time: s[2].time });
  }
  const lastImb = stackedImbalances[stackedImbalances.length - 1] ?? null;

  // Absorption: high volume but small range → passive side absorbing
  let absorption: OrderFlowReport["absorption"] = null;
  if (window.length >= 3) {
    const avgRange = window.slice(-20).reduce((a, c) => a + (c.high - c.low), 0) / Math.min(20, window.length);
    const avgVol = window.slice(-20).reduce((a, c) => a + (c.volume ?? 0), 0) / Math.min(20, window.length);
    const last3 = window.slice(-3);
    for (const c of last3.reverse()) {
      const vol = c.volume ?? 0;
      const range = c.high - c.low;
      if (vol > avgVol * 1.4 && range < avgRange * 0.6) {
        absorption = {
          side: c.close > c.open ? "BUY" : "SELL",
          time: c.time,
          note: `High volume (${(vol / avgVol).toFixed(1)}× avg) in a compressed range — passive ${c.close > c.open ? "buying absorbed aggressive selling" : "selling absorbed aggressive buying"} (proxy estimate).`,
        };
        break;
      }
    }
  }

  // CVD divergence vs price over the window
  let divergence: OrderFlowReport["divergence"] = { kind: null, note: "No significant divergence detected." };
  if (series.length >= 30) {
    const priceSeg = window.slice(-15);
    const cvdSeg = series.slice(-15);
    const priceUp = priceSeg[priceSeg.length - 1].close > priceSeg[0].open;
    const cvdUp = cvdSeg[cvdSeg.length - 1].cvd > cvdSeg[0].cvd;
    if (priceUp && !cvdUp) divergence = { kind: "BEARISH", note: "Price making highs while CVD flat/falling — buying momentum weakening (proxy)." };
    else if (!priceUp && cvdUp) divergence = { kind: "BULLISH", note: "Price falling while CVD rising — sellers exhausting (proxy)." };
  }

  return {
    series,
    buyVolume: +buyVolume.toFixed(1),
    sellVolume: +sellVolume.toFixed(1),
    buyerPct,
    sellerPct,
    delta: +(buyVolume - sellVolume).toFixed(1),
    cvd: +cvd.toFixed(1),
    aggressiveBuying,
    aggressiveSelling,
    stackedImbalances: stackedImbalances.slice(-6),
    absorption,
    divergence,
    dataBasis: "PROXY",
    timeframe,
  };
}
