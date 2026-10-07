/**
 * GOLD INTELLIGENCE AI — Core engine types.
 * Pure TypeScript, framework-free. All engines are deterministic functions
 * over candle arrays so they can be unit-tested, cached and reused on both
 * the server (API routes) and in background services.
 */

export type Instrument = "XAUUSD" | "GC1!";

export type Timeframe =
  | "1m" | "3m" | "5m" | "15m" | "30m"
  | "1h" | "2h" | "4h"
  | "1d" | "1w" | "1M";

export const ALL_TIMEFRAMES: Timeframe[] = [
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w", "1M",
];

export const TF_MINUTES: Record<Timeframe, number> = {
  "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
  "1h": 60, "2h": 120, "4h": 240,
  "1d": 1440, "1w": 10080, "1M": 43200,
};

export interface Candle {
  time: number; // unix seconds (UTC) — candle open
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type DataStatus = "LIVE" | "DELAYED" | "DEMO" | "ESTIMATED" | "UNAVAILABLE";

export interface DataSourceMeta {
  source: string;
  status: DataStatus;
  instrument: Instrument | string;
  timeframe?: Timeframe;
  asOf: string; // ISO timestamp of the data
  note?: string;
}

export interface Swing {
  index: number;
  time: number;
  price: number;
  kind: "HIGH" | "LOW";
  strength: number; // number of bars confirmed each side
}

export type TrendState = "UPTREND" | "DOWNTREND" | "RANGE";

export interface StructurePoint {
  kind: "BOS" | "CHoCH" | "MSS";
  direction: "BULLISH" | "BEARISH";
  time: number;
  price: number; // level broken
  fromSwing: Swing;
  confirmTime: number;
}

export interface TimeframeStructure {
  timeframe: Timeframe;
  trend: TrendState;
  swings: Swing[];
  highs: Swing[]; // recent HH/LH sequence (most recent last)
  lows: Swing[];
  lastHigh: Swing | null;
  lastLow: Swing | null;
  events: StructurePoint[];
  lastEvent: StructurePoint | null;
  rangeHigh: number;
  rangeLow: number;
  equilibrium: number;
  zone: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";
  price: number;
  support: number[];
  resistance: number[];
  lastLabelHigh: "HH" | "LH" | null;
  lastLabelLow: "HL" | "LL" | null;
}

export interface Zone {
  top: number;
  bottom: number;
  time: number;
  endTime?: number;
  direction: "BULLISH" | "BEARISH";
  filled: boolean;
  mitigated?: boolean;
}

export interface FVG extends Zone {
  size: number;
  displacement: boolean;
  inverse: boolean; // IFVG (an FVG that was violated and inverted)
  consecutive: number; // stacked count
}

export interface OrderBlock extends Zone {
  kind: "ORDER_BLOCK" | "BREAKER" | "MITIGATION" | "REJECTION";
  volume?: number;
  broken: boolean;
  retested: boolean;
}

export interface LiquiditySweep {
  kind: "BSL_SWEEP" | "SSL_SWEEP";
  time: number;
  sweepPrice: number;
  referencePrice: number;
  referenceLabel: string;
  reclaimed: boolean;
  displacementAfter: boolean;
}

export interface EqualLevels {
  kind: "EQH" | "EQL";
  price: number;
  times: number[];
  count: number;
  tolerance: number;
}

export interface Quasimodo {
  direction: "BULLISH" | "BEARISH";
  leftShoulder: Swing;
  head: Swing;
  rightShoulder: Swing;
  neckline: number;
  breakoutConfirmed: boolean;
  breakoutTime?: number;
  entryZoneTop: number;
  entryZoneBottom: number;
  invalidation: number;
  targets: number[];
  time: number;
}

export interface FibLevel {
  ratio: number;
  price: number;
  label: string;
}

export interface FibAnalysis {
  anchorHigh: { time: number; price: number };
  anchorLow: { time: number; price: number };
  direction: "UP" | "DOWN";
  levels: FibLevel[];
  oteZone: { top: number; bottom: number }; // 0.618–0.79 zone for the trade direction
  inOte: boolean;
  extensionLevels: FibLevel[];
}

export interface VwapSeriesPoint { time: number; value: number }

export interface VolumeProfileLevel {
  price: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
}

export interface VolumeProfile {
  levels: VolumeProfileLevel[];
  poc: number;
  vah: number;
  val: number;
  hvn: number[]; // prices of high-volume nodes
  lvn: number[]; // prices of low-volume nodes
  binSize: number;
}

export interface SessionWindow {
  name: string;
  short: string;
  openUtcMinutes: number;
  closeUtcMinutes: number;
  days: number[]; // 0=Sunday
}

export interface SessionState {
  name: string;
  short: string;
  isOpen: boolean;
  openTime: string; // ISO
  closeTime: string;
  high: number | null;
  low: number | null;
  range: number | null;
  openingRange: { high: number; low: number } | null;
}

export type SessionKey = "ASIAN" | "LONDON" | "NEW_YORK" | "LONDON_KZ" | "NY_KZ" | "SYDNEY";

export interface SessionStats {
  key: SessionKey;
  label: string;
  avgRange: number;
  medianRange: number;
  sweepAsianHighPct: number;
  sweepAsianLowPct: number;
  displacementPct: number;
  continuationPct: number;
  reversalPct: number;
  samples: number;
}

export interface VolatilityReport {
  atr: Record<string, number>; // per timeframe
  adr: number; // average daily range (absolute)
  adrPct: number;
  awr: number; // average weekly range
  dailyRange: number;
  rangeConsumedPct: number;
  remainingRange: number;
  historicalVolAnnual: number;
  hvPercentile: number;
  regime: "EXPANSION" | "CONTRACTION" | "NORMAL";
  expansion: boolean;
  contraction: boolean;
  stdevDaily: number;
  sessionVol: Record<string, number>;
  newsDrivenVol: number | null;
  atrTimeframe: Timeframe;
}

export interface OrderFlowPoint {
  time: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  cvd: number;
}

export interface OrderFlowReport {
  series: OrderFlowPoint[];
  buyVolume: number;
  sellVolume: number;
  buyerPct: number;
  sellerPct: number;
  delta: number;
  cvd: number;
  aggressiveBuying: boolean;
  aggressiveSelling: boolean;
  stackedImbalances: { side: "BUY" | "SELL"; count: number; time: number }[];
  absorption: { side: "SELL" | "BUY"; time: number; note: string } | null;
  divergence: { kind: "BULLISH" | "BEARISH" | null; note: string };
  dataBasis: "AGGRESSOR" | "PROXY";
  timeframe: Timeframe;
}

export type MarketRegime =
  | "TRENDING_BULLISH" | "TRENDING_BEARISH" | "RANGING"
  | "HIGH_VOLATILITY" | "LOW_VOLATILITY" | "CONSOLIDATION"
  | "POTENTIAL_REVERSAL" | "BREAKOUT" | "MANIPULATION_CANDIDATE";

export interface RegimeReport {
  regime: MarketRegime;
  secondary: MarketRegime | null;
  probabilities: Partial<Record<MarketRegime, number>>;
  evidence: string[];
  transitions: string[]; // warnings
  history: { time: number; regime: MarketRegime }[];
  confidence: number;
}

export interface PatternMatch {
  startTime: number;
  endTime: number;
  similarity: number; // 0..1
  forwardReturnPct: number;
  mfePct: number;
  maePct: number;
  barsToTarget: number | null;
}

export interface PatternReport {
  comparables: number;
  bullishOutcomes: number;
  bearishOutcomes: number;
  bullishPct: number;
  avgMovePct: number;
  medianMovePct: number;
  avgMfePct: number;
  avgMaePct: number;
  avgTimeToTargetBars: number | null;
  ci95Low: number;
  ci95High: number;
  matches: PatternMatch[];
  featuresUsed: string[];
  leakageGuard: boolean;
}

export interface PredictionFeature {
  name: string;
  value: number; // normalized -1..1 bullish..bearish
  weight: number;
  contribution: number;
  detail: string;
}

export interface PredictionOutput {
  engine: "FUNDAMENTAL" | "TECHNICAL";
  instrument: Instrument;
  horizon: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  probBull: number;
  probBear: number;
  probNeutral: number;
  confidence: number;
  expectedLow: number | null;
  expectedHigh: number | null;
  targetTs: string;
  features: PredictionFeature[];
  supporting: string[];
  conflicting: string[];
  invalidation: string;
  regime: string;
  timestamp: string;
  calibration: {
    basis: string;
    historicalAccuracy: number | null;
    samples: number;
  };
}

export interface ConfluenceOutput {
  overallBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  probBull: number;
  probBear: number;
  probNeutral: number;
  confluenceScore: number; // -100..100
  confidence: number;
  fundamentalBias: string;
  technicalBias: string;
  mtfAlignment: string;
  liquidityCondition: string;
  orderFlow: string;
  volatility: string;
  newsSentiment: string;
  regime: string;
  session: string;
  keyLiquidityTarget: { label: string; price: number; side: string } | null;
  majorSupport: number | null;
  majorResistance: number | null;
  reversalZone: { top: number; bottom: number } | null;
  keyRisks: string[];
  invalidation: string;
  supporting: string[];
  conflicting: string[];
  timestamp: string;
}

export interface TradeSetup {
  id: string;
  instrument: Instrument;
  direction: "LONG" | "SHORT";
  setupType: string;
  timeframe: Timeframe;
  session: string;
  entryZone: { top: number; bottom: number };
  entryConfirmation: string;
  stopLoss: number;
  takeProfits: number[];
  riskReward: number;
  quality: number; // 0..100
  confluences: string[];
  invalidation: number;
  horizon: string;
  reasoning: string[];
  createdAt: string;
  status: "ACTIVE" | "EXPIRED";
}

export interface SetupScanResult {
  instrument: Instrument;
  setups: TradeSetup[];
  noSetupReasons: string[];
  rulesApplied: string[];
  timestamp: string;
}

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  direction: "LONG" | "SHORT";
  entry: number;
  exit: number;
  stop: number;
  target: number;
  size: number;
  pnl: number;
  rMultiple: number;
  outcome: "WIN" | "LOSS" | "BE";
  exitReason: "TP" | "SL" | "EOD" | "SIGNAL_FLIP" | "END";
  session: string;
}

