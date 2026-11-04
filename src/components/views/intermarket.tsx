"use client";

/**
 * Intermarket Analysis + COMEX Futures Intelligence.
 */
import { useApi } from "@/lib/hooks/useData";
import {
  GlassPanel, SectionTitle, StatCard, StatusBadge, SkeletonBlock,
  DataTable, KV, Disclaimer, DeltaCell,
} from "@/components/glass/primitives";
import { Spark } from "@/components/glass/primitives";

interface InterResp {
  correlationMatrix: { asset: string; value: number }[];
  rollingCorrelation: { asset: string; series: { time: number; value: number }[] }[];
  relativeStrength: { asset: string; goldVsAssetPct: number }[];
  divergences: { asset: string; kind: string | null; note: string }[];
  goldSilverRatio: { time: number; value: number }[];
  windowDays: number;
  note: string;
}

export function IntermarketAnalysis() {
  const { data } = useApi<InterResp>("/api/fundamental/intermarket?window=90", 120000);

  return (
    <div className="space-y-4">
      {!data ? <SkeletonBlock h={340} /> : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <GlassPanel className="p-4">
              <SectionTitle title="Correlation Matrix" subtitle={`Gold (GC1!) vs intermarkets — measured over ${data.windowDays} daily bars`} />
              <DataTable
                headers={["Asset", "Correlation", "Strength", "Expected"]}
                rows={data.correlationMatrix.map((c) => {
                  const strength = Math.abs(c.value);
                  const expected = c.asset === "DXY" || c.asset === "US 10Y Yield" || c.asset === "USD/INR" ? "inverse" : "positive";
                  const matches = (expected === "inverse" ? c.value < 0 : c.value > 0);
                  return [
                    c.asset,
                    <span key="v" className="num">{c.value.toFixed(2)}</span>,
                    <span key="s" className="inline-block w-16 h-1.5 rounded bg-zinc-800 overflow-hidden align-middle">
                      <span className="block h-full bg-zinc-300" style={{ width: `${strength * 100}%` }} />
                    </span>,
                    <span key="e" className={matches ? "text-zinc-500" : "text-zinc-200"}>{matches ? "as expected" : `inverted vs typical (${expected})`}</span>,
                  ];
                })}
              />
              <p className="text-[10px] text-zinc-600 mt-2">{data.note}</p>
            </GlassPanel>

            <GlassPanel className="p-4" delay={0.05}>
              <SectionTitle title="Relative Strength & Divergences" subtitle={`Gold performance vs each asset over the window (% differential)`} />
              <DataTable
                headers={["Asset", "Gold vs asset", "Divergence"]}
                rows={data.relativeStrength.map((r) => {
                  const div = data.divergences.find((d) => d.asset === r.asset);
                  return [
                    r.asset,
                    <DeltaCell key="v" value={r.goldVsAssetPct} />,
                    div?.kind ? <span key="d" className="text-zinc-200">{div.kind}</span> : <span key="d" className="text-zinc-600">none</span>,
                  ];
                })}
              />
              <div className="mt-2 space-y-1">
                {data.divergences.filter((d) => d.kind).map((d, i) => (
                  <p key={i} className="text-[10.5px] text-zinc-500">{d.note}</p>
                ))}
              </div>
            </GlassPanel>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <GlassPanel className="p-4">
              <SectionTitle title="Rolling 30-day Correlation" subtitle="Correlations drift — tracked explicitly, stability never assumed" />
              <div className="space-y-2">
                {data.rollingCorrelation.map((r) => (
                  <div key={r.asset}>
                    <div className="flex justify-between text-[10px] text-zinc-500 mb-0.5"><span>{r.asset}</span><span className="num">now {(r.series.at(-1)?.value ?? 0).toFixed(2)}</span></div>
                    <Spark data={r.series.map((p) => p.value)} height={22} />
                  </div>
                ))}
              </div>
            </GlassPanel>
            <GlassPanel className="p-4" delay={0.05}>
              <SectionTitle title="Gold / Silver Ratio" subtitle="120-day history" />
              {data.goldSilverRatio.length ? (
                <div>
                  <div className="text-lg font-semibold num text-zinc-50">{data.goldSilverRatio.at(-1)?.value}</div>
                  <Spark data={data.goldSilverRatio.map((p) => p.value)} height={90} className="mt-2" />
                </div>
              ) : <SkeletonBlock h={90} />}
              <div className="grid grid-cols-2 gap-x-6 mt-3">
                <KV k="USD/INR (Indian demand proxy)" v="see macro dashboard" mono={false} />
                <KV k="COT positioning" v="see COMEX Futures view" mono={false} />
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

interface CotResp {
  records: { reportDate: string; openInterestAll: number; nonCommLong: number; nonCommShort: number; nonCommNet: number; commLong: number; commShort: number; commNet: number; nonCommNetPctile: number | null }[];
  source: string;
  asOf: string;
}

export function ComexFutures() {
  const cot = useApi<CotResp>("/api/market/cot", 600000);
  const curve = useApi<{ contracts: { symbol: string; label: string; price: number | null }[]; source: string; status: string }>("/api/market/curve", 600000);
  const gc = useApi<{ price: number | null; status: string; source: string; asOf: string }>("/api/market/quote?instrument=gc", 20000);

  const latest = cot.data?.records?.[0];
  const prev = cot.data?.records?.[1];
  const basis = latest ? (latest.nonCommNet) : null;
  const basisChange = latest && prev ? latest.nonCommNet - prev.nonCommNet : null;
  const oiChange = latest && prev ? latest.openInterestAll - prev.openInterestAll : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="GC1! Front Month" value={gc.data?.price ?? "…"} status={gc.data?.status ?? "…"} sub={gc.data?.source} />
        <StatCard label="Non-Commercial Net" value={latest ? basis?.toLocaleString() : "…"} sub={latest ? `${latest.nonCommLong.toLocaleString()} long / ${latest.nonCommShort.toLocaleString()} short` : ""} status={latest ? "LIVE" : "…"} />
        <StatCard label="Weekly Positioning Δ" value={basisChange != null ? basisChange.toLocaleString() : "…"} sub={`Open interest Δ ${oiChange != null ? oiChange.toLocaleString() : "…"}`} />
        <StatCard label="Net Position Percentile" value={latest?.nonCommNetPctile != null ? `${latest.nonCommNetPctile}%` : "…"} sub={`vs ${cot.data?.records.length ?? 0} weeks of history`} status={latest ? "LIVE" : "…"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <GlassPanel className="p-4">
          <SectionTitle title="Futures Term Structure (COMEX GC)" subtitle="Individual contract months — contango/backwardation visible" right={curve.data ? <StatusBadge status={curve.data.status} /> : null} />
          {!curve.data ? <SkeletonBlock h={160} /> : (
            <div className="flex items-end gap-2 h-44">
              {curve.data.contracts.map((c, i) => {
                const prices = curve.data!.contracts.map((x) => x.price ?? 0).filter((x) => x > 0);
                const min = Math.min(...prices), max = Math.max(...prices);
                const h = 30 + ((c.price ?? min) - min) / ((max - min) || 1) * 100;
                return (
                  <div key={c.symbol} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[9px] num text-zinc-400">{c.price?.toFixed(1)}</span>
                    <div className="w-full rounded-t bg-gradient-to-t from-white/10 to-white/35" style={{ height: `${h}%` }} />
                    <span className="text-[8.5px] text-zinc-600">{c.label.split(" ")[0]}</span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-zinc-600 mt-2">{curve.data?.source} · rollover tracked per contract month; GC1! dataset remains separate from XAUUSD spot.</p>
        </GlassPanel>

        <GlassPanel className="p-4" delay={0.05}>
          <SectionTitle title="CFTC Commitments of Traders — GOLD" subtitle={cot.data?.source} right={<StatusBadge status={latest ? "LIVE" : "…"} />} />
          {!cot.data ? <SkeletonBlock h={160} /> : (
            <DataTable
              headers={["Report week", "Open interest", "Non-comm long", "Non-comm short", "Non-comm net", "Commercial net"]}
              rows={cot.data.records.slice(0, 10).map((r) => [
                <span key="d" className="num">{r.reportDate}</span>,
                <span key="o" className="num">{r.openInterestAll.toLocaleString()}</span>,
                <span key="l" className="num">{r.nonCommLong.toLocaleString()}</span>,
                <span key="s" className="num">{r.nonCommShort.toLocaleString()}</span>,
                <span key="n" className="num">{r.nonCommNet.toLocaleString()}</span>,
                <span key="c" className="num">{(r.commLong - r.commShort).toLocaleString()}</span>,
              ])}
            />
          )}
          <p className="text-[10px] text-zinc-600 mt-2">Reports are weekly (Fridays 15:30 ET). Commercial net = hedgers; non-commercial = managed money proxy.</p>
        </GlassPanel>
      </div>

      <GlassPanel className="p-4">
        <SectionTitle title="Options Analytics" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          <KV k="Implied volatility (GVZ)" v="UNAVAILABLE — requires licensed CME options feed" mono={false} />
          <KV k="Put/Call OI concentrations" v="UNAVAILABLE — options chain adapter documented in .env.example" mono={false} />
          <KV k="Skew" v="UNAVAILABLE" mono={false} />
          <KV k="Realized volatility proxy" v="See Volatility Intelligence (HV, ADR)" mono={false} />
        </div>
        <p className="text-[10px] text-zinc-600 mt-2">The platform indicates delayed or unavailable data explicitly rather than estimating it silently.</p>
      </GlassPanel>
      <Disclaimer />
    </div>
  );
}
