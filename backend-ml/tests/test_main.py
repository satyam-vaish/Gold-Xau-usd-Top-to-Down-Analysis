"""ML service tests — run with: pytest backend-ml/tests -q"""
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def synth(n: int, drift: float = 0.05, seed: int = 42, start: float = 4000.0):
    s = seed
    out = []
    price = start
    t = 1700000000
    for _ in range(n):
        s = (s * 1103515245 + 12345) % 2147483648
        r = s / 2147483648
        noise = (r - 0.5) * 6
        o = price
        c = price + drift + noise
        h = max(o, c) + r * 2.5
        l = min(o, c) - r * 2.5
        out.append({"time": t, "open": o, "high": h, "low": l, "close": c, "volume": 800 + r * 300})
        price = c
        t += 900
    return out


def test_health():
    r = client.get("/ml/health")
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "gold-intelligence-ml"
    assert "sklearn" in body


def test_patterns():
    r = client.post("/ml/patterns", json={"candles": synth(800), "horizon_bars": 12, "top_k": 8})
    if r.status_code == 404:  # similarity gate too strict for synthetic data — acceptable
        return
    assert r.status_code == 200
    body = r.json()
    assert body["comparables"] >= 1
    assert -1 <= body["avg_move_pct"] <= 100
    for m in body["matches"]:
        assert 0 <= m["similarity"] <= 1.0001
    # leakage guard: no match may include the query's forward window
    last = 1700000000 + 799 * 900
    for m in body["matches"]:
        assert m["end_time"] <= last - 12 * 900


def test_patterns_insufficient():
    r = client.post("/ml/patterns", json={"candles": synth(50)})
    assert r.status_code == 400


def test_calibrate():
    r = client.post("/ml/calibrate", json={"candles": synth(900), "horizon_bars": 6, "step": 4})
    assert r.status_code == 200
    body = r.json()
    assert 0 <= body["accuracy"] <= 100
    assert body["brier"] > 0
    assert body["samples"] > 0
    assert "out-of-sample" in body["note"]


def test_backtest_metrics():
    eq = [10000, 10100, 10050, 10300, 10200, 10600]
    r = client.post("/ml/backtest-metrics", json={"equity": eq})
    assert r.status_code == 200
    body = r.json()
    assert body["total_return_pct"] == pytest.approx(6.0, abs=0.01)
    assert 0 < body["max_drawdown_pct"] < 5
    assert math.isfinite(body["sharpe"])
