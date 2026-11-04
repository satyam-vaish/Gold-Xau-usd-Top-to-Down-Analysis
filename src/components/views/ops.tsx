"use client";

/**
 * Smart Alerts, Risk Management, Model Performance, Settings.
 */
import { useEffect, useState } from "react";
import { useApi, useLiveQuotes, usePost, useNow } from "@/lib/hooks/useData";
import {
  Chip, GlassPanel, SectionTitle, StatCard, StatusBadge, SkeletonBlock,
  DataTable, KV, Disclaimer, DirectionBadge,
} from "@/components/glass/primitives";

// ---------------------------------------------------------------------------

const ALERT_KINDS = [
  { kind: "PRICE_LEVEL", label: "Price reaches level", needsPrice: true },
  { kind: "BSL_SWEEP", label: "Buy-side liquidity sweep" },
  { kind: "SSL_SWEEP", label: "Sell-side liquidity sweep" },
  { kind: "BULLISH_MSS", label: "Bullish MSS" },
  { kind: "BEARISH_MSS", label: "Bearish MSS" },
  { kind: "FVG_FORMED", label: "FVG formation" },
  { kind: "OB_RETEST", label: "Order block retest" },
  { kind: "QM_FORMED", label: "Quasimodo formation" },
  { kind: "BUY_PRESSURE", label: "Buyer pressure threshold", needsThreshold: true },
  { kind: "SELL_PRESSURE", label: "Seller pressure threshold", needsThreshold: true },
  { kind: "CVD_DIVERGENCE", label: "CVD divergence" },
  { kind: "VOL_EXPANSION", label: "Volatility expansion" },
  { kind: "NEWS_APPROACH", label: "Major news approaching" },
  { kind: "SETUP_GENERATED", label: "AI trade setup generated" },
];

