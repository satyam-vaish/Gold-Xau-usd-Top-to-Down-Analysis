/**
 * Confluence Engine — the single master intelligence layer that merges the
 * independent fundamental & technical predictions with liquidity, order flow,
 * volatility, regime, session and news sentiment.
 *
 * Rule: when evidence conflicts, the engine is allowed to output NEUTRAL and
 * never forces a directional conclusion.
 */
import type { ConfluenceOutput, LiquidityReport, OrderFlowReport, PredictionOutput, RegimeReport, SessionState, VolatilityReport, TimeframeStructure } from "./types";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function buildConfluence(args: {
  fundamental: PredictionOutput | null;
  technical: PredictionOutput | null;
  structures: TimeframeStructure[];
  liquidity: LiquidityReport | null;
  orderFlow: OrderFlowReport | null;
  volatility: VolatilityReport | null;
  regime: RegimeReport | null;
  sessions: SessionState[];
  newsSentiment: number; // -1..1
  instrument: string;
  price: number;
}): ConfluenceOutput {
  const { fundamental, technical, structures, liquidity, orderFlow, volatility, regime, sessions, newsSentiment, price } = args;

  // --- weights (transparent, fixed) ---
  const W = {
    technical: 0.3, fundamental: 0.2, mtf: 0.12, liquidity: 0.1,
    orderFlow: 0.1, regime: 0.08, session: 0.04, news: 0.06,
  };

  const techBias = technical
    ? (technical.probBull - technical.probBear) / Math.max(technical.probBull + technical.probBear, 1e-9)
    : 0;
  const fundBias = fundamental
    ? (fundamental.probBull - fundamental.probBear) / Math.max(fundamental.probBull + fundamental.probBear, 1e-9)
    : 0;

  // MTF alignment score
  let mtf = 0;
  for (const s of structures) {
    if (s.trend === "UPTREND") mtf += 1;
    else if (s.trend === "DOWNTREND") mtf -= 1;
    if (s.lastEvent) mtf += s.lastEvent.direction === "BULLISH" ? 0.5 : -0.5;
  }
  mtf = clamp(mtf / Math.max(structures.length * 1.5, 1), -1, 1);

  // Liquidity draw: price is pulled toward the nearest OPEN pool (untested liquidity)
  let liq = 0;
  let liquidityCondition = "No significant liquidity asymmetry detected";
  if (liquidity?.likelyTarget) {
    liq = liquidity.likelyTarget.side === "BUY" ? 0.6 : -0.6;
    liquidityCondition = `Nearest inferred liquidity: ${liquidity.likelyTarget.label} @ ${liquidity.likelyTarget.price} (${liquidity.likelyTarget.side}-side) — price tends to seek untested liquidity`;
  }

  const of = orderFlow ? clamp((orderFlow.buyerPct - 50) / 25, -1, 1) : 0;

  let regimeScore = 0;
  if (regime) {
    if (regime.regime === "TRENDING_BULLISH") regimeScore = 0.7;
    else if (regime.regime === "TRENDING_BEARISH") regimeScore = -0.7;
    else if (regime.regime === "BREAKOUT") regimeScore = techBias > 0 ? 0.4 : -0.4;
    else if (regime.regime === "POTENTIAL_REVERSAL") regimeScore = -Math.sign(techBias) * 0.3;
  }

  // session: killzone displacement tendencies
  const activeKz = sessions.find((s) => s.isOpen && (s.short === "LONDON_KZ" || s.short === "NY_KZ"));
  const sessionName = activeKz ? activeKz.name : sessions.find((s) => s.isOpen)?.name ?? "Closed";
  const sessionScore = activeKz ? Math.sign(of) * 0.3 : 0;

  const newsScore = clamp(newsSentiment * 2, -1, 1);

  const composite =
    techBias * W.technical + fundBias * W.fundamental + mtf * W.mtf + liq * W.liquidity +
    of * W.orderFlow + regimeScore * W.regime + sessionScore * W.session + newsScore * W.news;

  const confluenceScore = Math.round(clamp(composite, -1, 1) * 100);

  // agreement detection
  const votes: [string, number][] = [
    ["Technical", techBias], ["Fundamental", fundBias], ["MTF structure", mtf],
    ["Liquidity draw", liq], ["Order flow", of], ["Regime", regimeScore], ["News", newsScore],
  ];
  const bullVotes = votes.filter(([, v]) => v > 0.15).length;
  const bearVotes = votes.filter(([, v]) => v < -0.15).length;
  const supporting = votes.filter(([, v]) => v > 0.15).map(([n, v]) => `${n} supports bullish (${v >= 0 ? "+" : ""}${v.toFixed(2)})`);
  const conflicting = votes.filter(([, v]) => v < -0.15).map(([n, v]) => `${n} supports bearish (${v.toFixed(2)})`);

  let overallBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  if (confluenceScore >= 20 && bullVotes >= bearVotes + 2) overallBias = "BULLISH";
  else if (confluenceScore <= -20 && bearVotes >= bullVotes + 2) overallBias = "BEARISH";
  else if (confluenceScore >= 35) overallBias = "BULLISH";
  else if (confluenceScore <= -35) overallBias = "BEARISH";
  else overallBias = "NEUTRAL";

  // probabilities from composite
  const pBullRaw = 1 / (1 + Math.exp(-composite * 2.4));
  const neutralW = Math.abs(composite) < 0.12 ? 0.45 : 0.12;
  let pBull = pBullRaw * (1 - neutralW);
  let pBear = (1 - pBullRaw) * (1 - neutralW);
  if (fundamental && technical) {
    // penalize confidence when engines disagree strongly
    const disagreement = Math.abs(techBias - fundBias);
    if (disagreement > 1.0) {
      pBull = pBull * 0.8 + 0.1;
      pBear = pBear * 0.8 + 0.1;
    }
  }
  const norm = pBull + pBear + neutralW;

  // volatility & risk text
  const volText = volatility
    ? `${volatility.regime} — ADR ${volatility.adr} (${volatility.adrPct}%), ${volatility.rangeConsumedPct}% consumed, HV percentile ${volatility.hvPercentile}%`
    : "Volatility data unavailable";

  const keyRisks: string[] = [];
  if (volatility?.expansion) keyRisks.push("Volatility expanding — stop distances must widen, expect overshoots through levels");
  if (regime?.regime === "HIGH_VOLATILITY") keyRisks.push("High-volatility regime — intrabar sweeps of both sides are common");
  if (regime?.regime === "BREAKOUT") keyRisks.push("Breakout regime — false breaks are frequent without displacement confirmation");
  if (fundamental && fundamental.probNeutral > 0.3) keyRisks.push("Fundamental picture inconclusive — event risk dominates");
  if (regime?.transitions.length) keyRisks.push(...regime.transitions.slice(0, 2));

  const invalidation = overallBias === "BULLISH"
    ? `Bias invalidated by a confirmed break below ${liquidity?.nearestSsl?.price?.toFixed(2) ?? structures[0]?.rangeLow.toFixed(2) ?? "recent structural low"} or a bearish MSS on the analysis timeframe.`
    : overallBias === "BEARISH"
      ? `Bias invalidated by a confirmed break above ${liquidity?.nearestBsl?.price?.toFixed(2) ?? structures[0]?.rangeHigh.toFixed(2) ?? "recent structural high"} or a bullish MSS on the analysis timeframe.`
      : "No directional bias — invalidation applies to range edges instead.";

  return {
    overallBias,
    probBull: +(pBull / norm).toFixed(3),
    probBear: +(pBear / norm).toFixed(3),
    probNeutral: +(neutralW / norm).toFixed(3),
    confluenceScore,
    confidence: +clamp(0.3 + Math.abs(composite) * 0.9 + (bullVotes >= 5 || bearVotes >= 5 ? 0.1 : 0), 0.2, 0.92).toFixed(2),
    fundamentalBias: fundamental ? `${fundamental.direction} (bull ${Math.round(fundamental.probBull * 100)}% / bear ${Math.round(fundamental.probBear * 100)}%)` : "unavailable",
    technicalBias: technical ? `${technical.direction} (bull ${Math.round(technical.probBull * 100)}% / bear ${Math.round(technical.probBear * 100)}%)` : "unavailable",
    mtfAlignment: structures.map((s) => `${s.timeframe}:${s.trend[0]}${s.zone === "PREMIUM" ? "▲p" : s.zone === "DISCOUNT" ? "▽d" : "=e"}`).join("  ") || "unavailable",
    liquidityCondition,
    orderFlow: orderFlow ? `Buyer ${orderFlow.buyerPct}% / Seller ${orderFlow.sellerPct}% (OHLCV proxy)${orderFlow.aggressiveBuying ? " — aggressive buying" : orderFlow.aggressiveSelling ? " — aggressive selling" : ""}` : "unavailable",
    volatility: volText,
    newsSentiment: `${newsSentiment >= 0.15 ? "Bullish-leaning" : newsSentiment <= -0.15 ? "Bearish-leaning" : "Neutral"} (${newsSentiment.toFixed(2)})`,
    regime: regime ? `${regime.regime.replace(/_/g, " ")} (confidence ${(regime.confidence * 100).toFixed(0)}%)` : "unavailable",
    session: sessionName,
    keyLiquidityTarget: liquidity?.likelyTarget
      ? { label: liquidity.likelyTarget.label, price: liquidity.likelyTarget.price, side: liquidity.likelyTarget.side }
      : null,
    majorSupport: structures[0]?.support[0] ?? null,
    majorResistance: structures[0]?.resistance[0] ?? null,
    reversalZone: liquidity?.potentialReversalZone ?? null,
    keyRisks: keyRisks.length ? keyRisks : ["Standard two-way risk around data releases"],
    invalidation,
    supporting: supporting.length ? supporting : ["No component currently exceeds the bullish evidence threshold"],
    conflicting: conflicting.length ? conflicting : ["No component currently exceeds the bearish evidence threshold"],
    timestamp: new Date().toISOString(),
  };
}
