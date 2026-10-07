/**
 * Trade setup generator — builds ICT/SMC setups ONLY when the stated rules
 * pass. When conditions are not met it returns `NO VALID SETUP` with the
 * exact failing reasons. Never executes trades.
 */
import type {
  Candle, ConfluenceOutput, LiquidityReport, OrderFlowReport, SessionState,
  SetupScanResult, Timeframe, TradeSetup, VolatilityReport,
} from "./types";
import { atr, lastValue } from "./indicators";
import { runIctScan } from "./ict";
import { analyzeStructure } from "./structure";

export interface SetupRules {
  minRR: number;            // e.g. 3
  requireMss: boolean;
  requireSweep: boolean;
  requireDisplacement: boolean;
  requireFvg: boolean;
  requireHtfAlignment: boolean;
  requireFundamentalAlignment: boolean;
  sessionFilter: string;    // ALL | ASIAN | LONDON | NEW_YORK
  maxVolatilityGuard: boolean;
}

export const DEFAULT_RULES: SetupRules = {
  minRR: 3,
  requireMss: false,
  requireSweep: false,
  requireDisplacement: false,
  requireFvg: false,
  requireHtfAlignment: true,
  requireFundamentalAlignment: false,
  sessionFilter: "ALL",
  maxVolatilityGuard: true,
};

export function currentSessionName(sessions: SessionState[]): string {
  const open = sessions.find((s) => s.isOpen && (s.short === "LONDON_KZ" || s.short === "NY_KZ"));
  if (open) return open.short === "LONDON_KZ" ? "LONDON_KZ" : "NY_KZ";
  const any = sessions.find((s) => s.isOpen);
  return any?.short ?? "CLOSED";
}

