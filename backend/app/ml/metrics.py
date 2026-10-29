"""Chỉ số đánh giá dự báo.

Ký hiệu: y = giá trị thực, ŷ = dự báo, tập điểm đánh giá = (origin, bước) có y quan sát thực.
 - MAE  = mean |y - ŷ|
 - RMSE = sqrt(mean (y - ŷ)^2)
 - MAPE = 100 * mean |y - ŷ| / |y|, bỏ các điểm |y| < eps (eps = 5 % trung vị |y| của tập train)
 - sMAPE= 100 * mean 2|y - ŷ| / (|y| + |ŷ|)
 - MASE = MAE / Q, Q = MAE trong mẫu (tập train) của seasonal naive chu kỳ m (m=288 cho 5', 24 cho giờ)
          (Hyndman & Koehler 2006)
 - R²   = 1 - SSE / SST (SST quanh trung bình y của tập đánh giá)
 - coverage80 = tỉ lệ y nằm trong [q10, q90]

Hai kiểu tính cho horizon k: "cum" = gộp mọi bước 1..k; "point" = chỉ bước thứ k.
"""
from __future__ import annotations

import numpy as np


def mase_scale(train_values: np.ndarray, m: int) -> float:
    y = np.asarray(train_values, dtype="float64")
    d = np.abs(y[m:] - y[:-m])
    d = d[np.isfinite(d)]
    q = float(np.mean(d)) if len(d) else np.nan
    return q if q > 1e-12 else np.nan


def mape_eps(train_values: np.ndarray) -> float:
    y = np.abs(np.asarray(train_values, dtype="float64"))
    y = y[np.isfinite(y)]
    return max(1e-6, 0.05 * float(np.median(y))) if len(y) else 1e-6


def compute_metrics(y: np.ndarray, yhat: np.ndarray, lo: np.ndarray | None, hi: np.ndarray | None,
                    scale: float, eps: float) -> dict:
    y = np.asarray(y, dtype="float64").ravel()
    yhat = np.asarray(yhat, dtype="float64").ravel()
    m = np.isfinite(y) & np.isfinite(yhat)
    n = int(m.sum())
    if n == 0:
        return {"mae": None, "rmse": None, "mape": None, "smape": None, "mase": None,
                "r2": None, "coverage80": None, "n_eval": 0}
    yy, pp = y[m], yhat[m]
    err = yy - pp
    mae = float(np.mean(np.abs(err)))
    rmse = float(np.sqrt(np.mean(err ** 2)))
    mm = np.abs(yy) >= eps
    mape = float(100 * np.mean(np.abs(err[mm]) / np.abs(yy[mm]))) if mm.any() else None
    den = np.abs(yy) + np.abs(pp)
    sm = den > 1e-12
    smape = float(100 * np.mean(2 * np.abs(err[sm]) / den[sm])) if sm.any() else None
    sst = float(np.sum((yy - yy.mean()) ** 2))
    r2 = float(1 - np.sum(err ** 2) / sst) if sst > 1e-12 else None
    mase = float(mae / scale) if scale and np.isfinite(scale) else None
    cov = None
    if lo is not None and hi is not None:
        l = np.asarray(lo, dtype="float64").ravel()[m]
        h = np.asarray(hi, dtype="float64").ravel()[m]
        ok = np.isfinite(l) & np.isfinite(h)
        if ok.any():
            cov = float(np.mean((yy[ok] >= l[ok]) & (yy[ok] <= h[ok])))
    return {"mae": mae, "rmse": rmse, "mape": mape, "smape": smape, "mase": mase,
            "r2": r2, "coverage80": cov, "n_eval": n}


def _r(v, nd=6):
    return None if v is None else round(float(v), nd)


def evaluate_forecasts(actual: np.ndarray, preds: dict, horizons: dict, scales: dict, eps: dict,
                       targets: list[str], group: str) -> list[dict]:
    """actual: [n_origin, n_target, H]; preds[model] = dict(yhat, lo|None, hi|None) cùng shape.

    Trả về các dòng {model, group, target, horizon, steps, kind: cum|point, mae, ...}.
    """
    rows = []
    for model, p in preds.items():
        for j, t in enumerate(targets):
            for hk, k in horizons.items():
                for kind in ("cum", "point"):
                    sl = slice(0, k) if kind == "cum" else slice(k - 1, k)
                    lo = p.get("lo")
                    hi = p.get("hi")
                    met = compute_metrics(
                        actual[:, j, sl], p["yhat"][:, j, sl],
                        None if lo is None else lo[:, j, sl], None if hi is None else hi[:, j, sl],
                        scales[t], eps[t],
                    )
                    rows.append({"model": model, "group": group, "target": t, "horizon": hk, "steps": k,
                                 "kind": kind, **{kk: (_r(v) if kk != "n_eval" else v) for kk, v in met.items()}})
    return rows


def best_models(rows: list[dict], kind: str = "cum") -> dict:
    """best[target][horizon] = model có MASE thấp nhất (kiểu kind)."""
    best: dict = {}
    for r in rows:
        if r["kind"] != kind or r["mase"] is None:
            continue
        cur = best.setdefault(r["target"], {}).get(r["horizon"])
        if cur is None or r["mase"] < cur["mase"]:
            best[r["target"]][r["horizon"]] = {"model": r["model"], "mase": r["mase"]}
    return best

