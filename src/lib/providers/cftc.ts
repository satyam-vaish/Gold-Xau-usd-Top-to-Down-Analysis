/**
 * CFTC Commitments of Traders — official public Socrata API
 * (publicreporting.cftc.gov). Legacy futures-only report for GOLD.
 * Real, free, keyless data. Reports are weekly (released Fridays 15:30 ET).
 */
export interface CotRecord {
  reportDate: string;
  openInterestAll: number;
  nonCommLong: number;
  nonCommShort: number;
  nonCommNet: number;
  commLong: number;
  commShort: number;
  commNet: number;
  nonCommNetPctile: number | null; // percentile vs loaded history
}

const DATASET = "6dca-aqww"; // CFTC Legacy Futures Only reports

export async function fetchCotGold(weeks = 60): Promise<{ records: CotRecord[]; source: string; asOf: string }> {
  const url = `https://publicreporting.cftc.gov/resource/${DATASET}.json?$limit=${weeks}&$order=report_date_as_yyyy_mm_dd%20DESC&$where=upper(commodity_name)%20like%20%27%25GOLD%25%27%20AND%20cftc_contract_market_code=%27088691%27`;
  const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CFTC status ${res.status}`);
  const rows = (await res.json()) as Record<string, string>[];
  if (!rows.length) throw new Error("CFTC returned no rows");

  const parsed = rows.map((r) => ({
    reportDate: (r.report_date_as_yyyy_mm_dd ?? "").slice(0, 10),
    openInterestAll: +(r.open_interest_all ?? 0),
    nonCommLong: +(r.noncomm_positions_long_all ?? 0),
    nonCommShort: +(r.noncomm_positions_short_all ?? 0),
    commLong: +(r.comm_positions_long_all ?? 0),
    commShort: +(r.comm_positions_short_all ?? 0),
  })).filter((r) => r.reportDate);

  const withNet = parsed.map((r) => ({
    ...r,
    nonCommNet: r.nonCommLong - r.nonCommShort,
    commNet: r.commLong - r.commShort,
  }));
  // percentile of the most recent net position vs history (ascending)
  const latest = withNet[0];
  const nets = withNet.map((r) => r.nonCommNet);
  const pctile = +((nets.filter((n) => n <= latest.nonCommNet).length / nets.length) * 100).toFixed(0);
  const records = withNet.map((r, i) => ({
    ...r,
    nonCommNetPctile: i === 0 ? pctile : null,
  }));

  return {
    records,
    source: "CFTC public reporting (Legacy Futures Only, GOLD 088691)",
    asOf: new Date().toISOString(),
  };
}
