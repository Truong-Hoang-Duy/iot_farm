"""Pipeline huấn luyện + đánh giá rolling-origin + huấn luyện lại trên toàn bộ dữ liệu.

Chạy:  cd backend && .venv\\Scripts\\python.exe -m app.ml.train [--quick] [--source json|influx|auto]
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import platform
import shutil
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C
from . import data as D
from . import metrics as MT
from .cards import model_cards
from .windows import FeatureBase, actuals_for, make_contexts

log = logging.getLogger("ml.train")


# --------------------------------------------------------------------------- status / logging
class Status:
    def __init__(self, quick: bool):
        self.d = {"state": "running", "stage": "init", "progress": 0.0, "quick": quick, "pid": os.getpid(),
                  "started_at": _now(), "updated_at": _now(), "message": "", "error": None}
        self.write()

    def update(self, stage: str | None = None, progress: float | None = None, message: str | None = None, **kw):
        if stage is not None:
            self.d["stage"] = stage
        if progress is not None:
            self.d["progress"] = round(float(progress), 3)
        if message is not None:
            self.d["message"] = message
            log.info("[%s] %s", self.d["stage"], message)
        self.d.update(kw)
        self.d["updated_at"] = _now()
        self.write()

    def write(self):
        C.ensure_dirs()
        tmp = C.TRAIN_STATUS_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.d, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, C.TRAIN_STATUS_PATH)


def _now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def setup_logging():
    C.ensure_dirs()
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for h in list(root.handlers):
        root.removeHandler(h)
    fh = logging.FileHandler(C.TRAIN_LOG_PATH, mode="w", encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(fh)
    root.addHandler(sh)
    for noisy in ("pytorch_lightning", "lightning", "lightning.pytorch", "lightning_fabric"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


class GPUMonitor(threading.Thread):
    """Lấy mẫu nvidia-smi mỗi 2 s làm bằng chứng sử dụng GPU."""

    def __init__(self):
        super().__init__(daemon=True)
        self.samples: list[tuple[float, float, float]] = []
        self.stop_evt = threading.Event()
        self.ok = shutil.which("nvidia-smi") is not None
        self.stage = "init"
        self.by_stage: dict = {}

    def run(self):
        while self.ok and not self.stop_evt.is_set():
            try:
                out = subprocess.run(
                    ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=5).stdout.strip().splitlines()[0]
                u, m = [float(x) for x in out.split(",")]
                self.samples.append((time.time(), u, m))
                st = self.by_stage.setdefault(self.stage, {"max_util": 0.0, "max_mem_mb": 0.0, "n": 0, "sum_util": 0.0})
                st["max_util"] = max(st["max_util"], u)
                st["max_mem_mb"] = max(st["max_mem_mb"], m)
                st["n"] += 1
                st["sum_util"] += u
            except Exception:  # noqa: BLE001
                pass
            self.stop_evt.wait(2.0)

    def summary(self) -> dict:
        if not self.samples:
            return {"available": self.ok, "n_samples": 0}
        u = np.array([s[1] for s in self.samples])
        m = np.array([s[2] for s in self.samples])
        stages = {k: {"max_util_pct": v["max_util"], "mean_util_pct": round(v["sum_util"] / max(v["n"], 1), 1),
                      "max_mem_used_mb": v["max_mem_mb"], "n_samples": v["n"]} for k, v in self.by_stage.items()}
        return {"available": True, "n_samples": len(u), "max_util_pct": float(u.max()),
                "mean_util_pct": round(float(u.mean()), 1), "max_mem_used_mb": float(m.max()), "by_stage": stages}


# --------------------------------------------------------------------------- helpers
def library_versions() -> dict:
    out = {"python": platform.python_version()}
    for mod in ("torch", "neuralforecast", "xgboost", "chronos", "pandas", "numpy", "sklearn", "scipy",
                "pytorch_lightning", "transformers"):
        try:
            m = __import__(mod)
            out[mod] = getattr(m, "__version__", None)
            if out[mod] is None and mod == "chronos":
                from importlib.metadata import version
                out[mod] = version("chronos-forecasting")
        except Exception:  # noqa: BLE001
            out[mod] = None
    return out


def compute_splits(index: pd.DatetimeIndex) -> dict:
    start = index.min().normalize()
    end = index.max()
    n_days = math.ceil((end - start) / pd.Timedelta(days=1))
    train_end = start + pd.Timedelta(days=math.floor(n_days * C.SPLIT["train"]))
    val_end = start + pd.Timedelta(days=math.floor(n_days * (C.SPLIT["train"] + C.SPLIT["val"])))
    assert start < train_end < val_end < end
    return {"start": start, "train_end": train_end, "val_end": val_end, "end": end, "n_days": n_days}


def test_origins(gd_values: pd.DataFrame, group: str, val_end: pd.Timestamp, end: pd.Timestamp) -> pd.DatetimeIndex:
    cfg = C.GROUPS[group]
    step = pd.Timedelta(minutes=cfg["resolution_minutes"])
    every = step * cfg["origin_every_steps"]
    last = end - (cfg["H"] - 1) * step
    return pd.date_range(val_end, last, freq=every)


def leakage_perturbation_test(Y: np.ndarray, W, group: str, rng) -> dict:
    """Đặc trưng XGBoost phải KHÔNG đổi khi thay đổi mọi giá trị sau origin."""
    H = C.GROUPS[group]["H"]
    L = 600 if group == "short" else 400
    T = len(Y)
    i0s = rng.integers(L, T - H - 1, size=5)
    max_diff = 0.0
    for i0 in i0s:
        h = np.arange(1, H + 1)
        ii = np.full(H, i0)
        hour0 = np.zeros(H)
        X1, _ = FeatureBase(Y, W, group).features(ii, h, 3, hour0)
        Y2 = Y.copy()
        Y2[i0 + 1:] = rng.normal(1000, 500, size=Y2[i0 + 1:].shape)
        X2, names = FeatureBase(Y2, W, group).features(ii, h, 3, hour0)
        same = np.array_equal(X1, X2, equal_nan=True)
        d = np.abs(X1 - X2)
        d = d[np.isfinite(d)]
        max_diff = max(max_diff, float(d.max()) if len(d) else 0.0, 0.0 if same else float("inf"))
    assert max_diff == 0.0, f"leakage detected in XGBoost features (max diff {max_diff})"
    return {"passed": True, "n_origins_tested": int(len(i0s)), "max_feature_diff": max_diff,
            "note": "post-origin target values replaced by noise; features unchanged (weather-at-target excluded from Y perturbation by design: it is an assumed-known future covariate)"}


def sample_test_predictions(group: str, ctx, actual: np.ndarray, preds: dict, n_samples: int = 8) -> dict:
    cfg = C.GROUPS[group]
    H = cfg["H"]
    N = len(ctx.origins)
    hist_len = min(ctx.L, 2 * H)
    sel = np.unique(np.linspace(0, N - 1, min(n_samples, N)).round().astype(int))
    out = {}
    for j, t in enumerate(C.TARGETS):
        samples = []
        for i in sel:
            past = ctx.past_index(i)[-hist_len:]
            fut = ctx.future_index(i)
            hist = [{"t": ts.isoformat(), "v": _f(v)} for ts, v in zip(past, ctx.Y[i, -hist_len:, j])]
            act = [{"t": ts.isoformat(), "v": _f(v)} for ts, v in zip(fut, actual[i, j])]
            fcs = {}
            for mk, p in preds.items():
                fcs[mk] = [{"t": ts.isoformat(), "yhat": _f(p["yhat"][i, j, k]),
                            "lo": _f(p["lo"][i, j, k]) if p.get("lo") is not None else None,
                            "hi": _f(p["hi"][i, j, k]) if p.get("hi") is not None else None}
                           for k, ts in enumerate(fut)]
            samples.append({"origin": ctx.origins[i].isoformat(), "history": hist, "actual": act, "forecasts": fcs})
        out[t] = {"group": group, "target": t, "unit": C.UNITS[t], "resolution_minutes": cfg["resolution_minutes"],
                  "models": list(preds.keys()), "samples": samples}
    return out


def _f(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return round(v, 4) if np.isfinite(v) else None


def _free_gpu():
    try:
        import gc

        import torch

        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # noqa: BLE001
        pass


# --------------------------------------------------------------------------- main pipeline
def run(quick: bool = False, source: str | None = None, groups=("short", "long"), model_keys=None) -> dict:
    from .lstm_direct import LSTMDirectForecaster
    from .models import (ChronosForecaster, GroupData, NaiveForecaster, NeuralForecaster,
                         SeasonalNaiveForecaster, XGBForecaster, gpu_info, torch_device)

    setup_logging()
    C.ensure_dirs()
    st = Status(quick)
    mon = GPUMonitor()
    mon.start()
    t_start = time.time()
    np.random.seed(C.SEED)
    try:
        import torch

        torch.manual_seed(C.SEED)
    except Exception:  # noqa: BLE001
        pass
    model_keys = list(model_keys or ["naive", "seasonal_naive", "xgboost", "lstm", "nhits", "patchtst", "chronos"])
    staging = C.ARTIFACTS_DIR / ".staging_models"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    try:
        gi = gpu_info()
        st.update("data", 0.02, f"device={gi.get('device')} gpu={gi.get('gpu_name')}")
        raw, src = D.load_raw(source)
        grid5 = D.make_grid(raw)
        clean5, obs5 = D.clean_grid(grid5)
        hourly, obsH = D.to_hourly(clean5, obs5)
        summary = D.data_summary(clean5, obs5, raw)
        sp = compute_splits(clean5.index)
        st.update(message=f"source={src} {summary['start']} -> {summary['end']} ({sp['n_days']} days); "
                          f"train<{sp['train_end']} val<{sp['val_end']}")

        weather_raw, wsrc = D.get_weather_hourly(sp["start"].date() - timedelta(days=1),
                                                 sp["end"].date() + timedelta(days=1))
        st.update(message=f"weather: {wsrc}")

        rng = np.random.default_rng(C.SEED)
        result_rows, model_info, sanity, group_meta = [], {}, {}, {}
        all_test_samples = {}
        n_groups = len(groups)
        for gi_idx, group in enumerate(groups):
            cfg = C.GROUPS[group]
            gbase = 0.05 + 0.9 * gi_idx / n_groups
            gspan = 0.9 / n_groups
            if group == "short":
                values, observed, W = clean5, obs5, None
            else:
                values, observed = hourly, obsH
                W = D.weather_for_index(weather_raw, hourly.index) if weather_raw is not None else None
            gd = GroupData(group, values, observed, W, sp["train_end"], sp["val_end"])
            tr = values[values.index < sp["train_end"]]
            m = cfg["season"]
            scales = {t: MT.mase_scale(tr[t].where(observed.loc[tr.index, t]).to_numpy(), m) for t in C.TARGETS}
            eps = {t: MT.mape_eps(tr[t].to_numpy()) for t in C.TARGETS}

            origins = test_origins(values, group, sp["val_end"], values.index.max())
            if quick:
                origins = origins[:: max(1, len(origins) // 12)][:12]
            chronos_ctx = 2048
            L_ctx = max(cfg["input_size"], chronos_ctx)
            st.update(f"{group}:contexts", gbase, f"{len(origins)} rolling origins, context {L_ctx} steps")
            ctx = make_contexts(grid5, group, origins, L_ctx, weather_raw if group == "long" else None)
            actual = actuals_for(values, observed, origins, group)
            assert (origins >= sp["val_end"]).all(), "test origin before test period"
            actual[~np.repeat(ctx.valid[:, :, None], cfg["H"], axis=2)] = np.nan

            # ---------- models
            preds, infos, fitted = {}, {}, {}
            for mi, key in enumerate(model_keys):
                mon.stage = f"{group}:{key}"
                st.update(f"{group}:{key}", gbase + gspan * (0.1 + 0.6 * mi / len(model_keys)), f"fit+predict {key}")
                t0 = time.time()
                if key == "naive":
                    mdl = NaiveForecaster(group)
                elif key == "seasonal_naive":
                    mdl = SeasonalNaiveForecaster(group)
                elif key == "xgboost":
                    mdl = XGBForecaster(group, quick=quick)
                elif key == "lstm":
                    mdl = LSTMDirectForecaster(group, quick=quick, has_weather=W is not None)
                elif key in ("nhits", "patchtst"):
                    mdl = NeuralForecaster(key, group, quick=quick, has_weather=W is not None)
                elif key == "chronos":
                    mdl = ChronosForecaster(group, context_length=chronos_ctx)
                else:
                    raise ValueError(key)
                info = mdl.fit(gd, final=False)
                t1 = time.time()
                p = mdl.predict(ctx)
                info["predict_seconds"] = round(time.time() - t1, 2)
                info["fit_seconds_wall"] = round(t1 - t0, 2)
                mask = ~np.repeat(ctx.valid[:, :, None], cfg["H"], axis=2)
                for kk in ("yhat", "lo", "hi"):
                    if p.get(kk) is not None:
                        p[kk] = p[kk].astype("float64")
                        p[kk][mask] = np.nan
                nonfinite = float(np.mean(~np.isfinite(p["yhat"][~mask]))) if (~mask).any() else 0.0
                info["nonfinite_pred_fraction"] = nonfinite
                if nonfinite > 0:
                    log.warning("%s/%s produced %.4f non-finite predictions", group, key, nonfinite)
                preds[key] = p
                infos[key] = info
                fitted[key] = mdl
                st.update(message=f"{group}/{key} done in {time.time() - t0:.1f}s")
                if key in ("lstm", "nhits", "patchtst"):
                    _free_gpu()

            rows = MT.evaluate_forecasts(actual, preds, cfg["horizons"], scales, eps, C.TARGETS, group)
            result_rows += rows
            # quick log of cum MASE at max horizon
            for key in model_keys:
                ms = [r["mase"] for r in rows if r["model"] == key and r["kind"] == "cum"
                      and r["steps"] == cfg["H"] and r["mase"] is not None]
                log.info("%s %-15s mean MASE@H(cum)=%.3f", group, key, float(np.mean(ms)) if ms else float("nan"))

            # sanity
            Yg = values[C.TARGETS].to_numpy()
            sanity[group] = {
                "xgb_feature_leakage_test": leakage_perturbation_test(Yg, W.to_numpy() if W is not None else None, group, rng),
                "context_assertions": "make_contexts asserts every context timestamp < origin; cleaning re-run per origin",
                "n_origins": int(len(origins)),
                "valid_origin_target_fraction": round(float(ctx.valid.mean()), 4),
                "test_period": [str(origins.min()), str(origins.max() + (cfg["H"] - 1) * ctx.step)],
            }
            all_test_samples[group] = sample_test_predictions(group, ctx, actual, preds)
            np.savez_compressed(C.ARTIFACTS_DIR / f"eval_forecasts_{group}.npz",
                                origins=np.array([o.isoformat() for o in origins]), actual=actual.astype("float32"),
                                **{f"{k}_{kk}": v[kk].astype("float32") for k, v in preds.items()
                                   for kk in ("yhat", "lo", "hi") if v.get(kk) is not None})

            # ---------- refit on ALL data for live forecasting
            for key in model_keys:
                mdl = fitted[key]
                if key in ("xgboost", "lstm", "nhits", "patchtst"):
                    mon.stage = f"{group}:{key}:refit"
                    st.update(f"{group}:{key}:refit", gbase + gspan * 0.8, f"refit {key} on all data")
                    finfo = mdl.fit(gd, final=True)
                    infos[key]["final_fit"] = finfo
                    mdl.save(staging / group / key)
                    if key != "xgboost":
                        _free_gpu()
            model_info[group] = infos
            group_meta[group] = {
                "resolution_minutes": cfg["resolution_minutes"], "H": cfg["H"], "input_size": cfg["input_size"],
                "chronos_context": chronos_ctx, "horizons": cfg["horizons"], "season_m": m,
                "origin_every_minutes": cfg["origin_every_steps"] * cfg["resolution_minutes"],
                "n_origins": int(len(origins)), "mase_scale": scales, "mape_eps": eps,
                "n_points": {"train": int((values.index < sp["train_end"]).sum()),
                             "val": int(((values.index >= sp["train_end"]) & (values.index < sp["val_end"])).sum()),
                             "test": int((values.index >= sp["val_end"]).sum())},
                "uses_weather": W is not None,
            }
            del fitted, preds
            _free_gpu()

        mon.stop_evt.set()
        gi_final = gpu_info()
        try:
            import torch

            if torch.cuda.is_available():
                gi_final["torch_max_memory_allocated_mb"] = round(torch.cuda.max_memory_allocated() / 1024 ** 2, 1)
        except Exception:  # noqa: BLE001
            pass
        gi_final["nvidia_smi"] = mon.summary()

        metrics = {
            "generated_at": _now(),
            "quick": quick,
            "data_source": src,
            "dataset": summary,
            "split": {
                "method": "chronological, no shuffling: train 70% / val 10% / test 20% (by whole days)",
                "train": [sp["start"].isoformat(), sp["train_end"].isoformat()],
                "val": [sp["train_end"].isoformat(), sp["val_end"].isoformat()],
                "test": [sp["val_end"].isoformat(), sp["end"].isoformat()],
                "n_days": sp["n_days"],
            },
            "evaluation": {
                "scheme": "rolling-origin on test period, fixed models trained on train (val for early stopping)",
                "metric_kinds": {"cum": "error pooled over steps 1..k (horizon k)", "point": "error at step k only"},
                "best_selection": "lowest test MASE (kind=cum) per (target, horizon)",
                "mase": "MAE / in-sample seasonal-naive MAE on train (m=288 for 5-min, m=24 hourly)",
                "mape_eps": "points with |y| < 5% of train median |y| are ignored in MAPE",
                "coverage80": "share of actuals inside [q10, q90]; only probabilistic models",
            },
            "groups": group_meta,
            "device": gi_final,
            "weather_source": wsrc,
            "library_versions": library_versions(),
            "assumptions": [
                "Long-horizon models use weather as known future covariates; in training/evaluation the ERA5/archive "
                "values are used (perfect-forecast assumption), so live accuracy with Open-Meteo forecasts may be lower.",
                "Short-horizon models use only sensor history + hour of day.",
                "Chronos-Bolt is used zero-shot (no fine-tuning), with up to 2048 context steps.",
                "Neural models (LSTM, N-HiTS, PatchTST) are global models across the 9 series with per-window robust scaling.",
                "Final live models are refit on all data with the step/iteration count selected by early stopping.",
                "Metrics are computed only on observed (non-imputed) points; origin-target pairs with insufficient "
                "context are excluded for all models equally.",
            ],
            "preprocessing": D.PREPROCESSING_DOC,
            "models": model_info,
            "sanity": sanity,
            "rows": result_rows,
            "best": {"cum": MT.best_models(result_rows, "cum"), "point": MT.best_models(result_rows, "point")},
            "total_seconds": round(time.time() - t_start, 1),
        }
        # ---------- write artifacts
        st.update("save", 0.97, "writing artifacts")
        C.TEST_PRED_DIR.mkdir(parents=True, exist_ok=True)
        for group, per_t in all_test_samples.items():
            for t, obj in per_t.items():
                (C.TEST_PRED_DIR / f"{group}_{t}.json").write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
        for group in groups:
            dst = C.MODELS_DIR / group
            if dst.exists():
                shutil.rmtree(dst)
            if (staging / group).exists():
                shutil.move(str(staging / group), str(dst))
        shutil.rmtree(staging, ignore_errors=True)
        C.METRICS_PATH.write_text(json.dumps(_clean_json(metrics), ensure_ascii=False, indent=1), encoding="utf-8")
        C.MODEL_CARDS_PATH.write_text(json.dumps(model_cards(metrics), ensure_ascii=False, indent=1), encoding="utf-8")
        st.update("done", 1.0, f"finished in {metrics['total_seconds']}s", state="done", finished_at=_now())
        return metrics
    except Exception as e:  # noqa: BLE001
        log.error("training failed: %s\n%s", e, traceback.format_exc())
        st.update("error", None, f"failed: {e}", state="error", error=traceback.format_exc()[-4000:])
        raise
    finally:
        mon.stop_evt.set()


def _clean_json(o):
    if isinstance(o, dict):
        return {str(k): _clean_json(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean_json(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, (pd.Timestamp, datetime)):
        return o.isoformat()
    return o


def main(argv=None):
    ap = argparse.ArgumentParser(description="Train & evaluate IoT Farm forecasting models")
    ap.add_argument("--quick", action="store_true", help="smoke test: few steps/origins")
    ap.add_argument("--source", default=None, choices=[None, "auto", "influx", "json"])
    ap.add_argument("--groups", default="short,long")
    ap.add_argument("--models", default=None, help="comma list, default all")
    a = ap.parse_args(argv)
    run(quick=a.quick, source=a.source, groups=tuple(a.groups.split(",")),
        model_keys=a.models.split(",") if a.models else None)


if __name__ == "__main__":
    main()
