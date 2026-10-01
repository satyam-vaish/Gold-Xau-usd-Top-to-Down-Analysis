# GOLD INTELLIGENCE AI

**Understand the Market. Decode Liquidity. Predict with Intelligence.**

An institutional-grade AI market intelligence & prediction platform for Gold — **XAUUSD (spot)** and **GC1! (COMEX front-month futures)** — built as a production-quality full-stack application.

> ⚠️ **Disclaimer:** AI outputs are analytical estimates, not guaranteed financial advice. Data statuses (`LIVE / DELAYED / DEMO / ESTIMATED / PROXY`) are labelled on every module. The platform never fabricates prices, order-book depth, news or accuracy figures.

---

## What's inside

| Area | Highlights |
|---|---|
| **Design** | Monochromatic transparent glassmorphism (black/silver/graphite), animated background, Framer Motion, reduced-motion support, responsive |
| **Market data** | Provider-independent adapter layer: Yahoo (GC=F futures, DXY, yields, silver, VIX…), gold-api.com (live spot), Binance PAXG (labelled tokenized-gold proxy), Twelve Data (direct XAU/USD when keyed), CFTC COT, Finnhub (news/calendar when keyed), Yahoo RSS news |
| **Engines (TypeScript)** | Market structure (BOS/CHoCH/MSS, HH/HL/LH/LL, premium/discount), ICT/SMC scanner (FVG/IFVG, OB/Breaker/Mitigation/Rejection, sweeps, EQH/EQL, OTE, Quasimodo), liquidity pools & heatmap, sessions & killzones, volatility (ATR/ADR/AWR/HV), order-flow (proxy delta/CVD), regime classifier, k-NN historical patterns, confluence, setup generator, event-driven backtester (no look-ahead), model evaluation |
| **Real-time** | socket.io stream service (quotes every 10s, alert evaluation, in-app + browser notifications) |
| **AI** | Explainable fundamental (factor model) & technical (walk-forward calibrated scoring) prediction engines — kept independent; grounded conversational assistant; self-measuring model performance dashboard |
| **Trading lab** | Trade journal with equity curve & performance analytics, strategy backtester (8 strategies, costs & walk-forward), hindsight-free market replay, smart alerts, risk calculator |
| **Persistence** | Prisma + SQLite (dev) / PostgreSQL (prod) — 17 models; Redis-compatible cache layer |
| **ML service** | Optional FastAPI microservice (`backend-ml/`) — sklearn k-NN patterns, logistic calibration, risk metrics; the app degrades gracefully to built-in engines |

## Quick start (dev)

```bash
bun install
bun run db:push        # create SQLite schema
bun run dev            # http://localhost:3000  (auto-managed in the sandbox)
# stream service (separate terminal):
cd mini-services/stream-service && bun run dev   # socket.io :3003
```

## Production

```bash
cp .env.example .env   # fill keys (all optional; see inside)
docker compose up -d --build
```

The compose stack provisions PostgreSQL, Redis, the ML service and the app. `DATABASE_URL` can point to Postgres — the Prisma schema is portable.

## API keys

The app is fully functional **without any keys** (fallbacks are labelled):

| Key | Effect when set |
|---|---|
| `TWELVEDATA_API_KEY` | Direct XAU/USD spot OHLC replaces the labelled PAXG proxy |
| `FINNHUB_API_KEY` | Licensed news + verified economic calendar (LIVE instead of ESTIMATED) |
| `FRED_API_KEY` | Real yields / inflation-expectation series for the macro dashboard |
| `ML_SERVICE_URL` | Route pattern/calibration to the FastAPI ML service |
| `SMTP_URL` / `TELEGRAM_BOT_TOKEN` | Email / Telegram alert channels |

## Data honesty contract

- XAUUSD and GC1! datasets are **never merged** (spec rule).
- Liquidity is **inferred from price action** and labelled as such — the platform does not claim to see resting stop orders or real order-book depth; the heatmap shows `EXECUTED + INFERRED`.
- Order-flow buy/sell splits are an **OHLCV proxy** (labelled `PROXY`) unless an aggressor feed is connected.
- Prediction probabilities come from a deterministic scoring model **walk-forward calibrated on loaded history**; the Model Performance dashboard reports only **measured** out-of-sample accuracy from stored predictions resolved against realized prices — empty until real samples exist.
- The backtester uses closed-bar signals, next-bar fills, spread/slippage/commission, and includes walk-forward segments.
- The setup generator returns **NO VALID SETUP** (with failing reasons) when rules are not satisfied; trades are never auto-executed.

## Structure

```
src/
  app/page.tsx                 # application shell (23 sections, client-routed)
  app/api/                     # market / analysis / fundamental / ai / chat / journal / alerts / backtest / performance / health
  lib/engines/                 # 16 pure-TS analytics engines (+ types)
  lib/providers/               # yahoo, goldapi, binance, twelvedata, finnhub, cftc, demo adapters
  lib/server/                  # cache (Redis-ready), aggregation, news, calendar, prediction lifecycle
  components/{glass,charts,layout,views}
mini-services/stream-service/  # socket.io realtime (port 3003)
backend-ml/                    # optional FastAPI ML microservice (+ pytest)
prisma/schema.prisma           # 17 models, PostgreSQL-portable
tests/engines.test.ts          # 33 engine tests (bun test)
docs/API.md                    # API reference
PROJECT_PROGRESS.md            # development log
```

## Verification

```bash
bun run lint          # ESLint clean
bun test              # 33 engine tests
cd backend-ml && python -m pytest tests -q   # 5 ML tests
```
