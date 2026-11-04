"""
GOLD INTELLIGENCE AI — ML microservice (FastAPI).

Optional deployment (spec §2 AI/ML stack). Provides heavier ML workloads that
benefit from the Python scientific stack:

  POST /ml/patterns       — k-NN historical pattern recognition (sklearn)
  POST /ml/calibrate      — logistic-regression probability calibration
  POST /ml/backtest-metrics — Sharpe / Sortino / drawdown analytics
  GET  /ml/health

INTEGRATION: the Next.js platform ships equivalent TypeScript engines and runs
fully standalone. Set ML_SERVICE_URL in the frontend environment to route
pattern/calibration calls to this service; when unset or unreachable the app
uses the built-in engines and labels outputs accordingly.

Run:  uvicorn app.main:app --port 8085
"""
from __future__ import annotations

import math
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

try:  # scientific stack (soft requirement — pure-numpy fallbacks below)
    from sklearn.linear_model import LogisticRegression
    from sklearn.neighbors import NearestNeighbors

    SKLEARN = True
except Exception:  # pragma: no cover
    SKLEARN = False

app = FastAPI(title="GOLD INTELLIGENCE AI — ML Service", version="1.0.0")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class Candle(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: Optional[float] = None


class PatternRequest(BaseModel):
    candles: list[Candle] = Field(..., description="Chronological OHLCV candles")
    fingerprint_bars: int = 24
    horizon_bars: int = 24
    top_k: int = 12
    similarity_gate: float = 0.965


class PatternResponse(BaseModel):
    engine: str
    comparables: int
    bullish_pct: float
    bearish_pct: float
    avg_move_pct: float
    ci95: tuple
    matches: list


class CalibrateRequest(BaseModel):
    candles: list[Candle]
    horizon_bars: int = 12
    step: int = 6


class CalibrateResponse(BaseModel):
    engine: str
    accuracy: float
    brier: float
    log_loss: float
    samples: int
    note: str


class EquityRequest(BaseModel):
    equity: list[float]
    returns_per_bar: Optional[list] = None


class EquityResponse(BaseModel):
    total_return_pct: float
    max_drawdown_pct: float
    sharpe: float
    sortino: float
    calmar: float


# ---------------------------------------------------------------------------
# Feature engineering (mirrors the TS engine so results are comparable)
# ---------------------------------------------------------------------------

def fingerprint_matrix(candles: list, L: int):
    """Row i = fingerprint of the L bars ending at candle i (inclusive)."""
    o = np.array([c.open for c in candles])
    h = np.array([c.high for c in candles])
    l = np.array([c.low for c in candles])
    c = np.array([c.close for c in candles])
    rng = np.maximum(h - l, 1e-9)
    feats = []
    ends = []
    for i in range(L - 1, len(candles)):
        seg = slice(i - L + 1, i + 1)
        rets = np.log(c[seg][1:] / c[seg][:-1]) * 100.0
        body = ((c[seg][1:] - o[seg][1:]) / rng[seg][1:]) * 0.5
        up_w = ((h[seg][1:] - np.maximum(o[seg][1:], c[seg][1:])) / rng[seg][1:]) * 0.3
        lo_w = ((np.minimum(o[seg][1:], c[seg][1:]) - l[seg][1:]) / rng[seg][1:]) * 0.3
        vec = np.concatenate([rets, body, up_w, lo_w])
        norm = np.linalg.norm(vec) or 1.0
        feats.append(vec / norm)
        ends.append(i)
    return np.array(feats), np.array(ends)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/ml/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "gold-intelligence-ml",
        "sklearn": SKLEARN,
        "note": "Optional ML microservice. The Next.js app runs without it (TS engine fallbacks).",
    }


