"use client";

/**
 * GOLD INTELLIGENCE AI — Application shell.
 * Left collapsible sidebar (23 sections), top market bar (live quotes via
 * socket.io), main workspace, right AI intelligence panel, bottom info bar.
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, AlignLeft, BarChart3, Bell, BookOpen, Bot, Boxes, BrainCircuit,
  CandlestickChart, ChevronLeft, ChevronRight, CircleDot, Coins, Command,
  Droplets, Flame, Gauge, Globe, Grid3X3, LineChart, ListFilter, Layers,
  Menu, RefreshCw, Search, Settings, Shield, Sliders, Sparkles, Target,
  Waves, X, Zap,
} from "lucide-react";
import { useApi, useLiveQuotes, useCountUp, useNow } from "@/lib/hooks/useData";
import { BackgroundScene } from "@/components/layout/BackgroundScene";
import { StatusBadge, GlassPanel, DirectionBadge, ProbabilityBar, Disclaimer } from "@/components/glass/primitives";
import type { ConfluenceOutput } from "@/lib/engines/types";

import { OverviewDashboard } from "@/components/views/dashboard";
import { LiveGoldCharts } from "@/components/views/charts";
import { FundamentalIntelligence } from "@/components/views/fundamentals";
import { TechnicalIntelligence, IctScanner } from "@/components/views/technical";
import { LiquidityIntelligence, LiquidityHeatmap, SessionIntelligence, VolatilityIntelligence, OrderFlowAnalysis } from "@/components/views/market-structure";
import { IntermarketAnalysis, ComexFutures } from "@/components/views/intermarket";
import { PredictionCenter, ConfluenceEngine, TradeSetupGenerator } from "@/components/views/intelligence";
import { AiAssistant } from "@/components/views/assistant";
import { TradeJournal, StrategyBacktester, MarketReplay } from "@/components/views/trading-lab";
import { SmartAlerts, RiskManagement, ModelPerformance, SettingsView } from "@/components/views/ops";

// ---------------------------------------------------------------------------
// Navigation registry — 23 sections (spec §30)
// ---------------------------------------------------------------------------

const NAV = [
  { group: "Market", items: [
    { id: "overview", label: "Overview Dashboard", icon: Gauge },
    { id: "charts", label: "Live Gold Charts", icon: CandlestickChart },
  ]},
  { group: "Intelligence", items: [
    { id: "fundamental", label: "Fundamental Intelligence", icon: Globe },
    { id: "technical", label: "Technical Intelligence", icon: LineChart },
    { id: "ict", label: "ICT/SMC Scanner", icon: Layers },
    { id: "liquidity", label: "Liquidity Intelligence", icon: Droplets },
    { id: "heatmap", label: "Liquidity Heatmap", icon: Grid3X3 },
    { id: "orderflow", label: "Order Flow Analysis", icon: Waves },
    { id: "sessions", label: "Session Intelligence", icon: CircleDot },
    { id: "volatility", label: "Volatility Intelligence", icon: Flame },
    { id: "intermarket", label: "Intermarket Analysis", icon: Boxes },
    { id: "comex", label: "COMEX Futures", icon: Coins },
  ]},
  { group: "AI Engines", items: [
    { id: "predictions", label: "AI Prediction Center", icon: BrainCircuit },
    { id: "confluence", label: "AI Confluence Engine", icon: Sparkles },
    { id: "setups", label: "Trade Setup Generator", icon: Target },
    { id: "assistant", label: "AI Trading Assistant", icon: Bot },
    { id: "modelperf", label: "Model Performance", icon: BarChart3 },
  ]},
  { group: "Trading Lab", items: [
    { id: "journal", label: "Trade Journal", icon: BookOpen },
    { id: "backtester", label: "Strategy Backtester", icon: Sliders },
    { id: "replay", label: "Market Replay", icon: RefreshCw },
    { id: "alerts", label: "Smart Alerts", icon: Bell },
    { id: "risk", label: "Risk Management", icon: Shield },
  ]},
  { group: "System", items: [
    { id: "settings", label: "Settings", icon: Settings },
  ]},
];

const VIEW_TITLES: Record<string, string> = Object.fromEntries(
  NAV.flatMap((g) => g.items.map((i) => [i.id, i.label])),
);

function renderView(id: string, nav: (v: string) => void) {
  switch (id) {
    case "overview": return <OverviewDashboard onNavigate={nav} />;
    case "charts": return <LiveGoldCharts />;
    case "fundamental": return <FundamentalIntelligence />;
    case "technical": return <TechnicalIntelligence />;
    case "ict": return <IctScanner />;
    case "liquidity": return <LiquidityIntelligence />;
    case "heatmap": return <LiquidityHeatmap />;
    case "orderflow": return <OrderFlowAnalysis />;
    case "sessions": return <SessionIntelligence />;
    case "volatility": return <VolatilityIntelligence />;
    case "intermarket": return <IntermarketAnalysis />;
    case "comex": return <ComexFutures />;
    case "predictions": return <PredictionCenter />;
    case "confluence": return <ConfluenceEngine />;
    case "setups": return <TradeSetupGenerator />;
    case "assistant": return <AiAssistant />;
    case "modelperf": return <ModelPerformance />;
    case "journal": return <TradeJournal />;
    case "backtester": return <StrategyBacktester />;
    case "replay": return <MarketReplay />;
    case "alerts": return <SmartAlerts />;
    case "risk": return <RiskManagement />;
    case "settings": return <SettingsView />;
    default: return <OverviewDashboard onNavigate={nav} />;
  }
}

// ---------------------------------------------------------------------------
// Top market bar
// ---------------------------------------------------------------------------

function Ticker() {
  const { data } = useApi<{
    xauusd: { price: number | null; status: string; source: string; change: { abs: number; pct: number } | null };
    gc1: { price: number | null; status: string; change: { abs: number; pct: number } | null };
    session: string; marketOpen: boolean; serverTime: string;
  }>("/api/market/ticker", 2500);
  const { quotes, connected } = useLiveQuotes();

  const xauLive = quotes["XAUUSD"];
  const gcLive = quotes["GC1!"];
  const xau = useCountUp(xauLive?.price ?? data?.xauusd.price ?? null, 500);
  const gc = useCountUp(gcLive?.price ?? data?.gc1.price ?? null, 500);
  const xauDir = xauLive?.direction ?? 0;
  const gcDir = gcLive?.direction ?? 0;

  return (
    <div className="flex items-center gap-4 lg:gap-6 overflow-x-auto whitespace-nowrap px-4 h-12">
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[9px] uppercase tracking-[0.18em] text-zinc-600">XAUUSD</span>
        <motion.span
          key={xau}
          initial={{ opacity: 0.4 }} animate={{ opacity: 1 }}
          className={`num text-[13px] font-semibold ${xauDir > 0 ? "text-zinc-50" : xauDir < 0 ? "text-zinc-400" : "text-zinc-200"}`}
        >
          {xau !== null ? xau.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
        </motion.span>
        {data?.xauusd.change ? (
          <span className={`num text-[10px] ${data.xauusd.change.pct >= 0 ? "text-zinc-300" : "text-zinc-500"}`}>
            {data.xauusd.change.pct >= 0 ? "+" : ""}{data.xauusd.change.abs} ({data.xauusd.change.pct}%)
          </span>
        ) : null}
        <StatusBadge status={xauLive ? "LIVE" : data?.xauusd.status ?? "…"} />
      </div>
      <div className="w-px h-5 bg-white/10 shrink-0" />
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[9px] uppercase tracking-[0.18em] text-zinc-600">GC1!</span>
        <motion.span
          key={gc}
          initial={{ opacity: 0.4 }} animate={{ opacity: 1 }}
          className={`num text-[13px] font-semibold ${gcDir > 0 ? "text-zinc-50" : gcDir < 0 ? "text-zinc-400" : "text-zinc-200"}`}
        >
          {gc !== null ? gc.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
        </motion.span>
        {data?.gc1.change ? (
          <span className={`num text-[10px] ${data.gc1.change.pct >= 0 ? "text-zinc-300" : "text-zinc-500"}`}>
            {data.gc1.change.pct >= 0 ? "+" : ""}{data.gc1.change.abs} ({data.gc1.change.pct}%)
          </span>
        ) : null}
        <StatusBadge status={gcLive ? data?.gc1.status ?? "DELAYED" : data?.gc1.status ?? "…"} />
      </div>
      <div className="w-px h-5 bg-white/10 shrink-0 hidden md:block" />
      <div className="hidden md:flex items-center gap-2 shrink-0">
        <span className={`live-dot ${data?.marketOpen ? "" : "opacity-40"}`} />
        <span className="text-[10px] text-zinc-400">{data?.session ?? "…"}</span>
        <span className="text-[9px] text-zinc-600">{data?.marketOpen ? "MARKET OPEN" : "CLOSED"}</span>
      </div>
      <div className="ml-auto hidden lg:flex items-center gap-2 shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-zinc-100" : "bg-zinc-600"}`} />
        <span className="text-[9px] uppercase tracking-[0.14em] text-zinc-600">{connected ? "stream live" : "stream offline"}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right AI intelligence panel
// ---------------------------------------------------------------------------

function AiIntelPanel({ onNavigate }: { onNavigate: (v: string) => void }) {
  const { data: conf } = useApi<ConfluenceOutput>("/api/ai/confluence", 12000);
  const { data: preds } = useApi<{ technical: { horizon: string; direction: string; probBull: number; probBear: number }[] }>("/api/ai/predictions", 15000);
  const { data: analysis } = useApi<{ liquidity: { likelyTarget: { label: string; price: number; side: string } | null; targetConfidence: number }; activeSessionName: string; regime: { regime: string }; volatility: { rangeConsumedPct: number; regime: string } }>("/api/analysis/full", 12000);
  const h1 = preds?.technical?.find((p) => p.horizon === "1h");

  return (
    <div className="space-y-3 p-3 h-full overflow-y-auto">
      <div className="flex items-center gap-2 px-1">
        <Sparkles size={13} className="text-zinc-300" />
        <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-zinc-300">AI Intelligence</span>
      </div>

      <GlassPanel className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] uppercase tracking-[0.16em] text-zinc-600">Confluence</span>
          {conf ? <DirectionBadge dir={conf.overallBias} /> : null}
        </div>
        {conf ? (
          <>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-xl font-semibold num text-zinc-50">{conf.confluenceScore > 0 ? "+" : ""}{conf.confluenceScore}</span>
              <span className="text-[9px] text-zinc-500">score · conf {(conf.confidence * 100).toFixed(0)}%</span>
            </div>
            <ProbabilityBar bull={conf.probBull} bear={conf.probBear} neutral={conf.probNeutral} />
          </>
        ) : <div className="skeleton h-16" />}
      </GlassPanel>

      <GlassPanel className="p-3" delay={0.05}>
        <div className="text-[9px] uppercase tracking-[0.16em] text-zinc-600 mb-2">1H Technical Prediction</div>
        {h1 ? (
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <DirectionBadge dir={h1.direction} />
              <span className="text-[10px] num text-zinc-400">bull {(h1.probBull * 100).toFixed(0)}%</span>
            </div>
          </div>
        ) : <div className="skeleton h-8" />}
        {analysis ? (
          <div className="mt-2 pt-2 border-t border-white/5 space-y-1">
            <div className="flex justify-between text-[10px]"><span className="text-zinc-600">Regime</span><span className="text-zinc-300">{analysis.regime.regime.replace(/_/g, " ").toLowerCase()}</span></div>
            <div className="flex justify-between text-[10px]"><span className="text-zinc-600">Session</span><span className="text-zinc-300">{analysis.activeSessionName.toLowerCase()}</span></div>
            <div className="flex justify-between text-[10px]"><span className="text-zinc-600">ADR used</span><span className="num text-zinc-300">{analysis.volatility.rangeConsumedPct}%</span></div>
          </div>
        ) : null}
      </GlassPanel>

      <GlassPanel className="p-3" delay={0.1}>
        <div className="text-[9px] uppercase tracking-[0.16em] text-zinc-600 mb-2">Liquidity Draw</div>
        {analysis?.liquidity.likelyTarget ? (
          <button onClick={() => onNavigate("liquidity")} className="text-left w-full">
            <div className="text-[15px] num text-zinc-50">{analysis.liquidity.likelyTarget.price}</div>
            <div className="text-[9.5px] text-zinc-500 mt-0.5">{analysis.liquidity.likelyTarget.side}-side · confidence {analysis.liquidity.targetConfidence}%</div>
          </button>
        ) : <div className="skeleton h-10" />}
      </GlassPanel>

      <button
        onClick={() => onNavigate("assistant")}
        className="w-full glass glass-hover p-3 flex items-center gap-2.5 text-left"
      >
        <Bot size={15} className="text-zinc-300" />
        <div>
          <div className="text-[11px] font-medium text-zinc-100">Ask the AI Assistant</div>
          <div className="text-[9px] text-zinc-600">Grounded in live platform data</div>
        </div>
      </button>

      <div className="px-1">
        <Disclaimer />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

export default function Home() {
  const [view, setView] = useState("overview");
  const [collapsed, setCollapsed] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [query, setQuery] = useState("");
  const { quotes, alertEvents } = useLiveQuotes();
  const now = useNow(1000);
  // live toasts: recent alert events, auto-expire after 8s (derived, no extra state)
  const toasts = alertEvents.filter((a) => Date.now() - new Date(a.time).getTime() < 8000).slice(0, 4).map((a) => ({ message: a.message, time: a.time }));

  const navigate = (v: string) => {
    setView(v);
    setMobileNav(false);
    try { window.history.replaceState(null, "", `?view=${v}`); } catch { /* noop */ }
  };

  // deep link ?view= (microtask to avoid sync setState in effect)
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const v = new URLSearchParams(window.location.search).get("view");
      if (v && VIEW_TITLES[v]) setView(v);
    });
    return () => { cancelled = true; };
  }, []);

  // keyboard shortcut: cmd+k focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("nav-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filteredNav = useMemo(() => {
    if (!query.trim()) return NAV;
    const q = query.toLowerCase();
    return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q)) })).filter((g) => g.items.length);
  }, [query]);

  return (
    <div className="min-h-screen flex flex-col relative">
      <BackgroundScene />

      {/* Top market bar */}
      <header className="sticky top-0 z-40 glass-strong border-b border-white/10 rounded-none">
        <div className="flex items-center">
          <button
            className="lg:hidden p-3 text-zinc-300"
            onClick={() => setMobileNav(true)}
            aria-label="Open navigation"
          >
            <Menu size={18} />
          </button>
          <div className="hidden lg:flex items-center gap-2 pl-4 pr-2">
            <div className="w-7 h-7 rounded-lg glass flex items-center justify-center">
              <CircleDot size={14} className="text-zinc-200" />
            </div>
            <div className="leading-tight">
              <div className="text-[12px] font-bold tracking-[0.22em] text-zinc-50">GOLD INTELLIGENCE</div>
              <div className="text-[8px] tracking-[0.3em] text-zinc-600 uppercase">Decode Liquidity · Predict</div>
            </div>
          </div>
          <div className="flex-1 min-w-0"><Ticker /></div>
          <button
            onClick={() => setAiOpen((v) => !v)}
            className="hidden xl:flex items-center gap-1.5 px-3 h-12 border-l border-white/10 text-[10px] uppercase tracking-[0.14em] text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            <Bot size={13} /> {aiOpen ? "Hide" : "Show"} AI Panel
          </button>
        </div>
      </header>

      <div className="flex flex-1 relative z-10">
        {/* Desktop sidebar */}
        <aside className={`hidden lg:flex flex-col border-r border-white/8 transition-all duration-300 ${collapsed ? "w-[60px]" : "w-60"} shrink-0 sticky top-12 self-start h-[calc(100vh-3rem)]`}>
          <div className="p-2.5">
            {!collapsed && (
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
                <input
                  id="nav-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search sections… ⌘K"
                  className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-7 pr-2 py-1.5 text-[11px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-white/25"
                />
              </div>
            )}
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-3 space-y-3">
            {filteredNav.map((group) => (
              <div key={group.group}>
                {!collapsed && (
                  <div className="text-[8.5px] uppercase tracking-[0.24em] text-zinc-600 px-2 mb-1">{group.group}</div>
                )}
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        onClick={() => navigate(item.id)}
                        title={item.label}
                        className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all group ${
                          view === item.id
                            ? "bg-white/12 border border-white/20 text-zinc-50 shadow-[0_0_16px_rgba(255,255,255,0.08)]"
                            : "text-zinc-500 hover:text-zinc-200 hover:bg-white/5 border border-transparent"
                        }`}
                      >
                        <item.icon size={14} className={view === item.id ? "text-zinc-100" : "text-zinc-600 group-hover:text-zinc-300"} />
                        {!collapsed && <span className="text-[11px] font-medium truncate">{item.label}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="border-t border-white/8 p-3 flex items-center justify-center text-zinc-600 hover:text-zinc-200 transition-colors"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={14} /> : <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest"><ChevronLeft size={13} /> Collapse</span>}
          </button>
        </aside>

        {/* Mobile nav overlay */}
        <AnimatePresence>
          {mobileNav && (
            <motion.div
              className="fixed inset-0 z-50 lg:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              <div className="absolute inset-0 bg-black/70" onClick={() => setMobileNav(false)} />
              <motion.div
                className="absolute left-0 top-0 bottom-0 w-72 glass-strong rounded-none border-r border-white/10 flex flex-col"
                initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }}
                transition={{ type: "spring", damping: 28, stiffness: 300 }}
              >
                <div className="flex items-center justify-between p-3 border-b border-white/8">
                  <div className="text-[12px] font-bold tracking-[0.2em] text-zinc-50">GOLD INTELLIGENCE</div>
                  <button onClick={() => setMobileNav(false)} className="p-1 text-zinc-400"><X size={16} /></button>
                </div>
                <nav className="flex-1 overflow-y-auto p-2 space-y-3">
                  {NAV.map((group) => (
                    <div key={group.group}>
                      <div className="text-[8.5px] uppercase tracking-[0.24em] text-zinc-600 px-2 mb-1">{group.group}</div>
                      <ul className="space-y-0.5">
                        {group.items.map((item) => (
                          <li key={item.id}>
                            <button
                              onClick={() => navigate(item.id)}
                              className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left ${view === item.id ? "bg-white/12 text-zinc-50" : "text-zinc-400 hover:bg-white/5"}`}
                            >
                              <item.icon size={14} />
                              <span className="text-[12px]">{item.label}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </nav>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main workspace */}
        <main className="flex-1 min-w-0 p-3 lg:p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-[15px] font-semibold text-zinc-50 tracking-wide">{VIEW_TITLES[view] ?? "Dashboard"}</h1>
              <p className="text-[10px] text-zinc-600 mt-0.5">Understand the Market · Decode Liquidity · Predict with Intelligence</p>
            </div>
            <div className="hidden md:flex items-center gap-2">
              <StatusBadge status={quotes["XAUUSD"] ? "STREAM LIVE" : "POLLING"} />
            </div>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              {renderView(view, navigate)}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Right AI panel */}
        <AnimatePresence initial={false}>
          {aiOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 296, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="hidden xl:block shrink-0 border-l border-white/8 sticky top-12 self-start h-[calc(100vh-6rem)] overflow-hidden"
            >
              <AiIntelPanel onNavigate={navigate} />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom market info bar */}
      <footer className="sticky bottom-0 z-30 glass-strong rounded-none border-t border-white/10 mt-auto">
        <div className="flex items-center gap-4 px-4 h-9 text-[9px] text-zinc-600 overflow-hidden">
          <span className="uppercase tracking-[0.2em] text-zinc-500 shrink-0">GOLD INTELLIGENCE AI</span>
          <span className="hidden md:inline truncate">AI outputs are analytical estimates, not financial advice</span>
          <span className="hidden lg:inline num">XAUUSD: {quotes["XAUUSD"]?.price ?? "…"} · GC1!: {quotes["GC1!"]?.price ?? "…"}</span>
          <span className="ml-auto num shrink-0" suppressHydrationWarning>{now ? now.toISOString().slice(11, 19) : "--:--:--"} UTC</span>
        </div>
      </footer>

      {/* Live alert toasts */}
      <div className="fixed bottom-12 right-4 z-50 space-y-2 w-80 max-w-[90vw]">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.time}
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              className="glass-strong p-3 flex items-start gap-2.5"
            >
              <Bell size={13} className="text-zinc-300 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-[11px] text-zinc-100 leading-snug">{t.message}</div>
                <div className="text-[8.5px] num text-zinc-600 mt-0.5">{t.time.slice(11, 19)} UTC</div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