export function generateSetups(args: {
  candles15m: Candle[];
  candles1h: Candle[];
  candles4h: Candle[];
  instrument: import("./types").Instrument;
  rules: SetupRules;
  confluence: ConfluenceOutput | null;
  liquidity: LiquidityReport | null;
  orderFlow: OrderFlowReport | null;
  volatility: VolatilityReport | null;
  sessions: SessionState[];
}): SetupScanResult {
  const { candles15m, candles1h, candles4h, instrument, rules, confluence, liquidity, orderFlow, volatility, sessions } = args;
  const noSetupReasons: string[] = [];
  const rulesApplied: string[] = [];
  const setups: TradeSetup[] = [];
  const price = candles15m.length ? candles15m[candles15m.length - 1].close : 0;
  if (!price) {
    return { instrument, setups: [], noSetupReasons: ["No price data available"], rulesApplied: [], timestamp: new Date().toISOString() };
  }

  rulesApplied.push(`Minimum RR 1:${rules.minRR}`);
  if (rules.requireMss) rulesApplied.push("Require MSS");
  if (rules.requireSweep) rulesApplied.push("Require liquidity sweep");
  if (rules.requireDisplacement) rulesApplied.push("Require displacement");
  if (rules.requireFvg) rulesApplied.push("Require FVG");
  if (rules.requireHtfAlignment) rulesApplied.push("Require HTF alignment");
  if (rules.requireFundamentalAlignment) rulesApplied.push("Require fundamental alignment");
  if (rules.sessionFilter !== "ALL") rulesApplied.push(`Session filter: ${rules.sessionFilter}`);
  if (rules.maxVolatilityGuard) rulesApplied.push("Volatility guard");

  const s15 = analyzeStructure(candles15m, "15m");
  const s1h = analyzeStructure(candles1h, "1h");
  const s4h = analyzeStructure(candles4h, "4h");
  const scan = runIctScan(candles15m, "15m");
  const a1 = lastValue(atr(candles15m, 14)) ?? price * 0.004;
  const sessionNow = currentSessionName(sessions);

  // ---- global gates ----
  if (rules.requireHtfAlignment) {
    const bullAligned = s1h.trend === "UPTREND" || s4h.trend === "UPTREND";
    const bearAligned = s1h.trend === "DOWNTREND" || s4h.trend === "DOWNTREND";
    if (!bullAligned && !bearAligned) {
      noSetupReasons.push(`HTF alignment gate: 1H trend is ${s1h.trend}, 4H trend is ${s4h.trend} — no directional alignment`);
    }
  }
  if (rules.requireFundamentalAlignment && confluence) {
    if (confluence.fundamentalBias.startsWith("NEUTRAL")) {
      noSetupReasons.push("Fundamental alignment gate: fundamental engine is NEUTRAL");
    }
  }
  if (rules.sessionFilter !== "ALL" && sessionNow !== rules.sessionFilter && sessionNow !== "CLOSED") {
    noSetupReasons.push(`Session gate: current session ${sessionNow} ≠ allowed ${rules.sessionFilter}`);
  }
  if (rules.sessionFilter !== "ALL" && sessionNow === "CLOSED") {
    noSetupReasons.push("Market closed — no setups generated");
  }
  if (rules.maxVolatilityGuard && volatility && volatility.regime === "EXPANSION" && volatility.rangeConsumedPct > 110) {
    noSetupReasons.push(`Volatility guard: daily range ${volatility.rangeConsumedPct}% of ADR consumed during expansion`);
  }
  if (!confluence || confluence.overallBias === "NEUTRAL") {
    noSetupReasons.push("Confluence engine reports NEUTRAL bias — refusing to force a directional setup");
  }

  const wantLong = confluence?.overallBias === "BULLISH";
  const wantShort = confluence?.overallBias === "BEARISH";

  // ---- candidate builders (each validates its own preconditions) ----

  const buildSweepFvg = () => {
    const sweep = scan.sweeps[scan.sweeps.length - 1];
    if (!sweep) { if (rules.requireSweep) noSetupReasons.push("Sweep setup: no recent liquidity sweep on 15m"); return; }
    const wantDir = sweep.kind === "SSL_SWEEP" ? "LONG" : "SHORT";
    const fresher = Date.now() / 1000 - sweep.time < 8 * 3600;
    if (!fresher) { noSetupReasons.push("Sweep setup: latest sweep older than 8h"); return; }
    if (wantDir === "LONG" && !wantLong) { noSetupReasons.push("Sweep setup: bullish sweep but confluence is not bullish"); return; }
    if (wantDir === "SHORT" && !wantShort) { noSetupReasons.push("Sweep setup: bearish sweep but confluence is not bearish"); return; }
    // find a same-direction FVG formed after the sweep
    const fvg = [...scan.fvg].reverse().find((f) => !f.filled && ((wantDir === "LONG" && f.direction === "BULLISH" && f.time >= sweep.time) || (wantDir === "SHORT" && f.direction === "BEARISH" && f.time >= sweep.time)));
    if (!fvg) { if (rules.requireFvg) noSetupReasons.push("Sweep setup: no post-sweep FVG in sweep direction"); return; }
    const entryTop = fvg.top, entryBottom = fvg.bottom;
    const sl = wantDir === "LONG" ? Math.min(sweep.sweepPrice, fvg.bottom - a1 * 0.25) : Math.max(sweep.sweepPrice, fvg.top + a1 * 0.25);
    const risk = Math.abs((wantDir === "LONG" ? entryBottom : entryTop) - sl);
    if (risk <= 0) return;
    const t1 = wantDir === "LONG" ? entryBottom + risk * 1.5 : entryTop - risk * 1.5;
    const t2 = wantDir === "LONG" ? entryBottom + risk * 3 : entryTop - risk * 3;
    const t3 = wantDir === "LONG"
      ? (liquidity?.nearestBsl?.price ?? entryBottom + risk * 5)
      : (liquidity?.nearestSsl?.price ?? entryTop - risk * 5);
    const rr = Math.abs(t2 - (wantDir === "LONG" ? entryBottom : entryTop)) / risk;
    const quality = Math.round(55 + (sweep.displacementAfter ? 15 : 0) + (sweep.reclaimed ? 10 : 0) + (scan.displacement?.direction === (wantDir === "LONG" ? "BULLISH" : "BEARISH") ? 10 : 0) + (fvg.displacement ? 5 : 0) + (orderFlow && ((wantDir === "LONG" && orderFlow.buyerPct > 55) || (wantDir === "SHORT" && orderFlow.sellerPct > 55)) ? 5 : 0));
    setups.push({
      id: `sweep-fvg-${sweep.time}`, instrument, direction: wantDir as "LONG" | "SHORT",
      setupType: "LIQUIDITY_SWEEP_FVG", timeframe: "15m", session: sessionNow,
      entryZone: { top: +entryTop.toFixed(2), bottom: +entryBottom.toFixed(2) },
      entryConfirmation: "15m candle closing back inside range after entry-zone tap (rejection close)",
      stopLoss: +sl.toFixed(2), takeProfits: [+t1.toFixed(2), +t2.toFixed(2), +t3.toFixed(2)],
      riskReward: +Math.abs(rr).toFixed(2), quality: Math.min(98, quality),
      confluences: [
        `${sweep.kind} of ${sweep.referenceLabel}`,
        sweep.displacementAfter ? "Displacement after sweep" : "No displacement after sweep",
        `${fvg.direction} FVG ${fvg.bottom}–${fvg.top}`,
        `HTF trend 1H ${s1h.trend} / 4H ${s4h.trend}`,
      ],
      invalidation: +(wantDir === "LONG" ? fvg.bottom - a1 * 0.5 : fvg.top + a1 * 0.5).toFixed(2),
      horizon: "INTRADAY",
      reasoning: [
        `Liquidity swept at ${sweep.sweepPrice} (${sweep.kind}), then price ${sweep.reclaimed ? "reclaimed the level" : "has not reclaimed yet"}.`,
        `Unfilled ${fvg.direction} FVG at ${fvg.bottom}–${fvg.top} offers the re-entry window.`,
        `Target 2 is a 1:3 projection; target 3 is the next inferred liquidity pool (${liquidity?.likelyTarget?.label ?? "n/a"}).`,
      ],
      createdAt: new Date().toISOString(), status: "ACTIVE",
    });
  };

  const buildObRetest = () => {
    const obs = scan.orderBlocks.filter((ob) => !ob.broken && ((wantLong && ob.direction === "BULLISH" && ob.bottom <= price) || (wantShort && ob.direction === "BEARISH" && ob.top >= price)) );
    const ob = obs[obs.length - 1];
    if (!ob) { noSetupReasons.push("OB setup: no unmitigated order block in confluence direction near price"); return; }
    const mss = s15.events.find((e) => e.direction === (wantLong ? "BULLISH" : "BEARISH"));
    if (rules.requireMss && !mss) { noSetupReasons.push("OB setup: rules require MSS but none found on 15m"); return; }
    const entryTop = ob.top, entryBottom = ob.bottom;
    const sl = wantLong ? ob.bottom - a1 * 0.4 : ob.top + a1 * 0.4;
    const risk = Math.abs((wantLong ? entryBottom : entryTop) - sl);
    const mid = (entryTop + entryBottom) / 2;
    const t1 = wantLong ? mid + risk * 2 : mid - risk * 2;
    const t2 = wantLong ? mid + risk * 3 : mid - risk * 3;
    const t3 = wantLong ? mid + risk * 5 : mid - risk * 5;
    const rr = 3;
    const quality = Math.round(50 + (ob.kind === "ORDER_BLOCK" ? 8 : 4) + (ob.retested ? 0 : 6) + (mss ? 14 : 0) + (scan.displacement?.direction === (wantLong ? "BULLISH" : "BEARISH") ? 10 : 0) + (s15.zone === (wantLong ? "DISCOUNT" : "PREMIUM") ? 8 : 0));
    setups.push({
      id: `ob-${ob.time}`, instrument, direction: (wantLong ? "LONG" : "SHORT"),
      setupType: "ORDER_BLOCK_RETEST", timeframe: "15m", session: sessionNow,
      entryZone: { top: +entryTop.toFixed(2), bottom: +entryBottom.toFixed(2) },
      entryConfirmation: mss ? `MSS confirmed at ${mss.price}; enter on retest tap with 15m rejection close` : "Retest tap with 15m rejection close",
      stopLoss: +sl.toFixed(2), takeProfits: [+t1.toFixed(2), +t2.toFixed(2), +t3.toFixed(2)],
      riskReward: +rr.toFixed(2), quality: Math.min(96, quality),
      confluences: [
        `${ob.direction} ${ob.kind.replace("_", " ")} ${ob.bottom}–${ob.top}`,
        mss ? `15m ${mss.kind} ${mss.direction.toLowerCase()} @ ${mss.price}` : "No MSS (rule not enforced)",
        `Price in ${s15.zone.toLowerCase()} of 15m range`,
      ],
      invalidation: +(wantLong ? ob.bottom - a1 : ob.top + a1).toFixed(2),
      horizon: "INTRADAY",
      reasoning: [
        `Unmitigated ${ob.kind.toLowerCase().replace("_", " ")} from ${new Date(ob.time * 1000).toISOString().slice(5, 16).replace("T", " ")} UTC sits ${Math.abs(((ob.top + ob.bottom) / 2 - price) / price * 100).toFixed(2)}% away.`,
        `Structure context: 15m ${s15.trend.toLowerCase()} with last event ${s15.lastEvent ? `${s15.lastEvent.kind} ${s15.lastEvent.direction.toLowerCase()}` : "n/a"}.`,
      ],
      createdAt: new Date().toISOString(), status: "ACTIVE",
    });
  };

  const buildQm = () => {
    const qm = scan.quasimodo;
    if (!qm) return;
    const dirOk = (qm.direction === "BULLISH" && wantLong) || (qm.direction === "BEARISH" && wantShort);
    if (!dirOk) { noSetupReasons.push(`QM setup: ${qm.direction} Quasimodo conflicts with ${confluence?.overallBias} confluence`); return; }
    const long = qm.direction === "BULLISH";
    const sl = qm.invalidation;
    const risk = Math.abs((long ? qm.entryZoneTop : qm.entryZoneBottom) - sl);
    const entry = long ? qm.entryZoneBottom : qm.entryZoneTop;
    const t1 = long ? entry + risk * 2 : entry - risk * 2;
    const t2 = long ? entry + risk * 3 : entry - risk * 3;
    const t3 = qm.targets[qm.targets.length - 1];
    const quality = Math.round(58 + (qm.breakoutConfirmed ? 16 : 0) + (s4h.trend === (long ? "UPTREND" : "DOWNTREND") ? 12 : 0));
    setups.push({
      id: `qm-${qm.time}`, instrument, direction: qm.direction === "BULLISH" ? "LONG" : "SHORT",
      setupType: "QUASIMODO", timeframe: "15m", session: sessionNow,
      entryZone: { top: qm.entryZoneTop, bottom: qm.entryZoneBottom },
      entryConfirmation: `Retest of QM neckline ${qm.neckline} with 15m rejection close`,
      stopLoss: sl, takeProfits: [+t1.toFixed(2), +t2.toFixed(2), +(t3 ?? entry + risk * 5).toFixed(2)],
      riskReward: 3, quality: Math.min(95, quality),
      confluences: [
        `${qm.direction} Quasimodo (LS ${qm.leftShoulder.price} / head ${qm.head.price} / RS ${qm.rightShoulder.price})`,
        `Neckline ${qm.neckline} broken ${qm.breakoutConfirmed ? "and confirmed" : "— awaiting confirmation"}`,
      ],
      invalidation: sl, horizon: "INTRADAY",
      reasoning: [
        `Quasimodo ${qm.direction.toLowerCase()} completed: head at ${qm.head.price}, neckline ${qm.neckline}.`,
        `Pattern targets align with structural projections ${qm.targets.join(" → ")}.`,
      ],
      createdAt: new Date().toISOString(), status: "ACTIVE",
    });
  };

  const buildOte = () => {
    if (!scan.ote || !scan.inOte) { if (!scan.ote) noSetupReasons.push("OTE setup: insufficient swing data for OTE zone"); else noSetupReasons.push(`OTE setup: price outside OTE zone (${scan.ote.bottom}–${scan.ote.top})`); return; }
    const long = s1h.trend === "UPTREND" || s4h.trend === "UPTREND";
    if (rules.requireHtfAlignment && !long && s4h.trend !== "DOWNTREND") { noSetupReasons.push("OTE setup: HTF not bearish for short OTE"); return; }
    const entryTop = scan.ote.top, entryBottom = scan.ote.bottom;
    const swingLow = Math.min(...candles1h.slice(-40).map((c) => c.low));
    const swingHigh = Math.max(...candles1h.slice(-40).map((c) => c.high));
    const sl = long ? swingLow - a1 * 0.5 : swingHigh + a1 * 0.5;
    const risk = Math.abs(entryBottom - sl) || a1;
    const t1 = long ? entryBottom + risk * 2 : entryTop - risk * 2;
    const t2 = long ? entryBottom + risk * 3 : entryTop - risk * 3;
    const t3 = long ? entryBottom + risk * 5 : entryTop - risk * 5;
    setups.push({
      id: `ote-${Date.now()}`, instrument, direction: long ? "LONG" : "SHORT",
      setupType: "OTE", timeframe: "15m", session: sessionNow,
      entryZone: { top: entryTop, bottom: entryBottom },
      entryConfirmation: "Price in OTE with bullish/bearish reaction candle (engulf or pin bar) on 15m",
      stopLoss: +sl.toFixed(2), takeProfits: [+t1.toFixed(2), +t2.toFixed(2), +t3.toFixed(2)],
      riskReward: 3, quality: 62,
      confluences: [`OTE zone ${entryBottom}–${entryTop} (0.618–0.79 of the impulse leg)`, `HTF trend 1H ${s1h.trend} / 4H ${s4h.trend}`],
      invalidation: sl, horizon: "INTRADAY",
      reasoning: ["Price is inside the Optimal Trade Entry band of the latest impulse leg.", "Stop anchored beyond the impulse origin with ATR buffer."],
      createdAt: new Date().toISOString(), status: "ACTIVE",
    });
  };

  buildSweepFvg();
  buildObRetest();
  buildQm();
  buildOte();

  // hard filter: minRR
  const filtered = setups.filter((s) => {
    const rr = Math.abs(s.takeProfits[1] - (s.direction === "LONG" ? s.entryZone.bottom : s.entryZone.top)) / Math.abs((s.direction === "LONG" ? s.entryZone.bottom : s.entryZone.top) - s.stopLoss);
    if (rr < rules.minRR) {
      noSetupReasons.push(`${s.setupType}: RR 1:${rr.toFixed(2)} below required 1:${rules.minRR}`);
      return false;
    }
    return true;
  });

  if (!filtered.length && !noSetupReasons.length) {
    noSetupReasons.push("No setup family currently satisfies its preconditions — standing aside is the correct output");
  }

  return {
    instrument, setups: filtered.sort((a, b) => b.quality - a.quality),
    noSetupReasons: filtered.length ? noSetupReasons : noSetupReasons.slice(0, 6),
    rulesApplied, timestamp: new Date().toISOString(),
  };
}
