/**
 * Grounded Institutional Market Intelligence Engine.
 *
 * Provides deterministic, analytical, institutional-grade responses for the
 * AI Trading Assistant based entirely on live computed market snapshot data.
 * Used whenever external LLM API keys are not present or external services are unreachable.
 */
import type { FullAnalysis } from "./compute";
import type { ConfluenceOutput, Instrument, SetupScanResult } from "../engines/types";

export interface GroundedSnapshot {
  meta: {
    instrument: Instrument;
    snapshotTime: string;
    note: string;
  };
  quote: { price: number; status: string; source: string; asOf: string } | null;
  structure: Record<string, {
    trend: string;
    lastEvent: string | null;
    zone: string;
    range: [number, number];
    labels: [string | null, string | null];
    support: number[];
    resistance: number[];
  }> | null;
  mtf: string | null;
  ict: {
    activeFvgs: string[];
    orderBlocks: string[];
    recentSweeps: string[];
    quasimodo: string | null;
    ote: string | null;
    displacement: string | null;
  } | null;
  liquidity: {
    basis: string;
    nearestBsl: string | null;
    nearestSsl: string | null;
    likelyTarget: string | null;
  } | null;
  sessions: {
    active: string;
    open: string[];
    ranges: string[];
  } | null;
  volatility: {
    adr: number;
    adrPct: number;
    todayRange: number;
    consumedPct: number;
    regime: string;
    hvPercentile: number;
    atr: number;
  } | null;
  orderFlow: {
    buyerPct: number;
    sellerPct: number;
    cvd: number;
    dataBasis: string;
    divergence: string;
    absorption: string | null;
  } | null;
  regime: {
    regime: string;
    confidence: number;
    topEvidence: string[];
  } | null;
  confluence: {
    overallBias: string;
    score: number;
    probBull: number;
    probBear: number;
    top: string[];
    against: string[];
    invalidation: string | number;
  } | null;
  setups: {
    count: number;
    noSetupReasons: string[];
    top: {
      dir: string;
      type: string;
      entry: [number, number];
      sl: number;
      tps: number[];
      rr: number;
      quality: number;
    } | null;
  } | null;
  news: {
    sentiment: string;
    top: string[];
  };
  calendar: string[];
  journal: {
    entries: number;
    winRate: number | null;
  };
}

function formatInvalidation(inv: string | number | undefined | null): string {
  if (inv == null) return "N/A";
  if (typeof inv === "number") return `$${inv.toFixed(2)}`;
  return String(inv);
}

