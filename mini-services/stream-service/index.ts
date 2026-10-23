/**
 * GOLD INTELLIGENCE AI — Stream service (socket.io, port 3003)
 * Authoritative real-time quote streaming and alert evaluation.
 * - Real Gold Spot (XAUUSD) via Twelve Data (if keyed) or gold-api.com bullion pricing
 * - COMEX Gold Futures (GC1!) via CME / Yahoo Finance
 * - Consistent, high-frequency, authentic prices without crypto-token discrepancy
 */
import { createServer } from "http";
import { Server } from "socket.io";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const PORT = 3003;

const httpServer = createServer();
const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 30000,
  pingInterval: 15000,
});

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
let lastXau: number | null = null;
let lastGc: number | null = null;
let lastXauSource = "gold-api.com (spot)";
let lastXauStatus = "LIVE";

async function fetchJson(url: string, timeout = 4000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

let lastTdPoll = 0;
let lastTdPrice: number | null = null;

async function pollXau(): Promise<number | null> {
  const now = Date.now();
  // 1. If user configured Twelve Data API Key, use direct institutional spot (rate-limit safe)
  const tdKey = process.env.TWELVEDATA_API_KEY;
  if (tdKey) {
    if (now - lastTdPoll < 8000 && lastTdPrice !== null) {
      return lastTdPrice;
    }
    try {
      const j = (await fetchJson(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${tdKey}`, 3500)) as { price?: string };
      if (j.price) {
        lastXauSource = "Twelve Data (Real XAU/USD Spot)";
        lastXauStatus = "LIVE";
        lastTdPrice = +parseFloat(j.price).toFixed(2);
        lastTdPoll = now;
        return lastTdPrice;
      }
    } catch {}
  }

  // 2. Authoritative real spot gold price from gold-api.com
  try {
    const j = (await fetchJson("https://api.gold-api.com/price/XAU", 3500)) as { price?: number; updatedAt?: string };
    if (typeof j.price === "number" && j.price > 0) {
      lastXauSource = "gold-api.com (spot gold)";
      lastXauStatus = "LIVE";
      return +j.price.toFixed(2);
    }
  } catch {}

  return lastTdPrice ?? null;
}

async function pollGc(): Promise<number | null> {
  try {
    const j = (await fetchJson("https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d", 3500)) as {
      chart: { result?: { meta: { regularMarketPrice?: number } }[] };
    };
    const p = j.chart.result?.[0]?.meta.regularMarketPrice;
    return typeof p === "number" && p > 0 ? +p.toFixed(2) : null;
  } catch {
    return null;
  }
}

type AlertRow = { id: string; kind: string; instrument: string; params: string; channels: string };
const evaluated = new Map<string, number>();

async function evaluateAlerts(xau: number | null, gc: number | null) {
  try {
    const alerts: AlertRow[] = await db.alert.findMany({ where: { active: true } });
    for (const a of alerts) {
      const price = a.instrument === "GC1!" ? gc : xau;
      if (!price) continue;
      const params = JSON.parse(a.params || "{}") as { price?: number; thresholdPct?: number };
      const cooldown = 5 * 60000;
      const last = evaluated.get(a.id) ?? 0;
      if (Date.now() - last < cooldown) continue;

      let fired: string | null = null;
      if (a.kind === "PRICE_LEVEL" && params.price) {
        if (Math.abs(price - params.price) / price < 0.0008) fired = `${a.instrument} reached ${params.price} (now ${price})`;
      } else if (a.kind === "BUY_PRESSURE" || a.kind === "SELL_PRESSURE") {
        const thr = (params.thresholdPct ?? 3) / 100;
        const move = (price - (lastXau ?? price)) / (lastXau || price);
        if (a.kind === "BUY_PRESSURE" && move > thr * 0.3) fired = `${a.instrument} moving up sharply (${(move * 100).toFixed(2)}% in 30s) — buyer pressure proxy`;
        if (a.kind === "SELL_PRESSURE" && move < -thr * 0.3) fired = `${a.instrument} moving down sharply (${(move * 100).toFixed(2)}% in 30s) — seller pressure proxy`;
      }
      if (fired) {
        evaluated.set(a.id, Date.now());
        await db.alertEvent.create({ data: { alertId: a.id, message: fired, payload: JSON.stringify({ price }) } });
        io.emit("alert", { alertId: a.id, kind: a.kind, instrument: a.instrument, message: fired, time: new Date().toISOString(), channels: JSON.parse(a.channels || '["in_app"]') });
      }
    }
  } catch (e) {
    console.error("alert eval error", e);
  }
}

async function tick() {
  const [xau, gc] = await Promise.all([pollXau(), pollGc()]);
  const now = Date.now();

  if (xau !== null && xau > 0) {
    const direction = lastXau === null ? 0 : Math.sign(xau - lastXau);
    io.emit("quote", {
      instrument: "XAUUSD",
      price: xau,
      direction,
      prev: lastXau,
      status: lastXauStatus,
      source: lastXauSource,
      time: new Date(now).toISOString(),
    });
    lastXau = xau;
  }

  if (gc !== null && gc > 0) {
    const direction = lastGc === null ? 0 : Math.sign(gc - lastGc);
    io.emit("quote", {
      instrument: "GC1!",
      price: gc,
      direction,
      prev: lastGc,
      status: "DELAYED",
      source: "Yahoo Finance (GC=F)",
      time: new Date(now).toISOString(),
    });
    lastGc = gc;
  }

  if (xau || gc) await evaluateAlerts(xau, gc);
}

io.on("connection", (socket) => {
  console.log(`client connected: ${socket.id}`);
  socket.emit("connected", { message: "GOLD INTELLIGENCE stream connected", time: new Date().toISOString() });

  // Push immediate authoritative quotes to eliminate connection latency
  if (lastXau !== null) {
    socket.emit("quote", {
      instrument: "XAUUSD",
      price: lastXau,
      direction: 0,
      prev: lastXau,
      status: lastXauStatus,
      source: lastXauSource,
      time: new Date().toISOString(),
    });
  }
  if (lastGc !== null) {
    socket.emit("quote", {
      instrument: "GC1!",
      price: lastGc,
      direction: 0,
      prev: lastGc,
      status: "DELAYED",
      source: "Yahoo Finance (GC=F)",
      time: new Date().toISOString(),
    });
  }

  socket.on("subscribe", (data: { instruments?: string[] }) => {
    socket.emit("subscribed", { instruments: data?.instruments ?? ["XAUUSD", "GC1!"] });
  });

  socket.on("ping", (cb?: (t: number) => void) => {
    if (typeof cb === "function") cb(Date.now());
  });
});

let ticking = false;
// Poll every 2 seconds for real gold quotes
setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    await tick();
  } catch (e) {
    console.error("tick error", e);
  } finally {
    ticking = false;
  }
}, 2000);

// Kick off immediately
tick().catch(() => {});

httpServer.listen(PORT, () => {
  console.log(`GOLD INTELLIGENCE stream service listening on :${PORT}`);
});
