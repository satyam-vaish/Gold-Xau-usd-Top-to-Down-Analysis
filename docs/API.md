# GOLD INTELLIGENCE AI — API Reference

Base URL: `/api` · All responses JSON. Errors: `{ "error": "message" }` with 4xx/5xx.

## Market (`/api/market/[action]`)

| Endpoint | Description |
|---|---|
| `GET /market/ticker` | XAUUSD + GC1! quotes, day change, session, market status, server time |
| `GET /market/quote?instrument=XAUUSD\|gc` | Single-instrument quote with source + status |
| `GET /market/candles?instrument=&tf=1m…1M&limit=` | OHLCV (`{candles[], source, status, asOf, note?}`) |
| `GET /market/overview` | 8 dashboard cards (spot, futures, DXY, 10Y, 2Y, silver, realized vol, news sentiment) |
| `GET /market/macro` | DXY/yields/silver/SPX/VIX/WTI/USDINR assets + 30d sparklines |
| `GET /market/curve` | COMEX term structure from individual contract months |
| `GET /market/cot` | CFTC Commitments of Traders (GOLD 088691), weekly records + net percentile |

## Analysis (`/api/analysis/[action]?instrument=&tf=`)

| Endpoint | Description |
|---|---|
| `GET /analysis/full` | Entire bundle: structures (15m/1h/4h/1d), MTF alignment, ICT scan, liquidity report, sessions+stats, openings, volatility, order flow, regime, patterns, fib, VWAP bands, volume profile, heatmap |
| `GET /analysis/heatmap` | Liquidity heatmap levels (executed volume + inferred) |
| `GET /analysis/patterns` | Historical k-NN pattern report (leakage-guarded) |
| `GET /analysis/overlay` | Candles + every chart overlay payload (FVG/OB/pools/fib/VWAP/PDH-PDL/structure events) |

## Fundamental (`/api/fundamental/[action]`)

| Endpoint | Description |
|---|---|
| `GET /fundamental/news` | Classified live news (Yahoo search→RSS, Finnhub when keyed) + aggregate sentiment |
| `GET /fundamental/calendar` | Economic calendar with countdowns, impact, typical-reaction bands (labelled) |
| `GET /fundamental/macro` | Macro dashboard assets |
| `GET /fundamental/intermarket?window=90` | Correlation matrix, rolling correlations, relative strength, divergences, Au/Ag ratio |

## AI (`/api/ai/[action]`, `/api/chat`)

| Endpoint | Description |
|---|---|
| `GET /ai/predictions?instrument=` | Technical (6 horizons) + fundamental predictions, walk-forward calibration stats; persists for evaluation |
| `GET /ai/confluence?instrument=` | Master confluence output (bias, score, probabilities, evidence, levels, risks, invalidation) |
| `GET /ai/setups?instrument=` | Setup scan with user rules (from DB settings) |
| `POST /ai/setups?instrument=` | Re-scan with custom rule overrides (body: partial SetupRules) |
| `POST /chat` | AI assistant. Body: `{message, history?, instrument?}` → grounded answer + snapshot time + sources |

## Trading lab

| Endpoint | Description |
|---|---|
| `GET/POST/PATCH/DELETE /journal` | Trade journal CRUD (`DELETE ?id=`) |
| `GET /journal/stats` | Win rate, PF, expectancy, max DD, equity curve, by-session/setup/timeframe/instrument, monthly |
| `GET/POST/PATCH/DELETE /alerts` | Alert CRUD; `POST` body `{kind, instrument, params, channels}` |
| `GET /alerts/events` | Recent fired alert events |
| `GET/POST /backtest` | Strategy list + saved runs / run backtest `{instrument, timeframe, strategy, sessionFilter, days, minRR, riskPct}` |
| `GET /performance` | Model evaluation (accuracy/precision/recall/F1/Brier/log-loss/confusion/calibration/baselines/drift) from resolved predictions |
| `GET/PATCH /settings` | User settings (instrument defaults, rules, risk params) |
| `GET /health` | Provider health, cache stats, market status, disclaimer |

## Real-time (socket.io)

Connect: `io("/?XTransformPort=3003", { path: "/" })`

| Event | Payload |
|---|---|
| `quote` (server→client) | `{instrument, price, direction, prev, status, source, time}` every 10s |
| `alert` (server→client) | `{alertId, kind, instrument, message, time, channels}` |
| `subscribe` (client→server) | `{instruments: ["XAUUSD","GC1!"]}` |
| `ping`/`pong` | latency probe |
