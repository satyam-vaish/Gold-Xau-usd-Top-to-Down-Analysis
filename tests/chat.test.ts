import { describe, it, expect } from "bun:test";
import { generateGroundedResponse, type GroundedSnapshot } from "../src/lib/server/groundedAssistant";

describe("grounded AI Assistant", () => {
  const mockSnapshot: GroundedSnapshot = {
    meta: {
      instrument: "XAUUSD",
      snapshotTime: "2026-11-17T18:00:00.000Z",
      note: "Live provider data test",
    },
    quote: {
      price: 2642.5,
      status: "LIVE",
      source: "TwelveData",
      asOf: "2026-11-17T18:00:00.000Z",
    },
    structure: {
      "4h": {
        trend: "UPTREND",
        lastEvent: "BOS BULLISH @ 2635.00",
        zone: "DISCOUNT",
        range: [2610.0, 2670.0],
        labels: ["HH", "HL"],
        support: [2630.0, 2615.0],
        resistance: [2660.0, 2675.0],
      },
    },
    mtf: "Strong bullish alignment",
    ict: {
      activeFvgs: ["BULLISH 2634.50-2638.20"],
      orderBlocks: ["BULLISH ORDER_BLOCK 2625.00-2630.00"],
      recentSweeps: ["SSL_SWEEP @ 2628.50 reclaimed"],
      quasimodo: null,
      ote: "2630.00-2636.00",
      displacement: "BULLISH 1.8xATR",
    },
    liquidity: {
      basis: "inferred from price action",
      nearestBsl: "2668.50 (H4 Swing High)",
      nearestSsl: "2625.00 (H1 Swing Low)",
      likelyTarget: "2668.50 buy-side, confidence 78%",
    },
    sessions: {
      active: "NEW_YORK",
      open: ["NEW_YORK"],
      ranges: ["NY: 2635.00-2645.00"],
    },
    volatility: {
      adr: 32.5,
      adrPct: 1.23,
      todayRange: 18.4,
      consumedPct: 56.6,
      regime: "NORMAL",
      hvPercentile: 45,
      atr: 4.8,
    },
    orderFlow: {
      buyerPct: 58,
      sellerPct: 42,
      cvd: 1420,
      dataBasis: "OHLCV proxy",
      divergence: "NONE",
      absorption: null,
    },
    regime: {
      regime: "TRENDING_UP",
      confidence: 82,
      topEvidence: ["Consistent higher highs", "CVD expanding"],
    },
    confluence: {
      overallBias: "BULLISH",
      score: 65,
      probBull: 0.65,
      probBear: 0.15,
      top: ["4H uptrend aligned", "Bullish displacement candle"],
      against: ["Approaching resistance level"],
      invalidation: 2620.0,
    },
    setups: {
      count: 1,
      noSetupReasons: [],
      top: {
        dir: "LONG",
        type: "ICT Liquidity Sweep + FVG Retest",
        entry: [2636.0, 2638.0],
        sl: 2628.0,
        tps: [2650.0, 2665.0, 2675.0],
        rr: 3.4,
        quality: 88,
      },
    },
    news: {
      sentiment: "BULLISH",
      top: ["[BULLISH/HIGH] US Dollar softens as bond yields pull back"],
    },
    calendar: ["US Retail Sales (HIGH, UPCOMING) in 2.5h"],
    journal: {
      entries: 12,
      winRate: 66.7,
    },
  };

  it("answers FVG questions correctly citing price and active imbalances", () => {
    const ans = generateGroundedResponse("Is there a valid FVG?", mockSnapshot);
    expect(ans).toContain("Fair Value Gap");
    expect(ans).toContain("2642.50");
    expect(ans).toContain("2634.50-2638.20");
  });

  it("answers Bias questions with confluence score and invalidation level", () => {
    const ans = generateGroundedResponse("What is the current XAUUSD bias?", mockSnapshot);
    expect(ans).toContain("BULLISH");
    expect(ans).toContain("+65");
    expect(ans).toContain("2620.00");
  });

  it("answers Liquidity questions citing BSL and SSL targets", () => {
    const ans = generateGroundedResponse("Where is the nearest liquidity?", mockSnapshot);
    expect(ans).toContain("2668.50");
    expect(ans).toContain("Buy-Side Liquidity");
    expect(ans).toContain("Sell-Side Liquidity");
  });

  it("answers 1:3 setups questions with entry, stop loss, and targets", () => {
    const ans = generateGroundedResponse("Show me potential 1:3 setups", mockSnapshot);
    expect(ans).toContain("1:3.4");
    expect(ans).toContain("2628.00");
    expect(ans).toContain("LONG");
  });

  it("answers Order Flow questions citing buyer/seller ratio and CVD", () => {
    const ans = generateGroundedResponse("What is the current buyer/seller ratio?", mockSnapshot);
    expect(ans).toContain("58%");
    expect(ans).toContain("42%");
    expect(ans).toContain("+1420");
  });
});
