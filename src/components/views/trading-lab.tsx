"use client";

/**
 * Trade Journal, Strategy Backtester, Market Replay.
 */
import { useMemo, useRef, useState } from "react";
import { useApi, usePost } from "@/lib/hooks/useData";
import {
  Chip, GlassPanel, SectionTitle, StatCard, StatusBadge, SkeletonBlock,
  DataTable, KV, Disclaimer, DirectionBadge,
} from "@/components/glass/primitives";
import PriceChart from "@/components/charts/PriceChart";
import type { Candle } from "@/lib/engines/types";

// ---------------------------------------------------------------------------

interface JournalStats {
  totals: { entries: number; closed: number; wins: number; losses: number; open: number; winRate: number | null; profitFactor: number | null; avgRR: number | null; expectancy: number | null; totalPnl: number; maxDrawdown: number; avgWinner: number | null; avgLoser: number | null };
  bySession: { key: string; trades: number; winRate: number; pnl: number }[];
  bySetup: { key: string; trades: number; winRate: number; pnl: number }[];
  byTimeframe: { key: string; trades: number; winRate: number; pnl: number }[];
  equityCurve: { ts: string; equity: number }[];
  monthly: { month: string; pnl: number }[];
}

export function TradeJournal() {
  const entries = useApi<{ entries: Record<string, unknown>[] }>("/api/journal", 30000);
  const stats = useApi<JournalStats>("/api/journal/stats", 30000);
  const { post } = usePost<{ entry: Record<string, unknown> }>();
  const [form, setForm] = useState({ instrument: "XAUUSD", direction: "LONG", entry: "", stopLoss: "", takeProfit: "", exit: "", size: "", session: "LONDON", timeframe: "15m", setupType: "LIQUIDITY_SWEEP_FVG", outcome: "OPEN", pnl: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.entry) return;
    setSaving(true);
    const entry = Number(form.entry);
    const sl = form.stopLoss ? Number(form.stopLoss) : null;
    const tp = form.takeProfit ? Number(form.takeProfit) : null;
    const exit = form.exit ? Number(form.exit) : null;
    const risk = sl ? Math.abs(entry - sl) : null;
    const reward = tp ? Math.abs(tp - entry) : null;
    await post("/api/journal", {
      ...form,
      tradeDate: new Date().toISOString(),
      entry, stopLoss: sl, takeProfit: tp, exit,
      risk, reward,
      rr: risk && reward ? +(reward / risk).toFixed(2) : null,
      size: form.size ? Number(form.size) : null,
      pnl: form.pnl ? Number(form.pnl) : null,
      confirmations: [],
    });
    setForm({ ...form, entry: "", stopLoss: "", takeProfit: "", exit: "", pnl: "", notes: "" });
    await entries.mutate();
    await stats.mutate();
    setSaving(false);
  };

  const remove = async (id: string) => {
    await fetch(`/api/journal?id=${id}`, { method: "DELETE" });
    await entries.mutate();
    await stats.mutate();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {!stats.data ? Array.from({ length: 6 }).map((_, i) => <SkeletonBlock key={i} h={92} />) : (
          <>
            <StatCard label="Closed trades" value={stats.data.totals.closed} sub={`${stats.data.totals.open} open · ${stats.data.totals.entries} logged`} />
            <StatCard label="Win rate" value={stats.data.totals.winRate != null ? `${stats.data.totals.winRate}%` : "—"} sub={`${stats.data.totals.wins}W / ${stats.data.totals.losses}L`} />
            <StatCard label="Profit factor" value={stats.data.totals.profitFactor ?? "—"} sub={`expectancy ${stats.data.totals.expectancy ?? "—"}`} />
            <StatCard label="Total P/L" value={stats.data.totals.totalPnl} sub={`max DD ${stats.data.totals.maxDrawdown}`} />
            <StatCard label="Avg winner" value={stats.data.totals.avgWinner ?? "—"} sub={`avg loser ${stats.data.totals.avgLoser ?? "—"}`} />
            <StatCard label="Avg RR" value={stats.data.totals.avgRR ?? "—"} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <GlassPanel className="p-4">
          <SectionTitle title="Log a trade" subtitle="Manual or AI-generated entries" />
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <select value={form.instrument} onChange={(e) => setForm({ ...form, instrument: e.target.value })} className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
                <option>XAUUSD</option><option>GC1!</option>
              </select>
              <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
                <option>LONG</option><option>SHORT</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {([["entry", "Entry"], ["stopLoss", "Stop"], ["takeProfit", "Target"], ["exit", "Exit"], ["size", "Size (oz)"], ["pnl", "P/L $"]] as const).map(([k, label]) => (
                <input key={k} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder={label} inputMode="decimal"
                  className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200 placeholder:text-zinc-600 num" />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <select value={form.session} onChange={(e) => setForm({ ...form, session: e.target.value })} className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
                {["ASIAN", "LONDON", "NEW_YORK", "LONDON_KZ", "NY_KZ"].map((s) => <option key={s}>{s}</option>)}
              </select>
              <select value={form.timeframe} onChange={(e) => setForm({ ...form, timeframe: e.target.value })} className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
                {["5m", "15m", "1h", "4h"].map((s) => <option key={s}>{s}</option>)}
              </select>
              <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })} className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
                {["OPEN", "WIN", "LOSS", "BE"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <select value={form.setupType} onChange={(e) => setForm({ ...form, setupType: e.target.value })} className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
              {["LIQUIDITY_SWEEP_FVG", "ORDER_BLOCK_RETEST", "QUASIMODO", "OTE", "BREAKOUT", "MSS_FVG", "SESSION"].map((s) => <option key={s}>{s}</option>)}
            </select>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes, liquidity conditions, screenshots URL…" rows={2}
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200 placeholder:text-zinc-600" />
            <button onClick={() => void submit()} disabled={saving || !form.entry}
              className="w-full rounded-lg border border-white/20 bg-white/10 py-2 text-[11px] font-medium text-zinc-100 hover:bg-white/20 disabled:opacity-40">
              {saving ? "Saving…" : "Add entry"}
            </button>
          </div>
        </GlassPanel>

        <GlassPanel className="xl:col-span-2 p-4" delay={0.05}>
          <SectionTitle title="Equity curve" subtitle="From closed journal trades" />
          {stats.data && stats.data.equityCurve.length > 1 ? (
            <div className="h-40">
              {(() => {
                const eq = stats.data.equityCurve.map((p) => p.equity);
                const min = Math.min(...eq), max = Math.max(...eq);
                const range = max - min || 1;
                const pts = eq.map((v, i) => `${(i / (eq.length - 1)) * 100},${100 - ((v - min) / range) * 92 - 4}`).join(" ");
                return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                  <polyline points={pts} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
                </svg>;
              })()}
            </div>
          ) : <p className="text-[11px] text-zinc-600 py-8 text-center">Log closed trades to build the equity curve.</p>}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
            <div>
              <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1">By session</div>
              {stats.data?.bySession.slice(0, 4).map((s) => <KV key={s.key} k={s.key} v={`${s.winRate}% · ${s.pnl}`} />)}
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1">By setup</div>
              {stats.data?.bySetup.slice(0, 4).map((s) => <KV key={s.key} k={s.key.replace(/_/g, " ")} v={`${s.winRate}% · ${s.pnl}`} />)}
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1">By timeframe</div>
              {stats.data?.byTimeframe.slice(0, 4).map((s) => <KV key={s.key} k={s.key} v={`${s.winRate}% · ${s.pnl}`} />)}
            </div>
          </div>
        </GlassPanel>
      </div>

      <GlassPanel className="p-4">
        <SectionTitle title="Journal entries" subtitle={`${entries.data?.entries.length ?? 0} records`} />
        <div className="max-h-80 overflow-y-auto pr-1">
          <DataTable
            headers={["Date", "Instrument", "Direction", "Entry", "SL", "TP", "Exit", "RR", "Outcome", "P/L", "Setup", "Session", ""]}
            rows={(entries.data?.entries ?? []).slice(0, 50).map((e) => {
              const r = e as Record<string, string>;
              return [
                <span key="d" className="num">{new Date(r.tradeDate).toISOString().slice(5, 10)}</span>,
                r.instrument, <DirectionBadge key="dir" dir={r.direction} />,
                <span key="e" className="num">{Number(r.entry).toFixed(2)}</span>,
                <span key="sl" className="num">{r.stopLoss ? Number(r.stopLoss).toFixed(2) : "—"}</span>,
                <span key="tp" className="num">{r.takeProfit ? Number(r.takeProfit).toFixed(2) : "—"}</span>,
                <span key="x" className="num">{r.exit ? Number(r.exit).toFixed(2) : "—"}</span>,
                <span key="rr" className="num">{r.rr ?? "—"}</span>,
                <StatusBadge key="o" status={r.outcome} />,
                <span key="p" className="num">{r.pnl != null ? Number(r.pnl).toFixed(2) : "—"}</span>,
                r.setupType?.replace(/_/g, " ") ?? "—",
                r.session ?? "—",
                <button key="del" onClick={() => void remove(String(r.id))} className="text-[10px] text-zinc-600 hover:text-zinc-300">delete</button>,
              ];
            })}
          />
        </div>
      </GlassPanel>
      <Disclaimer />
    </div>
  );
}

// ---------------------------------------------------------------------------

interface BacktestResp {
  request: { instrument: string; timeframe: string; strategy: string; sessionFilter: string };
  assumptions: { spread: number; commissionPerLot: number; slippage: number };
  metrics: { totalTrades: number; winRate: number; profitFactor: number; netReturnPct: number; maxDrawdownPct: number; avgRR: number; expectancyR: number; sharpe: number };
  equityCurve: { time: number; equity: number }[];
  trades: { entryTime: number; direction: string; entry: number; exit: number; rMultiple: number; outcome: string; exitReason: string; session: string }[];
  monthly: { month: string; returnPct: number }[];
  walkForward: { segment: string; winRate: number; profitFactor: number; netReturnPct: number }[];
  notes: string[];
}

export function StrategyBacktester() {
  const strategies = useApi<{ strategies: { id: string; label: string }[] }>("/api/backtest", 0);
  const [params, setParams] = useState({ strategy: "ICT_LIQUIDITY_SWEEP", instrument: "GC1!", timeframe: "15m", sessionFilter: "ALL", days: 30, minRR: 3, riskPct: 1 });
  const [report, setReport] = useState<BacktestResp | null>(null);
  const [running, setRunning] = useState(false);
  const { post } = usePost<BacktestResp>();

  const run = async () => {
    setRunning(true);
    const r = await post("/api/backtest", params);
    setReport(r);
    setRunning(false);
  };

  const equity = useMemo(() => report?.equityCurve ?? [], [report]);

  return (
    <div className="space-y-4">
      <GlassPanel className="p-3">
        <div className="flex flex-wrap gap-2 items-center">
          <select value={params.strategy} onChange={(e) => setParams({ ...params, strategy: e.target.value })} className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
            {(strategies.data?.strategies ?? [{ id: "ICT_LIQUIDITY_SWEEP", label: "ICT Liquidity Sweep" }]).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={params.instrument} onChange={(e) => setParams({ ...params, instrument: e.target.value })} className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
            <option value="GC1!">GC1!</option><option value="XAUUSD">XAUUSD</option>
          </select>
          <select value={params.timeframe} onChange={(e) => setParams({ ...params, timeframe: e.target.value })} className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
            {["5m", "15m", "30m", "1h"].map((t) => <option key={t}>{t}</option>)}
          </select>
          <select value={params.sessionFilter} onChange={(e) => setParams({ ...params, sessionFilter: e.target.value })} className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
            {["ALL", "ASIAN", "LONDON", "NEW_YORK"].map((t) => <option key={t}>{t}</option>)}
          </select>
          <select value={params.days} onChange={(e) => setParams({ ...params, days: Number(e.target.value) })} className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
            {[14, 30, 60, 90, 180].map((t) => <option key={t} value={t}>{t} days</option>)}
          </select>
          <select value={params.minRR} onChange={(e) => setParams({ ...params, minRR: Number(e.target.value) })} className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
            {[2, 3, 4].map((t) => <option key={t} value={t}>min RR 1:{t}</option>)}
          </select>
          <select value={params.riskPct} onChange={(e) => setParams({ ...params, riskPct: Number(e.target.value) })} className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
            {[0.5, 1, 2].map((t) => <option key={t} value={t}>risk {t}%</option>)}
          </select>
          <button onClick={() => void run()} disabled={running}
            className="rounded-lg border border-white/25 bg-white/12 px-4 py-2 text-[11px] font-medium text-zinc-100 hover:bg-white/20 disabled:opacity-40">
            {running ? "Running…" : "Run backtest"}
          </button>
        </div>
      </GlassPanel>

      {!report ? (
        <GlassPanel className="p-8 text-center text-[12px] text-zinc-500">
          Select parameters and run a backtest. Signals use closed bars only; fills at next-bar open with spread, slippage and commission.
        </GlassPanel>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
            <StatCard label="Trades" value={report.metrics.totalTrades} />
            <StatCard label="Win rate" value={`${report.metrics.winRate}%`} />
            <StatCard label="Profit factor" value={report.metrics.profitFactor} />
            <StatCard label="Net return" value={`${report.metrics.netReturnPct}%`} />
            <StatCard label="Max DD" value={`${report.metrics.maxDrawdownPct}%`} />
            <StatCard label="Avg RR" value={report.metrics.avgRR} />
            <StatCard label="Expectancy (R)" value={report.metrics.expectancyR} />
            <StatCard label="Sharpe (est.)" value={report.metrics.sharpe} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <GlassPanel className="xl:col-span-2 p-4">
              <SectionTitle title="Equity curve" subtitle={`Assumptions: spread $${report.assumptions.spread}/oz · slippage $${report.assumptions.slippage}/oz · commission $${report.assumptions.commissionPerLot}/lot`} />
              {equity.length > 1 ? (
                <div className="h-44">
                  {(() => {
                    const eq = equity.map((p) => p.equity);
                    const min = Math.min(...eq), max = Math.max(...eq);
                    const range = max - min || 1;
                    const pts = eq.map((v, i) => `${(i / (eq.length - 1)) * 100},${100 - ((v - min) / range) * 92 - 4}`).join(" ");
                    return <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                      <polyline points={pts} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
                    </svg>;
                  })()}
                </div>
              ) : <p className="text-[11px] text-zinc-600 py-6 text-center">No trades generated in this window/strategy combination.</p>}
            </GlassPanel>
            <GlassPanel className="p-4" delay={0.05}>
              <SectionTitle title="Walk-forward segments" subtitle="Sequential quarters of the trade sequence" />
              <DataTable
                headers={["Seg", "Win %", "PF", "Net %"]}
                rows={report.walkForward.map((w) => [w.segment, `${w.winRate}%`, w.profitFactor, `${w.netReturnPct}%`])}
              />
              <div className="mt-2">
                <div className="text-[9px] uppercase tracking-widest text-zinc-600 mb-1">Notes</div>
                {report.notes.map((n, i) => <p key={i} className="text-[10px] text-zinc-500 leading-relaxed">· {n}</p>)}
              </div>
            </GlassPanel>
          </div>
          <GlassPanel className="p-4">
            <SectionTitle title="Trade list" subtitle={`${report.trades.length} trades`} />
            <div className="max-h-72 overflow-y-auto pr-1">
              <DataTable
                headers={["Entry (UTC)", "Dir", "In", "Out", "R", "Outcome", "Exit reason", "Session"]}
                rows={report.trades.slice(0, 60).map((t) => [
                  <span key="t" className="num">{new Date(t.entryTime * 1000).toISOString().slice(5, 16).replace("T", " ")}</span>,
                  <DirectionBadge key="d" dir={t.direction} />,
                  <span key="i" className="num">{t.entry}</span>,
                  <span key="o" className="num">{t.exit}</span>,
                  <span key="r" className="num">{t.rMultiple}</span>,
                  <StatusBadge key="s" status={t.outcome} />,
                  t.exitReason, t.session,
                ])}
              />
            </div>
          </GlassPanel>
        </>
      )}
      <Disclaimer />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function MarketReplay() {
  const [tf, setTf] = useState("15m");
  const [speed, setSpeed] = useState(400);
  const [cursor, setCursor] = useState(120);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const { data } = useApi<{ candles: Candle[]; source: string; status: string; asOf: string }>(
    `/api/market/candles?instrument=gc&tf=${tf}&limit=400`, 0,
  );

  const candles = data?.candles ?? [];
  const visible = candles.slice(0, cursor);
  const remaining = Math.max(0, candles.length - cursor);

  const play = () => {
    if (playing) {
      if (timer.current) clearInterval(timer.current);
      setPlaying(false);
      return;
    }
    setPlaying(true);
    timer.current = setInterval(() => {
      setCursor((c) => {
        if (c >= candles.length) {
          if (timer.current) clearInterval(timer.current);
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, speed);
  };

  return (
    <div className="space-y-4">
      <GlassPanel className="p-3">
        <div className="flex flex-wrap gap-2 items-center">
          {["5m", "15m", "1h"].map((t) => <Chip key={t} active={tf === t} onClick={() => { setTf(t); setCursor(120); }}>{t.toUpperCase()}</Chip>)}
          <span className="w-px h-5 bg-white/10 mx-1" />
          <button onClick={play} className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] text-zinc-100 hover:bg-white/20">
            {playing ? "Pause" : "Play"}
          </button>
          <button onClick={() => setCursor((c) => Math.max(20, c - 1))} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-white/10">◀ Step</button>
          <button onClick={() => setCursor((c) => Math.min(candles.length, c + 1))} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-white/10">Step ▶</button>
          <button onClick={() => setCursor(120)} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-white/10">Reset</button>
          <span className="w-px h-5 bg-white/10 mx-1" />
          <span className="text-[10px] text-zinc-600">Speed</span>
          {[900, 400, 150].map((s) => <Chip key={s} active={speed === s} onClick={() => setSpeed(s)}>{s === 900 ? "0.5×" : s === 400 ? "1×" : "3×"}</Chip>)}
          <input type="range" min={20} max={Math.max(candles.length, 21)} value={cursor} onChange={(e) => setCursor(Number(e.target.value))} className="w-40 accent-zinc-100" />
          <span className="text-[10px] num text-zinc-500">{cursor}/{candles.length} bars · {remaining} hidden</span>
        </div>
      </GlassPanel>

      <GlassPanel className="p-2">
        {!data ? <SkeletonBlock h={440} className="m-2" /> : visible.length > 2 ? (
          <PriceChart candles={visible} chartType="candles" height={440} precision={2} />
        ) : <SkeletonBlock h={440} className="m-2" />}
      </GlassPanel>

      <GlassPanel className="p-3">
        <p className="text-[10.5px] text-zinc-500">
          Hindsight-free practice: future candles are hidden below the cursor. The visible window is exactly what a trader
          would have seen at that moment — indicators and structure can be evaluated against subsequent bars by stepping forward.
          Data: <StatusBadge status={data?.status ?? "…"} /> {data?.source}
        </p>
      </GlassPanel>
    </div>
  );
}