@app.post("/ml/patterns", response_model=PatternResponse)
def patterns(req: PatternRequest) -> PatternResponse:
    candles = req.candles
    L = req.fingerprint_bars
    H = req.horizon_bars
    if len(candles) < L + H + 100:
        raise HTTPException(400, f"need >= {L + H + 100} candles, got {len(candles)}")

    X, ends = fingerprint_matrix(candles, L)
    query = X[-1]
    search_end = len(candles) - H  # leakage guard: exclude query's forward window

    mask = ends[:-1] < search_end
    X_search = X[:-1][mask]
    ends_search = ends[:-1][mask]

    if len(X_search) < 20:
        raise HTTPException(400, "insufficient search space after leakage guard")

    closes = np.array([c.close for c in candles])
    highs = np.array([c.high for c in candles])
    lows = np.array([c.low for c in candles])

    matches: list = []
    if SKLEARN:
        k = min(req.top_k * 6, len(X_search))
        nn = NearestNeighbors(n_neighbors=k, metric="cosine").fit(X_search)
        dist, idx = nn.kneighbors(query.reshape(1, -1))
        sims = 1.0 - dist[0]
        for sim, j in zip(sims, idx[0]):
            if sim < req.similarity_gate:
                continue
            i = int(ends_search[j])
            base = closes[i - 1]
            fwd = slice(i, i + H)
            matches.append({
                "start_time": int(candles[i - L].time),
                "end_time": int(candles[i - 1].time),
                "similarity": round(float(sim), 4),
                "forward_return_pct": round(float((closes[i + H - 1] - base) / base * 100), 3),
                "mfe_pct": round(float((highs[fwd].max() - base) / base * 100), 3),
                "mae_pct": round(float((base - lows[fwd].min()) / base * 100), 3),
            })
    else:
        for j in range(len(X_search)):
            sim = float(np.dot(query, X_search[j]))
            if sim < req.similarity_gate:
                continue
            i = int(ends_search[j])
            base = closes[i - 1]
            fwd = slice(i, i + H)
            matches.append({
                "start_time": int(candles[i - L].time),
                "end_time": int(candles[i - 1].time),
                "similarity": round(sim, 4),
                "forward_return_pct": round(float((closes[i + H - 1] - base) / base * 100), 3),
                "mfe_pct": round(float((highs[fwd].max() - base) / base * 100), 3),
                "mae_pct": round(float((base - lows[fwd].min()) / base * 100), 3),
            })

    matches.sort(key=lambda m: -m["similarity"])
    top = matches[: req.top_k]
    if not top:
        raise HTTPException(404, "no historical window passed the similarity gate")
    moves = [m["forward_return_pct"] for m in top]
    n = len(moves)
    mean = float(np.mean(moves))
    sd = float(np.std(moves, ddof=1)) if n > 1 else 0.0
    ci = 1.96 * sd / math.sqrt(n)
    return PatternResponse(
        engine="sklearn-knn" if SKLEARN else "numpy-knn",
        comparables=len(matches),
        bullish_pct=round(100 * sum(1 for m in moves if m > 0.05) / n, 1),
        bearish_pct=round(100 * sum(1 for m in moves if m < -0.05) / n, 1),
        avg_move_pct=round(mean, 3),
        ci95=(round(mean - ci, 3), round(mean + ci, 3)),
        matches=top,
    )


