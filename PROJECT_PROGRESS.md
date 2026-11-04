# PROJECT_PROGRESS.md — GOLD INTELLIGENCE AI

Last updated: 2026-11-05 (build session)

## Completed modules

### Foundation & UI (Phase 1) — ✅
- Monochromatic transparent glassmorphism design system (`globals.css`): exact spec palette (#050505 / #0B0B0B / rgba(255,255,255,0.035) panels / #D4D4D8 silver), glass utilities (blur 18–24px, layered shadows, hairline borders), animated background (orbs, grid, sheen, noise), reduced-motion support.
- App shell: collapsible searchable sidebar (23 sections, grouped, ⌘K), top market ticker (live socket quotes + statuses + session), right AI intelligence panel, bottom info bar, toast system, mobile nav drawer, responsive layouts.
- Reusable glass primitives: panels, stat cards, badges (LIVE/DELAYED/DEMO/ESTIMATED/PROXY), probability bars, score meters, tables, sparklines, skeletons.

### Live market data (Phase 2) — ✅
- Provider adapters: Yahoo Finance (GC1! candles 1m→1M incl. resampled 3m/2h/4h, quotes, macro assets, news search + RSS fallback), gold-api.com (live spot XAU), Binance PAXG/USDT (labelled tokenized-gold proxy), Twelve Data (direct XAU/USD when keyed), CFTC COT, Finnhub (news/calendar when keyed), demo simulator (clearly labelled).
- TTL cache layer with Redis-compatible interface (driver swappable, documented).
- Instrument separation enforced: XAUUSD and GC1! never merged (separate quote + candle paths).
- socket.io stream service (port 3003): 10s quote broadcast for both instruments, price-alert evaluation, in-app + browser notifications.
- TradingView Lightweight Charts v5 workspace: candles/line/area/bars, 11 timeframes, volume, crosshair OHLC, overlay toggles (FVG, order blocks, liquidity, fib, VWAP, PDH/PDL·PWH/PWL, BOS/MSS markers), StrictMode-safe lifecycle.

### Fundamental intelligence (Phase 3) — ✅
- Live news pipeline (multi-query search → RSS fallback → Finnhub), dedupe, explainable rule-based gold-sentiment classification (15 rule families), importance tiers, persisted to DB.
- Economic calendar with countdown, impact levels, typical-reaction bands (explicitly labelled literature-based, not measured), ESTIMATED vs LIVE status.
- Macro dashboard: DXY, 10Y/2Y yields, silver, SPX, VIX, WTI, USD/INR with sparklines.
- Fundamental prediction engine: explainable factor model (DXY trend, yield momentum, VIX, news sentiment, Fed tone) with supporting/conflicting factors and event risks.

### Technical intelligence (Phase 4) — ✅
- Market structure engine: fractal swings with confirmation windows, trend, BOS/CHoCH/MSS (displacement-qualified), HH/HL/LH/LL labels, premium/discount/equilibrium, clustered S/R.
- Multi-timeframe confluence matrix (15m/1h/4h/1d).
- ICT/SMC scanner: FVG (+IFVG, displacement filter), order blocks/breakers/mitigation/rejection blocks, liquidity sweeps (reclaim + displacement flags), EQH/EQL, internal/external liquidity, OTE zones, displacement detection, Quasimodo (LS/head/RS/neckline/targets).
- Fibonacci intelligence (auto impulse-leg anchoring, full ratio set + extensions, OTE).
- VWAP family (daily/weekly/session/anchored) + standard deviation bands + volume profile (POC/VAH/VAL/HVN/LVN).

### Liquidity & order flow (Phase 5) — ✅
- Liquidity pools (BSL/SSL from swings, equal levels, PDH/PDL/PWH/PWL), nearest-pool targeting with strength scoring, sweep zones, consumed pools, reversal zones, explicit inference basis.
- Multi-timeframe liquidity heatmap (executed volume concentration + inferred pools, intensity filter, honest basis labelling).
- Order-flow engine: proxy aggressor split (labelled PROXY), delta, CVD, stacked imbalances, absorption, price/CVD divergence; footprint availability note (requires CME MDP3 feed).
- Session intelligence: 6 windows incl. killzones, session high/low/range, opening ranges, midnight open, historical session statistics.

### AI prediction systems (Phase 6) — ✅
- Technical engine: 6-horizon predictions, weighted explainable features, logistic probabilities, walk-forward calibration on loaded history (out-of-sample, no look-ahead), measured accuracy/Brier reported per prediction.
- Fundamental engine: independent factor model (as above).
- Market regime detector: 9 regimes with probabilities, evidence, transitions (manipulation candidate only via sweep+reclaim+displacement sequence).
- Historical pattern recognition: cosine-similarity k-NN with leakage guard, MFE/MAE/forward-return stats + 95% CI.
- Confluence engine: weighted merge of 8 evidence streams, bias/probabilities/score, agreement penalties, key risks, invalidation — never forces direction.
- Prediction lifecycle: stored in DB, auto-resolved against realized prices → Model Performance dashboard shows REAL measured metrics (accuracy, precision/recall/F1, Brier, log-loss, confusion matrix, calibration deciles, baselines, drift).

### Trading intelligence (Phase 7) — ✅
- Setup generator: sweep+FVG, OB retest, Quasimodo, OTE families with entry zone/confirmation/SL/TP1-3/RR/quality; configurable rules (min RR, MSS, sweep, displacement, FVG, HTF alignment, fundamental alignment, session filter, volatility guard); **NO VALID SETUP** state with failing reasons; persisted; never auto-executes.
- AI assistant: grounded chat over a live compact snapshot, timestamp citations, refusal semantics for unseen data, clean prose output.
- Smart alerts: 14 condition types, stream-service evaluation, in-app/browser channels (email/Telegram documented), live feed + toasts.
- Risk management: position sizing (oz/lots/tick value), RR calculator, daily loss-limit tracker, drawdown stats.
- Trade journal: full CRUD, ICT/SMC context fields, equity curve, performance analytics by session/setup/timeframe/instrument, monthly P/L.

### Research & optimization (Phase 8) — ✅
- Backtesting engine: 8 strategies, closed-bar signals + next-bar fills, spread/slippage/commission, conservative intrabar exits, walk-forward segments, equity curve, monthly returns, full trade list, persisted runs.
- Market replay: hindsight-free cursor, play/pause/step/speed/timeframe switching.
- Model evaluation: as above (Phase 6) — real, never simulated.

### Production (Phase 9) — ✅
- Security: single-user default account, password-hash field + role ready, API keys server-side only, input validation (pydantic + zod on ML side, route guards), Prisma parameterized queries.
- Deployment: Dockerfile (app), Dockerfile.ml (ML service), docker-compose (Postgres + Redis + ML + web, healthchecks), `.env.example` (all optional keys documented).
- Docs: README (architecture + honesty contract), docs/API.md, this file.
- Tests: 33 engine tests (bun test), 5 ML service tests (pytest).
- Monitoring: /api/health with per-provider reachability + cache stats.

## Incomplete / documented limitations (honest status)

| Item | Status | What's needed |
|---|---|---|
| True order-book depth & aggressor-tagged order flow | Adapter point documented; UI shows labelled proxies / UNAVAILABLE | Licensed CME MDP3 feed (e.g., Databento) — `DATABENTO_API_KEY` |
| Implied volatility (GVZ), options OI/skew | Shown as UNAVAILABLE | Licensed CME options data |
| Real economic calendar dates | ESTIMATED schedule (labelled) | `FINNHUB_API_KEY` or licensed calendar |
| Direct XAU/USD OHLC | Labelled PAXG proxy in use | `TWELVEDATA_API_KEY` (auto-activates) |
| Email/Telegram alert channels | Documented, not wired | `SMTP_URL` / `TELEGRAM_BOT_TOKEN` |
| ML service routing | Built + tested; app runs on TS engines | Set `ML_SERVICE_URL` in production |
| Authentication UI | Single-user mode; NextAuth v4 installed | User-facing auth flows if multi-user needed |

## API requirements (summary)
None required to run. Optional: TWELVEDATA_API_KEY, FINNHUB_API_KEY, FRED_API_KEY, DATABENTO_API_KEY, POLYGON_API_KEY, SMTP_URL, TELEGRAM_BOT_TOKEN, ML_SERVICE_URL. See `.env.example`.

## Bugs found & fixed during the build
1. `??`/`||` operator precedence syntax errors in ict.ts/backtest.ts — fixed with parentheses.
2. Sub-cent FVG zones collapsing after rounding — min-size filter added.
3. `db is not defined` in compute.ts ensureDefaultUser — import added.
4. Missing `useNow` import in page shell — fixed.
5. React StrictMode chart race (data bound to disposed chart instance) — versioned chart lifecycle in PriceChart.
6. Yahoo news search rate-limiting — RSS fallback added (30+ articles restored).
7. AI assistant echoing raw JSON snapshot — prompt restructured (compact snapshot + explicit no-JSON style contract).
8. Prisma query log noise in dev — log level reduced to warn/error.

## Next steps
1. Connect licensed feeds (Twelve Data / Databento / Finnhub) via `.env` — all adapters ready.
2. Enable email/Telegram alert channels.
3. Add NextAuth login flow if multi-user.
4. Longer-horizon walk-forward monitoring as predictions accumulate in DB (Model Performance fills in automatically).
5. Optional: Redis driver activation in `lib/server/cache.ts` for horizontal scaling (interface already matches).