export function SmartAlerts() {
  const { data } = useApi<{ alerts: { id: string; kind: string; instrument: string; params: string; channels: string; active: boolean; lastFiredAt: string | null; events: { message: string; createdAt: string }[] }[] }>("/api/alerts", 15000);
  const { post } = usePost<{ alert: { id: string } }>();
  const { alertEvents } = useLiveQuotes();
  const toasts = alertEvents.map((a) => ({ message: a.message, time: a.time }));
  const [kind, setKind] = useState("PRICE_LEVEL");
  const [instrument, setInstrument] = useState("XAUUSD");
  const [price, setPrice] = useState("");
  const [threshold, setThreshold] = useState("3");
  const [browserAllowed, setBrowserAllowed] = useState(false);

  const selected = ALERT_KINDS.find((a) => a.kind === kind);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled && typeof Notification !== "undefined") {
        setBrowserAllowed(Notification.permission === "granted");
      }
    });
    return () => { cancelled = true; };
  }, []);

  const create = async () => {
    const params: Record<string, unknown> = {};
    if (selected?.needsPrice && price) params.price = Number(price);
    if (selected?.needsThreshold) params.thresholdPct = Number(threshold);
    await post("/api/alerts", { kind, instrument, params, channels: ["in_app", ...(browserAllowed ? ["browser"] : [])] });
  };

  const askBrowser = async () => {
    if (typeof Notification !== "undefined") {
      const p = await Notification.requestPermission();
      setBrowserAllowed(p === "granted");
    }
  };

  const toggle = async (id: string, active: boolean) => {
    await fetch("/api/alerts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, active }) });
  };
  const remove = async (id: string) => {
    await fetch(`/api/alerts?id=${id}`, { method: "DELETE" });
  };

  // browser notifications for live events
  useEffect(() => {
    for (const t of toasts.slice(0, 1)) {
      if (browserAllowed && typeof Notification !== "undefined") {
        try { new Notification("GOLD INTELLIGENCE AI", { body: t.message }); } catch { /* ignore */ }
      }
    }
  }, [toasts, browserAllowed]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <GlassPanel className="p-4">
          <SectionTitle title="Create alert" subtitle="Evaluated by the stream service every 10 seconds (in-app + browser)" />
          <div className="space-y-2">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
              {ALERT_KINDS.map((a) => <option key={a.kind} value={a.kind}>{a.label}</option>)}
            </select>
            <select value={instrument} onChange={(e) => setInstrument(e.target.value)} className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200">
              <option>XAUUSD</option><option>GC1!</option>
            </select>
            {selected?.needsPrice && (
              <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price level" inputMode="decimal"
                className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200 placeholder:text-zinc-600 num" />
            )}
            {selected?.needsThreshold && (
              <input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Threshold %" inputMode="decimal"
                className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200 placeholder:text-zinc-600 num" />
            )}
            <div className="flex items-center gap-2">
              <Chip active={browserAllowed} onClick={() => void askBrowser()}>Browser notifications {browserAllowed ? "on" : "off"}</Chip>
            </div>
            <button onClick={() => void create()} className="w-full rounded-lg border border-white/20 bg-white/10 py-2 text-[11px] font-medium text-zinc-100 hover:bg-white/20">
              Create alert
            </button>
            <p className="text-[9.5px] text-zinc-600">Email & Telegram channels activate with SMTP_URL / TELEGRAM_BOT_TOKEN in the environment (documented in .env.example).</p>
          </div>
        </GlassPanel>

        <GlassPanel className="xl:col-span-2 p-4" delay={0.05}>
          <SectionTitle title="Active alerts" subtitle={`${(data?.alerts ?? []).filter((a) => a.active).length} active`} />
          <div className="max-h-64 overflow-y-auto pr-1">
            <DataTable
              headers={["Kind", "Instrument", "Params", "Channels", "State", "Last fired", ""]}
              rows={(data?.alerts ?? []).map((a) => [
                a.kind.replace(/_/g, " "),
                a.instrument,
                a.params,
                (JSON.parse(a.channels) as string[]).join(", "),
                <button key="t" onClick={() => void toggle(a.id, !a.active)}><StatusBadge status={a.active ? "ACTIVE" : "PAUSED"} /></button>,
                a.lastFiredAt ? new Date(a.lastFiredAt).toISOString().slice(5, 16).replace("T", " ") : "—",
                <button key="d" onClick={() => void remove(a.id)} className="text-[10px] text-zinc-600 hover:text-zinc-300">delete</button>,
              ])}
            />
          </div>
        </GlassPanel>
      </div>

      <GlassPanel className="p-4">
        <SectionTitle title="Live alert feed" subtitle="Fired by the stream service — in-app channel" />
        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
          {toasts.length === 0 && <p className="text-[11px] text-zinc-600">No alert events yet. Create an alert above; events appear here in real time.</p>}
          {toasts.map((t, i) => (
            <div key={i} className="glass-subtle p-2.5 flex items-start justify-between gap-3">
              <span className="text-[11.5px] text-zinc-200">{t.message}</span>
              <span className="text-[9px] num text-zinc-600 shrink-0">{t.time.slice(11, 19)} UTC</span>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface SettingsResp {
  settings: { accountBalance: number; accountCurrency: string; riskPerTradePercent: number; dailyLossLimit: number; defaultInstrument: string; defaultTimeframe: string; chartType: string } | null;
}

export function RiskManagement() {
  const { data, mutate } = useApi<SettingsResp>("/api/settings", 0);
  const stats = useApi<{ totals: { totalPnl: number; winRate: number | null; closed: number } }>("/api/journal/stats", 60000);
  const { quotes } = useLiveQuotes();
  const [form, setForm] = useState({ entry: "", stop: "", target: "" });
  const [balanceOverride, setBalanceOverride] = useState<string | null>(null);
  const [riskOverride, setRiskOverride] = useState<string | null>(null);
  const now = useNow(1000);

  const balanceStr = balanceOverride ?? (data?.settings ? String(data.settings.accountBalance) : "");
  const riskStr = riskOverride ?? (data?.settings ? String(data.settings.riskPerTradePercent) : "1");

  const balance = Number(balanceStr) || 0;
  const riskPct = Number(riskStr) || 0;
  const entry = Number(form.entry) || 0;
  const stop = Number(form.stop) || 0;
  const target = Number(form.target) || 0;
  const riskAmount = balance * (riskPct / 100);
  const stopDist = Math.abs(entry - stop);
  const size = stopDist > 0 ? riskAmount / stopDist : 0; // oz
  const rewardAmount = target ? Math.abs(target - entry) * size : 0;
  const rr = stopDist ? Math.abs(target - entry) / stopDist : 0;
  const contractSize = 100; // 100 oz per GC contract / standard lot
  const lots = size / contractSize;
  const tickValue = contractSize; // $1 per 0.01 move per 100oz... $1 per tick ($0.01) => $1
  const dailyPnl = stats.data?.totals.totalPnl ?? 0;
  const dailyLossLimit = data?.settings?.dailyLossLimit ?? 3;
  const lossLimitAmount = balance * (dailyLossLimit / 100);
  const lossUsed = Math.max(0, -dailyPnl);
  const lossUsedPct = lossLimitAmount ? (lossUsed / lossLimitAmount) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <GlassPanel className="p-4">
          <SectionTitle title="Position size calculator" subtitle={`GC/XAU contract: ${contractSize} oz per lot · tick $0.01 = $1 per lot`} />
          <div className="grid grid-cols-2 gap-2 mb-3">
            <input value={balanceStr} onChange={(e) => setBalanceOverride(e.target.value)} placeholder="Account balance" inputMode="decimal" className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200 num placeholder:text-zinc-600" />
            <input value={riskStr} onChange={(e) => setRiskOverride(e.target.value)} placeholder="Risk %" inputMode="decimal" className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200 num placeholder:text-zinc-600" />
            <input value={form.entry} onChange={(e) => setForm({ ...form, entry: e.target.value })} placeholder="Entry" inputMode="decimal" className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200 num placeholder:text-zinc-600" />
            <input value={form.stop} onChange={(e) => setForm({ ...form, stop: e.target.value })} placeholder="Stop loss" inputMode="decimal" className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200 num placeholder:text-zinc-600" />
            <input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="Take profit" inputMode="decimal" className="bg-white/[0.04] border border-white/10 rounded-lg px-2 py-2 text-[11px] text-zinc-200 num placeholder:text-zinc-600" />
          </div>
          <div className="grid grid-cols-2 gap-x-6">
            <KV k="Risk amount" v={`$${riskAmount.toFixed(2)}`} />
            <KV k="Stop distance" v={stopDist ? stopDist.toFixed(2) : "—"} />
            <KV k="Position size" v={`${size.toFixed(2)} oz`} />
            <KV k="Contracts / lots" v={lots.toFixed(2)} />
            <KV k="Tick value (per lot)" v={`$${tickValue}`} />
            <KV k="Potential reward" v={rewardAmount ? `$${rewardAmount.toFixed(2)}` : "—"} />
            <KV k="Risk : Reward" v={rr ? `1 : ${rr.toFixed(2)}` : "—"} />
            <KV k="Potential loss" v={stopDist ? `$${(stopDist * size).toFixed(2)}` : "—"} />
          </div>
        </GlassPanel>

        <div className="space-y-3">
          <GlassPanel className="p-4" delay={0.05}>
            <SectionTitle title="Daily loss limit tracker" subtitle={`Limit ${dailyLossLimit}% of balance (${lossLimitAmount ? `$${lossLimitAmount.toFixed(0)}` : "—"})`} />
            <div className="h-2.5 rounded-full bg-zinc-800 overflow-hidden mb-2">
              <div className="h-full bg-gradient-to-r from-zinc-400 to-zinc-100" style={{ width: `${Math.min(100, lossUsedPct)}%` }} />
            </div>
            <KV k="Realized P/L (journal)" v={`$${dailyPnl.toFixed(2)}`} />
            <KV k="Limit used" v={`${lossUsedPct.toFixed(1)}%`} />
            <KV k="Status" v={lossUsedPct >= 100 ? "LIMIT HIT — stop trading" : lossUsedPct >= 70 ? "Warning: approaching limit" : "Within limits"} mono={false} />
          </GlassPanel>
          <GlassPanel className="p-4" delay={0.1}>
            <SectionTitle title="Account settings" />
            <div className="flex flex-wrap gap-2 items-center">
              <Chip active={(data?.settings?.defaultInstrument ?? "XAUUSD") === "XAUUSD"}>Default: XAUUSD</Chip>
              <Chip active={(data?.settings?.defaultInstrument ?? "") === "GC1!"}>Default: GC1!</Chip>
              <span className="text-[10px] text-zinc-500 num" suppressHydrationWarning>live XAU {quotes["XAUUSD"]?.price ?? "…"} · {now ? now.toISOString().slice(11, 19) : "--:--:--"} UTC</span>
            </div>
            <p className="text-[10px] text-zinc-600 mt-2">Balance, risk % and loss limits persist to the database (Settings view allows edits). {stats.data?.totals.closed ?? 0} closed journal trades feed the trackers.</p>
            <button onClick={() => void mutate()} className="mt-2 text-[10px] text-zinc-500 hover:text-zinc-300">refresh</button>
          </GlassPanel>
        </div>
      </div>
      <Disclaimer />
    </div>
  );
}

// ---------------------------------------------------------------------------

interface PerfResp {
  technical: { samples: number; directionalAccuracy: number | null; precision: number | null; recall: number | null; f1: number | null; brier: number | null; logLoss: number | null; confusion: { tp: number; fp: number; tn: number; fn: number } | null; calibration: { bin: string; predicted: number; actual: number; count: number }[]; baseline: { alwaysBullAccuracy: number | null }; note: string };
  fundamental: { samples: number; directionalAccuracy: number | null; brier: number | null; note: string };
  technicalByHorizon: { horizon: string; samples: number; directionalAccuracy: number | null }[];
  drift: { older: number; newer: number; delta: number; samples: number } | null;
  pending: number;
  note: string;
}

export function ModelPerformance() {
  const { data } = useApi<PerfResp>("/api/performance", 60000);

  return (
    <div className="space-y-4">
      <GlassPanel className="p-3">
        <p className="text-[10.5px] text-zinc-500 leading-relaxed">{data?.note ?? "Model performance is measured exclusively from stored predictions resolved against realized prices."}</p>
      </GlassPanel>
      {!data ? <SkeletonBlock h={300} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
            <StatCard label="Tech. accuracy" value={data.technical.directionalAccuracy != null ? `${data.technical.directionalAccuracy}%` : "—"} sub={`${data.technical.samples} resolved`} />
            <StatCard label="Tech. precision" value={data.technical.precision != null ? data.technical.precision : "—"} />
            <StatCard label="Tech. recall" value={data.technical.recall != null ? data.technical.recall : "—"} />
            <StatCard label="Tech. F1" value={data.technical.f1 != null ? data.technical.f1 : "—"} />
            <StatCard label="Brier score" value={data.technical.brier ?? "—"} sub="lower = better calibrated" />
            <StatCard label="Log loss" value={data.technical.logLoss ?? "—"} />
            <StatCard label="Baseline (always-bull)" value={data.technical.baseline.alwaysBullAccuracy != null ? `${data.technical.baseline.alwaysBullAccuracy}%` : "—"} />
            <StatCard label="Pending" value={data.pending} sub="awaiting horizon" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <GlassPanel className="p-4">
              <SectionTitle title="Confusion matrix (technical)" />
              {data.technical.confusion ? (
                <div className="grid grid-cols-2 gap-2 max-w-[240px]">
                  <div className="glass-subtle p-3 text-center"><div className="text-[9px] text-zinc-500 uppercase">True bullish</div><div className="text-lg num text-zinc-100">{data.technical.confusion.tp}</div></div>
                  <div className="glass-subtle p-3 text-center"><div className="text-[9px] text-zinc-500 uppercase">False bullish</div><div className="text-lg num text-zinc-400">{data.technical.confusion.fp}</div></div>
                  <div className="glass-subtle p-3 text-center"><div className="text-[9px] text-zinc-500 uppercase">False bearish</div><div className="text-lg num text-zinc-400">{data.technical.confusion.fn}</div></div>
                  <div className="glass-subtle p-3 text-center"><div className="text-[9px] text-zinc-500 uppercase">True bearish</div><div className="text-lg num text-zinc-100">{data.technical.confusion.tn}</div></div>
                </div>
              ) : <p className="text-[11px] text-zinc-600">Resolves as predictions reach their horizons.</p>}
            </GlassPanel>
            <GlassPanel className="p-4" delay={0.05}>
              <SectionTitle title="Calibration curve (deciles)" subtitle="Predicted vs realized bull frequency" />
              <div className="space-y-1.5">
                {data.technical.calibration.filter((b) => b.count > 0).map((b) => (
                  <div key={b.bin}>
                    <div className="flex justify-between text-[9px] text-zinc-500"><span>{b.bin}</span><span className="num">{(b.actual * 100).toFixed(0)}% actual</span></div>
                    <div className="relative h-1.5 rounded bg-zinc-800 overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-zinc-600" style={{ width: `${b.predicted * 100}%` }} />
                      <div className="absolute inset-y-0 left-0 bg-zinc-100" style={{ width: `${b.actual * 100}%`, opacity: 0.85 }} />
                    </div>
                  </div>
                ))}
                {data.technical.calibration.every((b) => b.count === 0) && <p className="text-[11px] text-zinc-600">No resolved predictions yet.</p>}
              </div>
            </GlassPanel>
            <GlassPanel className="p-4" delay={0.1}>
              <SectionTitle title="Drift & horizons" />
              {data.drift ? (
                <div className="mb-2">
                  <KV k="Older-half accuracy" v={`${data.drift.older}%`} />
                  <KV k="Newer-half accuracy" v={`${data.drift.newer}%`} />
                  <KV k="Δ (drift)" v={`${data.drift.delta > 0 ? "+" : ""}${data.drift.delta}pp`} />
                </div>
              ) : <p className="text-[11px] text-zinc-600 mb-2">Drift becomes measurable after ~8 resolved 1h predictions.</p>}
              <DataTable
                headers={["Horizon", "Accuracy", "N"]}
                rows={data.technicalByHorizon.map((h) => [h.horizon, h.directionalAccuracy != null ? `${h.directionalAccuracy}%` : "—", h.samples])}
              />
              <div className="mt-2">
                <KV k="Fundamental engine" v={data.fundamental.directionalAccuracy != null ? `${data.fundamental.directionalAccuracy}% (${data.fundamental.samples})` : "no resolved samples yet"} />
              </div>
            </GlassPanel>
          </div>
        </>
      )}
      <Disclaimer />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SettingsView() {
  const { data, mutate } = useApi<SettingsResp & { settings: Record<string, unknown> | null }>("/api/settings", 0);
  const health = useApi<{ providers: Record<string, { configured: boolean; reachable: boolean | null; note: string }>; cache: { driver: string }; disclaimer: string }>("/api/health", 30000);
  const [saving, setSaving] = useState(false);
  const s = data?.settings;

  const patch = async (updates: Record<string, unknown>) => {
    setSaving(true);
    await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
    await mutate();
    setSaving(false);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
      <GlassPanel className="p-4">
        <SectionTitle title="Trading defaults" subtitle={saving ? "saving…" : undefined} />
        {s ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <Chip active={s.defaultInstrument === "XAUUSD"} onClick={() => void patch({ defaultInstrument: "XAUUSD" })}>Default XAUUSD</Chip>
              <Chip active={s.defaultInstrument === "GC1!"} onClick={() => void patch({ defaultInstrument: "GC1!" })}>Default GC1!</Chip>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["candles", "line", "area", "bars"].map((c) => (
                <Chip key={c} active={s.chartType === c} onClick={() => void patch({ chartType: c })}>{c}</Chip>
              ))}
            </div>
            <KV k="Account balance" v={`$${Number(s.accountBalance).toLocaleString()}`} />
            <KV k="Risk per trade" v={`${s.riskPerTradePercent}%`} />
            <KV k="Daily loss limit" v={`${s.dailyLossLimit}%`} />
            <KV k="Min RR (setup gate)" v={`1:${s.minRiskReward ?? 3}`} />
            <p className="text-[10px] text-zinc-600">Numeric fields are managed through the Risk view inputs and POST endpoints; all values persist in the database.</p>
          </div>
        ) : <SkeletonBlock h={160} />}
      </GlassPanel>

      <GlassPanel className="p-4" delay={0.05}>
        <SectionTitle title="Data providers & health" subtitle={health.data?.cache.driver} />
        <div className="space-y-2">
          {Object.entries(health.data?.providers ?? {}).map(([name, p]) => (
            <div key={name} className="glass-subtle p-2.5 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11.5px] text-zinc-200">{name}</div>
                <div className="text-[9.5px] text-zinc-600">{p.note}</div>
              </div>
              <div className="flex gap-1.5 items-center shrink-0">
                <StatusBadge status={p.configured ? (p.reachable === false ? "UNAVAILABLE" : p.reachable ? "LIVE" : "READY") : "NOT CONFIGURED"} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-zinc-600 mt-3">{health.data?.disclaimer}</p>
      </GlassPanel>
    </div>
  );
}