export function generateGroundedResponse(
  message: string,
  snapshot: GroundedSnapshot,
  fullAnalysis?: FullAnalysis | null,
  rawConfluence?: ConfluenceOutput | null,
  rawSetups?: SetupScanResult | null,
): string {
  const q = message.trim().toLowerCase();
  const inst = snapshot.meta.instrument;
  const price = snapshot.quote?.price != null ? `$${snapshot.quote.price.toFixed(2)}` : "N/A";
  const time = snapshot.meta.snapshotTime;
  const status = snapshot.quote?.status ?? "LIVE";

  // 1. Fair Value Gap (FVG) Questions
  if (q.includes("fvg") || q.includes("fair value") || q.includes("imbalance")) {
    const rawFvgs = fullAnalysis?.ict?.fvg?.filter((f) => !f.filled) ?? [];
    const activeSummary = snapshot.ict?.activeFvgs ?? [];

    if (rawFvgs.length > 0) {
      const bullish = rawFvgs.filter((f) => f.direction === "BULLISH");
      const bearish = rawFvgs.filter((f) => f.direction === "BEARISH");

      const lines: string[] = [];
      lines.push(`### ⚡ Fair Value Gap (FVG) Analysis — ${inst}`);
      lines.push(`*Snapshot As Of: \`${time}\` | Current Price: **${price}** (${status})*\n`);
      lines.push(`**Active Unmitigated Imbalances (${rawFvgs.length} detected):**`);

      if (bullish.length > 0) {
        lines.push(`\n**Bullish FVGs (Support / Demand):**`);
        for (const f of bullish.slice(-3)) {
          const dist = snapshot.quote?.price ? (snapshot.quote.price - f.top).toFixed(2) : null;
          const distStr = dist ? ` — *${+dist > 0 ? `${dist} pts below price` : "price inside/testing"}*` : "";
          lines.push(`- 🟢 **$${f.bottom.toFixed(2)} – $${f.top.toFixed(2)}** (Span: $${f.size.toFixed(2)})${distStr}${f.displacement ? " [Displacement]" : ""}`);
        }
      }

      if (bearish.length > 0) {
        lines.push(`\n**Bearish FVGs (Resistance / Supply):**`);
        for (const f of bearish.slice(-3)) {
          const dist = snapshot.quote?.price ? (f.bottom - snapshot.quote.price).toFixed(2) : null;
          const distStr = dist ? ` — *${+dist > 0 ? `${dist} pts above price` : "price inside/testing"}*` : "";
          lines.push(`- 🔴 **$${f.bottom.toFixed(2)} – $${f.top.toFixed(2)}** (Span: $${f.size.toFixed(2)})${distStr}${f.displacement ? " [Displacement]" : ""}`);
        }
      }

      lines.push(`\n**Execution Takeaway:**`);
      if (snapshot.confluence?.overallBias === "BULLISH" && bullish.length > 0) {
        lines.push(`Current bias is **BULLISH** (+${snapshot.confluence.score}). Look for price to tap the bullish FVG at **$${bullish[bullish.length - 1].bottom.toFixed(2)}–$${bullish[bullish.length - 1].top.toFixed(2)}** for potential long entries toward overhead liquidity.`);
      } else if (snapshot.confluence?.overallBias === "BEARISH" && bearish.length > 0) {
        lines.push(`Current bias is **BEARISH** (${snapshot.confluence.score}). Look for mitigation into the bearish FVG at **$${bearish[bearish.length - 1].bottom.toFixed(2)}–$${bearish[bearish.length - 1].top.toFixed(2)}** for potential short continuity.`);
      } else {
        lines.push(`Price is navigating between active imbalance boundaries. Monitor reaction and displacement upon retesting either zone.`);
      }

      return lines.join("\n");
    } else if (activeSummary.length > 0) {
      return [
        `### ⚡ Fair Value Gap (FVG) Analysis — ${inst}`,
        `*Snapshot As Of: \`${time}\` | Current Price: **${price}** (${status})*\n`,
        `**Active Unmitigated Imbalances:**`,
        ...activeSummary.map((fvg) => `- 🔹 **${fvg}**`),
        `\nAll other prior imbalances have been mitigated/rebalanced by subsequent candle wicks or bodies.`,
      ].join("\n");
    } else {
      return [
        `### ⚡ Fair Value Gap (FVG) Analysis — ${inst}`,
        `*Snapshot As Of: \`${time}\` | Current Price: **${price}** (${status})*\n`,
        `**Status:** There are **no active, unmitigated FVGs** on the current primary 15m timeframe.`,
        `- Prior imbalances have been completely filled/rebalanced.`,
        snapshot.ict?.orderBlocks?.[0] ? `- Nearest structural zone: Order Block at **${snapshot.ict.orderBlocks[0]}**.` : "",
        snapshot.liquidity?.likelyTarget ? `- Liquidity draw remains: **${snapshot.liquidity.likelyTarget}**.` : "",
      ].filter(Boolean).join("\n");
    }
  }

  // 2. Bias / Confluence Questions
  if (q.includes("bias") || (q.includes("trend") && !q.includes("4h") && !q.includes("15m") && !q.includes("structure"))) {
    const c = snapshot.confluence;
    const bias = c?.overallBias ?? "NEUTRAL";
    const score = c?.score ?? 0;
    const icon = bias === "BULLISH" ? "🟢" : bias === "BEARISH" ? "🔴" : "⚪";

    return [
      `### ${icon} Institutional Bias Analysis — ${inst}`,
      `*Snapshot As Of: \`${time}\` | Current Price: **${price}** (${status})*\n`,
      `**Overall Bias:** **${bias}** (Score: \`${score > 0 ? `+${score}` : score}\` / 100)`,
      `**Model Probabilities:** Bullish **${c ? Math.round(c.probBull * 100) : 33}%** | Neutral **${c ? Math.round((1 - c.probBull - c.probBear) * 100) : 34}%** | Bearish **${c ? Math.round(c.probBear * 100) : 33}%**\n`,
      `**Multi-Timeframe Alignment:**`,
      `- 15m: ${snapshot.structure?.["15m"]?.trend ?? "RANGE"} (${snapshot.structure?.["15m"]?.zone ?? "EQUILIBRIUM"})`,
      `- 1H: ${snapshot.structure?.["1h"]?.trend ?? "RANGE"} (${snapshot.structure?.["1h"]?.zone ?? "EQUILIBRIUM"})`,
      `- 4H: ${snapshot.structure?.["4h"]?.trend ?? "RANGE"} (${snapshot.structure?.["4h"]?.zone ?? "EQUILIBRIUM"})`,
      `- 1D: ${snapshot.structure?.["1d"]?.trend ?? "RANGE"} (${snapshot.structure?.["1d"]?.zone ?? "EQUILIBRIUM"})\n`,
      `**Primary Supporting Factors:**`,
      ...(c?.top && c.top.length > 0 ? c.top.map((s) => `- ✅ ${s}`) : ["- Alignment across momentum and volume"]),
      `\n**Headwinds / Conflicting Factors:**`,
      ...(c?.against && c.against.length > 0 ? c.against.map((a) => `- ⚠️ ${a}`) : ["- None significant"]),
      `\n**Invalidation Level:** **${formatInvalidation(c?.invalidation)}** *(a clean break beyond this level invalidates the setup)*.`,
    ].join("\n");
  }

  // 3. Market Structure Questions (4H / 15m / Swings / MSS / BOS)
  if (q.includes("structure") || q.includes("4h") || q.includes("mss") || q.includes("choch") || q.includes("bos")) {
    const tf = q.includes("15m") ? "15m" : q.includes("1h") ? "1h" : q.includes("1d") ? "1d" : "4h";
    const st = snapshot.structure?.[tf] ?? snapshot.structure?.["4h"] ?? snapshot.structure?.["15m"];

    return [
      `### 🏛️ Market Structure Report (${tf.toUpperCase()}) — ${inst}`,
      `*Snapshot As Of: \`${time}\` | Current Price: **${price}** (${status})*\n`,
      `**Trend State:** **${st?.trend ?? "RANGE"}**`,
      `**Dealing Range Pricing:** **${st?.zone ?? "EQUILIBRIUM"}**`,
      `- Range High: **$${st?.range[1] ? st.range[1].toFixed(2) : "N/A"}**`,
      `- Range Low: **$${st?.range[0] ? st.range[0].toFixed(2) : "N/A"}**`,
      `- Equilibrium (50%): **$${st ? ((st.range[0] + st.range[1]) / 2).toFixed(2) : "N/A"}**\n`,
      `**Last Confirmed Event:** ${st?.lastEvent ? `\`${st.lastEvent}\`` : "No recent break of structure"}`,
      st?.labels ? `**Recent Swings:** High: \`${st.labels[0] ?? "N/A"}\` | Low: \`${st.labels[1] ?? "N/A"}\`` : "",
      `\n**Key Swing Levels:**`,
      `- Support: ${st?.support?.length ? st.support.map((s) => `$${s.toFixed(2)}`).join(", ") : "N/A"}`,
      `- Resistance: ${st?.resistance?.length ? st.resistance.map((r) => `$${r.toFixed(2)}`).join(", ") : "N/A"}`,
      snapshot.ict?.quasimodo ? `\n**Quasimodo Pattern:** \`${snapshot.ict.quasimodo}\`` : "",
      snapshot.ict?.displacement ? `**Displacement:** \`${snapshot.ict.displacement}\`` : "",
    ].filter(Boolean).join("\n");
  }

  // 4. Liquidity Questions (BSL / SSL / Pools / Draws)
  if (q.includes("liquidity") || q.includes("bsl") || q.includes("ssl") || q.includes("draw") || q.includes("stop")) {
    const liq = snapshot.liquidity;
    return [
      `### 🎯 Institutional Liquidity Draw — ${inst}`,
      `*Snapshot As Of: \`${time}\` | Current Price: **${price}** (${status})*\n`,
      `**Primary Liquidity Target (Draw):**`,
      `- 🏹 **${liq?.likelyTarget ?? "In range consolidation"}**\n`,
      `**Nearest External Liquidity Pools:**`,
      `- 🟢 **Buy-Side Liquidity (BSL):** ${liq?.nearestBsl ? `**$${liq.nearestBsl}**` : "None nearby"}`,
      `- 🔴 **Sell-Side Liquidity (SSL):** ${liq?.nearestSsl ? `**$${liq.nearestSsl}**` : "None nearby"}\n`,
      snapshot.ict?.recentSweeps?.length ? `**Recent Liquidity Sweeps:**\n${snapshot.ict.recentSweeps.map((s) => `- ⚡ ${s}`).join("\n")}\n` : "",
      `> ℹ️ **Grounding Note:** Liquidity pools are **inferred algorithmically from structural swing highs and lows**; they do not represent real exchange limit-order book depth.`,
    ].filter(Boolean).join("\n");
  }

  // 5. Order Flow & Buyer/Seller Ratio Questions
  if (q.includes("buyer") || q.includes("seller") || q.includes("order flow") || q.includes("cvd") || q.includes("ratio") || q.includes("volume")) {
    const of = snapshot.orderFlow;
    return [
      `### 📊 Order Flow & Volume Delta — ${inst}`,
      `*Snapshot As Of: \`${time}\` | Current Price: **${price}** (${status})*\n`,
      `**Buyer vs Seller Ratio:**`,
      `- 🟢 **Buyers:** **${of?.buyerPct ?? 50}%**`,
      `- 🔴 **Sellers:** **${of?.sellerPct ?? 50}%**\n`,
      `**CVD (Cumulative Volume Delta):** \`${of?.cvd != null ? (of.cvd > 0 ? `+${of.cvd}` : of.cvd) : "0"}\``,
      `**Divergence Analysis:** \`${of?.divergence ?? "NONE"}\``,
      of?.absorption ? `**Volume Absorption:** \`${of.absorption}\`` : "",
      `\n> ℹ️ **Grounding Note:** Order-flow calculations are computed via an **institutional OHLCV tick-volume proxy**; true exchange depth is not available on OTC spot.`,
    ].filter(Boolean).join("\n");
  }

  // 6. News & Economic Calendar Questions
  if (q.includes("news") || q.includes("calendar") || q.includes("cpi") || q.includes("fomc") || q.includes("nfp") || q.includes("event")) {
    return [
      `### 📅 Macroeconomic Calendar & News Sentiment — ${inst}`,
      `*Snapshot As Of: \`${time}\` | Current Price: **${price}** (${status})*\n`,
      `**Macro News Sentiment:** **${snapshot.news.sentiment}**\n`,
      `**Upcoming High-Impact Events:**`,
      ...(snapshot.calendar.length > 0
        ? snapshot.calendar.map((e) => `- ⏱️ ${e}`)
        : ["- No major tier-1 macroeconomic events scheduled in the next 12 hours."]),
      `\n**Recent Market Headlines:**`,
      ...(snapshot.news.top.length > 0
        ? snapshot.news.top.map((h) => `- 📰 ${h}`)
        : ["- Market trading under normal institutional flow."]),
    ].join("\n");
  }

  // 7. Trade Setups / 1:3 Setups Questions
  if (q.includes("setup") || q.includes("1:3") || q.includes("trade") || q.includes("entry") || q.includes("signal")) {
    const s = snapshot.setups;
    const top = s?.top;

    if (top) {
      return [
        `### 🎯 Valid 1:3 Trade Setup — ${inst}`,
        `*Snapshot As Of: \`${time}\` | Current Price: **${price}** (${status})*\n`,
        `**Setup Direction:** **${top.dir}** (${top.type})`,
        `**Quality Score:** \`${top.quality}/100\` | **Risk-Reward:** \`1:${top.rr.toFixed(1)}\`\n`,
        `**Execution Parameters:**`,
        `- **Entry Zone:** $${top.entry[0].toFixed(2)} – $${top.entry[1].toFixed(2)}`,
        `- **Stop Loss (SL):** $${top.sl.toFixed(2)}`,
        `- **Take Profit 1 (TP1):** $${top.tps[0]?.toFixed(2) ?? "N/A"}`,
        `- **Take Profit 2 (TP2):** $${top.tps[1]?.toFixed(2) ?? "N/A"}`,
        top.tps[2] ? `- **Take Profit 3 (TP3):** $${top.tps[2].toFixed(2)}` : "",
        `\n> ⚠️ *Risk Notice: Analytical estimate grounded in live confluence. Maintain strict risk management (1% max risk).*`,
      ].filter(Boolean).join("\n");
    } else {
      return [
        `### 🎯 Trade Setup Scanner — ${inst}`,
        `*Snapshot As Of: \`${time}\` | Current Price: **${price}** (${status})*\n`,
        `**Current Status:** **0 active 1:3 trade setups meet institutional qualification criteria.**\n`,
        `**Disqualification Filters Triggered:**`,
        ...(s?.noSetupReasons && s.noSetupReasons.length > 0
          ? s.noSetupReasons.map((r) => `- ❌ ${r}`)
          : ["- Insufficient confluence score", "- Risk-reward below 1:3 threshold"]),
        `\n**Patience Required:** The engine will issue a setup once price retests a high-probability ICT discount/premium zone with confirmed displacement.`,
      ].join("\n");
    }
  }

  // 8. Why is Gold moving / Catalysts Questions
  if (q.includes("why") || q.includes("moving") || q.includes("catalyst") || q.includes("driver")) {
    const sess = snapshot.sessions;
    const vol = snapshot.volatility;
    const of = snapshot.orderFlow;

    return [
      `### ⚡ Market Drivers & Dynamics — ${inst}`,
      `*Snapshot As Of: \`${time}\` | Current Price: **${price}** (${status})*\n`,
      `**Active Session:** **${sess?.active ?? "Inter-session"}** (Open sessions: ${sess?.open.join(", ") ?? "None"})`,
      `**Volatility & Range:**`,
      `- Today's Range: **$${vol?.todayRange.toFixed(2) ?? "0"}** (${vol?.consumedPct.toFixed(0) ?? "0"}% of ${vol?.adr.toFixed(1) ?? "0"} ADR consumed)`,
      `- Volatility Regime: **${vol?.regime ?? "NORMAL"}** (HV Percentile: ${vol?.hvPercentile ?? 50}%)\n`,
      `**Order Flow Driver:** ${of?.buyerPct ?? 50}% Buyers vs ${of?.sellerPct ?? 50}% Sellers (CVD: ${of?.cvd ?? 0})`,
      `**Macro Sentiment:** ${snapshot.news.sentiment}`,
      snapshot.liquidity?.likelyTarget ? `**Liquidity Draw:** ${snapshot.liquidity.likelyTarget}` : "",
    ].filter(Boolean).join("\n");
  }

  // 9. Invalidation Questions
  if (q.includes("invalida") || q.includes("risk") || q.includes("fail")) {
    const c = snapshot.confluence;
    return [
      `### 🛡️ Bias Invalidation Matrix — ${inst}`,
      `*Snapshot As Of: \`${time}\` | Current Price: **${price}** (${status})*\n`,
      `**Current Bias:** **${c?.overallBias ?? "NEUTRAL"}**`,
      `**Primary Invalidation Level:** **${formatInvalidation(c?.invalidation)}**\n`,
      `**What Invalidates the Current Thesis:**`,
      `- A candle close beyond **${formatInvalidation(c?.invalidation)}** on the 15m or 1H timeframe.`,
      `- A shift in institutional volume delta (CVD flip against the bias).`,
      snapshot.liquidity?.nearestBsl && c?.overallBias === "BEARISH" ? `- Sweep and acceptance above BSL at $${snapshot.liquidity.nearestBsl}.` : "",
      snapshot.liquidity?.nearestSsl && c?.overallBias === "BULLISH" ? `- Sweep and acceptance below SSL at $${snapshot.liquidity.nearestSsl}.` : "",
    ].filter(Boolean).join("\n");
  }

  // 10. Default / Comprehensive Market Briefing
  return [
    `### 🌐 Institutional Market Briefing — ${inst}`,
    `*Snapshot As Of: \`${time}\` | Current Price: **${price}** (${status})*\n`,
    `**1. Technical Bias & Confluence:**`,
    `- Bias: **${snapshot.confluence?.overallBias ?? "NEUTRAL"}** (Score: \`${snapshot.confluence?.score ?? 0}\` / 100)`,
    `- Invalidation: **${formatInvalidation(snapshot.confluence?.invalidation)}**\n`,
    `**2. ICT / SMC Key Zones:**`,
    `- Active FVGs: ${snapshot.ict?.activeFvgs.length ? snapshot.ict.activeFvgs.join(", ") : "None unmitigated on 15m"}`,
    `- Order Blocks: ${snapshot.ict?.orderBlocks.length ? snapshot.ict.orderBlocks.join(", ") : "None immediate"}`,
    `- Liquidity Draw: ${snapshot.liquidity?.likelyTarget ?? "Consolidation within range"}\n`,
    `**3. Market Structure & Session:**`,
    `- 4H Trend: **${snapshot.structure?.["4h"]?.trend ?? "RANGE"}** (${snapshot.structure?.["4h"]?.zone ?? "EQUILIBRIUM"})`,
    `- Active Session: **${snapshot.sessions?.active ?? "Inter-session"}** | ADR Consumed: **${snapshot.volatility?.consumedPct.toFixed(0) ?? "0"}%**\n`,
    `**4. Order Flow & Macro:**`,
    `- Buyers **${snapshot.orderFlow?.buyerPct ?? 50}%** / Sellers **${snapshot.orderFlow?.sellerPct ?? 50}%** (CVD: ${snapshot.orderFlow?.cvd ?? 0})`,
    `- News Sentiment: **${snapshot.news.sentiment}**`,
  ].join("\n");
}