@app.post("/ml/calibrate", response_model=CalibrateResponse)
def calibrate(req: CalibrateRequest) -> CalibrateResponse:
    """Walk-forward calibration of the technical scoring model.

    For each t: features from data <= t, label = sign of move t -> t+H.
    The model is fit ONCE on the first half of the timeline and evaluated
    out-of-sample on the second half (strict temporal split — no leakage).
    """
    candles = req.candles
    H = req.horizon_bars
    if len(candles) < 200 + H:
        raise HTTPException(400, "insufficient history for calibration")
    c = np.array([x.close for x in candles])
    o = np.array([x.open for x in candles])
    h = np.array([x.high for x in candles])
    l = np.array([x.low for x in candles])

    def features(i: int) -> np.ndarray:
        seg = c[max(0, i - 60):i + 1]
        e20 = seg[-20:].mean()
        e50 = seg[-50:].mean() if len(seg) >= 50 else seg.mean()
        slope = (e20 - seg[-25]) / c[i] * 250 if len(seg) > 25 else 0.0
        roc = (c[i] - c[i - 12]) / c[i - 12] * 100
        hi = h[max(0, i - 40):i + 1].max()
        lo = l[max(0, i - 40):i + 1].min()
        pos = (c[i] - lo) / max(hi - lo, 1e-9)
        body = sum((c[j] - o[j]) / max(h[j] - l[j], 1e-9) for j in range(max(1, i - 5), i + 1))
        return np.array([slope / 3, roc / 2, (0.5 - pos) * 1.6, body / 3])

    rows_X, rows_y = [], []
    for i in range(70, len(candles) - H, req.step):
        move = (c[i + H] - c[i]) / c[i] * 100
        if abs(move) < 0.02:
            continue
        rows_X.append(features(i))
        rows_y.append(1 if move > 0 else 0)
    if len(rows_X) < 30:
        raise HTTPException(400, "not enough evaluable points")

    split = len(rows_X) // 2
    Xtr, Xte = np.array(rows_X[:split]), np.array(rows_X[split:])
    ytr, yte = np.array(rows_y[:split]), np.array(rows_y[split:])

    if SKLEARN and len(np.unique(ytr)) == 2:
        model = LogisticRegression(max_iter=200).fit(Xtr, ytr)
        p = model.predict_proba(Xte)[:, 1]
        engine = "sklearn-logreg"
    else:
        # transparent heuristic logistic on the weighted score
        w = np.array([0.3, 0.25, 0.25, 0.2])
        p = 1 / (1 + np.exp(-(Xte @ w) * 2.2))
        engine = "heuristic-logistic"

    acc = float(((p > 0.5).astype(int) == yte).mean() * 100)
    brier = float(np.mean((p - yte) ** 2))
    eps = 1e-9
    ll = float(np.mean(-(yte * np.log(p + eps) + (1 - yte) * np.log(1 - p + eps))))
    return CalibrateResponse(
        engine=engine,
        accuracy=round(acc, 2),
        brier=round(brier, 4),
        log_loss=round(ll, 4),
        samples=int(len(yte)),
        note="Temporal-split out-of-sample evaluation (train=past, test=future). Accuracy is measured, never claimed.",
    )


@app.post("/ml/backtest-metrics", response_model=EquityResponse)
def backtest_metrics(req: EquityRequest) -> EquityResponse:
    eq = np.array(req.equity, dtype=float)
    if len(eq) < 3:
        raise HTTPException(400, "need at least 3 equity points")
    rets = np.diff(eq) / eq[:-1]
    if req.returns_per_bar:
        rets = np.array(req.returns_per_bar, dtype=float)
    peak = np.maximum.accumulate(eq)
    dd = (peak - eq) / peak
    max_dd = float(dd.max())
    mean_r = float(rets.mean())
    sd = float(rets.std(ddof=1)) if len(rets) > 1 else 1e-9
    downside = rets[rets < 0]
    dsd = float(downside.std(ddof=1)) if len(downside) > 1 else 1e-9
    ann = math.sqrt(252 * 96)  # 15m-bar annualization assumption, documented
    sharpe = mean_r / sd * ann if sd > 0 else 0.0
    sortino = mean_r / dsd * ann if dsd > 0 else 0.0
    total = (eq[-1] / eq[0] - 1) * 100
    return EquityResponse(
        total_return_pct=round(float(total), 2),
        max_drawdown_pct=round(max_dd * 100, 2),
        sharpe=round(float(sharpe), 2),
        sortino=round(float(sortino), 2),
        calmar=round(float(total) / (max_dd * 100), 2) if max_dd > 0 else 0.0,
    )