export interface BacktestMetrics {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  netReturnPct: number;
  maxDrawdownPct: number;
  avgRR: number;
  expectancyR: number;
  sharpe: number;
  avgWinR: number;
  avgLossR: number;
  longestWinStreak: number;
  longestLossStreak: number;
}

export interface BacktestReport {
  request: {
    instrument: Instrument;
    timeframe: Timeframe;
    strategy: string;
    sessionFilter: string;
    dateFrom: string;
    dateTo: string;
    minRR: number;
    riskPct: number;
  };
  assumptions: { spread: number; commissionPerLot: number; slippage: number };
  metrics: BacktestMetrics;
  equityCurve: { time: number; equity: number }[];
  trades: BacktestTrade[];
  monthly: { month: string; returnPct: number }[];
  walkForward: { segment: string; winRate: number; profitFactor: number; netReturnPct: number }[];
  notes: string[];
}

export interface LiquidityPool {
  id: string;
  side: "BUY" | "SELL"; // buy-side liquidity above (stops of shorts), sell-side below
  kind: string;
  label: string;
  price: number;
  distance: number;
  distancePct: number;
  strength: number; // 0..1
  status: "OPEN" | "SWEPT";
  formedAt: number;
  touches: number;
}

export interface LiquidityReport {
  instrument: Instrument;
  price: number;
  asOf: string;
  nearestBsl: LiquidityPool | null;
  nearestSsl: LiquidityPool | null;
  likelyTarget: LiquidityPool | null;
  targetConfidence: number;
  sweepZone: { top: number; bottom: number; side: "BUY" | "SELL" } | null;
  consumed: LiquidityPool[];
  pools: LiquidityPool[];
  recentSweeps: LiquiditySweep[];
  potentialReversalZone: { top: number; bottom: number } | null;
  basis: string; // clearly explains this is inferred from price action, not order book
  timeframe: Timeframe;
}

export interface HeatmapLevel {
  price: number;
  buyIntensity: number; // 0..1 inferred liquidity / executed volume concentration
  sellIntensity: number;
  executedVolume: number;
  restingOrderBook: number | null; // null when no real order-book feed
  basis: "EXECUTED_VOLUME" | "INFERRED" | "ORDER_BOOK";
}

export interface HeatmapReport {
  instrument: Instrument;
  timeframe: Timeframe;
  asOf: string;
  price: number;
  levels: HeatmapLevel[];
  maxIntensity: number;
  dataBasis: string;
  note: string;
}
