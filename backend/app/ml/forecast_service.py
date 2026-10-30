"""Dịch vụ suy luận: nạp mô hình cuối (đã refit trên toàn bộ dữ liệu), lấy ngữ cảnh mới nhất, dự báo, cache.

Tất cả hàm ở đây là đồng bộ (blocking) — API gọi qua threadpool để không chặn event loop.
"""
from __future__ import annotations

import json
import logging
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C
from . import data as D
from .windows import make_contexts

log = logging.getLogger("ml.forecast")


class ArtifactsMissing(RuntimeError):
    pass


class ForecastService:
    DATA_TTL = 60.0

    def __init__(self):
        self._lock = threading.RLock()
        self._infer_lock = threading.RLock()
        self._metrics = None
        self._metrics_mtime = None
        self._models: dict = {}
        self._data_cache = None  # (ts, raw, src)
        self._fc_cache: dict = {}
        self._weather_cache: dict = {}
        self._job: dict | None = None
        self._proc: subprocess.Popen | None = None

    # ------------------------------------------------------------------ artifacts
    def metrics(self) -> dict:
        p = C.METRICS_PATH
        if not p.exists():
            raise ArtifactsMissing("Chưa có mô hình đã huấn luyện (backend/artifacts/metrics.json). "
                                   "Hãy chạy: python -m app.ml.train  hoặc POST /api/forecast/train")
        mt = p.stat().st_mtime
        with self._lock:
            if self._metrics is None or mt != self._metrics_mtime:
                self._metrics = json.loads(p.read_text(encoding="utf-8"))
                self._metrics_mtime = mt
                self._models.clear()
                self._fc_cache.clear()
            return self._metrics

    def model_cards(self) -> list[dict]:
        if C.MODEL_CARDS_PATH.exists():
            return json.loads(C.MODEL_CARDS_PATH.read_text(encoding="utf-8"))
        from .cards import model_cards

        return model_cards(None)

    def model_available(self, key: str, group: str) -> bool:
        if key in ("naive", "seasonal_naive"):
            return True
        if key == "chronos":
            return True  # zero-shot, cần tải trọng số HF (cache tại artifacts/hf_cache)
        d = C.MODELS_DIR / group / key
        return d.exists() and any(d.iterdir())

    def models_info(self) -> list[dict]:
        """Danh sách phẳng (frontend): [{key, name, family, paper, doi_url, year, available, trained_at, device,
        gpu_name, hyperparameters, description, status:{short:{...}, long:{...}}}]"""
        try:
            m = self.metrics()
        except ArtifactsMissing:
            m = None
        tdev = (m or {}).get("device") or {}
        cards = self.model_cards()
        out = []
        for c in cards:
            key = c["key"]
            status = {}
            for g in C.GROUPS:
                info = (m or {}).get("models", {}).get(g, {}).get(key) or {}
                status[g] = {
                    "available": bool(m) and bool(info) and self.model_available(key, g),
                    "device": info.get("device", "cpu" if key in ("naive", "seasonal_naive") else None),
                    "train_seconds": info.get("train_seconds"),
                    "predict_seconds": info.get("predict_seconds"),
                    "final_fit": {k: v for k, v in (info.get("final_fit") or {}).items()
                                  if k not in ("valid_trajectory", "per_target")},
                }
            devs = [s["device"] for s in status.values() if s["device"]]
            dev = "cuda" if "cuda" in devs else (devs[0] if devs else None)
            out.append({
                **{k: v for k, v in c.items() if k != "train_info"},
                "available": any(s["available"] for s in status.values()),
                "trained_at": (m or {}).get("generated_at"),
                "quick": (m or {}).get("quick"),
                "device": dev,
                "gpu_name": tdev.get("gpu_name") if dev == "cuda" else None,
                "status": status,
            })
        return out

    def runtime_info(self) -> dict:
        from .models import gpu_info

        try:
            m = self.metrics()
        except ArtifactsMissing:
            m = None
        return {"trained": bool(m), "trained_at": (m or {}).get("generated_at"), "quick": (m or {}).get("quick"),
                "training_device": (m or {}).get("device"), "runtime_device": gpu_info(),
                "targets": C.TARGETS, "horizons": {g: list(cfg["horizons"].keys()) for g, cfg in C.GROUPS.items()}}

    def _load_model(self, key: str, group: str):
        from .models import (ChronosForecaster, NaiveForecaster, NeuralForecaster, SeasonalNaiveForecaster,
                             XGBForecaster)

        ck = (key, group)
        with self._lock:
            if ck in self._models:
                return self._models[ck]
            if key == "naive":
                mdl = NaiveForecaster(group)
            elif key == "seasonal_naive":
                mdl = SeasonalNaiveForecaster(group)
            elif key == "chronos":
                mdl = ChronosForecaster(group)
            elif key == "xgboost":
                mdl = XGBForecaster.load(C.MODELS_DIR / group / "xgboost", group)
            elif key == "lstm":
                from .lstm_direct import LSTMDirectForecaster

                mdl = LSTMDirectForecaster.load(C.MODELS_DIR / group / key, group)
            elif key in ("nhits", "patchtst"):
                mdl = NeuralForecaster.load(C.MODELS_DIR / group / key, key, group)
            else:
                raise ValueError(f"unknown model {key}")
            self._models[ck] = mdl
            return mdl

    # ------------------------------------------------------------------ data
    def _raw(self):
        with self._lock:
            if self._data_cache and time.time() - self._data_cache[0] < self.DATA_TTL:
                return self._data_cache[1], self._data_cache[2]
        start = datetime.now().astimezone() - timedelta(days=100)
        raw, src = D.load_raw(None, start=start)
        if len(raw) == 0 or (raw.index.max() - raw.index.min()) < timedelta(days=3):
            raw, src = D.load_raw(None)  # dữ liệu cũ hơn 100 ngày -> lấy toàn bộ
        with self._lock:
            self._data_cache = (time.time(), raw, src)
        return raw, src

    def _weather(self, start, end):
        key = (str(start), str(end))
        hit = self._weather_cache.get(key)
        if hit and time.time() - hit[0] < 1800:
            return hit[1], hit[2]
        w, src = D.get_weather_hourly(start, end)
        self._weather_cache[key] = (time.time(), w, src)
        return w, src

    # ------------------------------------------------------------------ forecast
    def resolve_model(self, model: str, target: str, horizon: str) -> str:
        if model != "best":
            return model
        try:
            b = self.metrics()["best"]["cum"][target][horizon]["model"]
            return b
        except Exception:  # noqa: BLE001
            return "seasonal_naive"

    def _compute(self, group: str, key: str) -> dict:
        cfg = C.GROUPS[group]
        raw, src = self._raw()
        if len(raw) == 0:
            raise ArtifactsMissing("Không có dữ liệu cảm biến để dự báo")
        # Chỉ lấy tối đa 20 ngày lịch tính từ mẫu đo mới nhất để tránh tạo lưới rỗng qua các tháng nghỉ
        cutoff = raw.index.max() - pd.Timedelta(days=20)
        raw_tail = raw.loc[raw.index >= cutoff]
        grid5 = D.make_grid(raw_tail)
        fin = grid5.notna().any(axis=1)
        if not fin.any():
            raise ArtifactsMissing("Không có dữ liệu cảm biến để dự báo")
        last_obs = grid5.index[fin.to_numpy()][-1]
        step = pd.Timedelta(minutes=cfg["resolution_minutes"])
        if group == "short":
            T = last_obs + pd.Timedelta(minutes=5)
        else:
            T = (last_obs + pd.Timedelta(minutes=5)).floor("1h")
        L = 2048 if key == "chronos" else max(cfg["input_size"], 576 if group == "short" else 336)
        mdl = self._load_model(key, group)
        weather, wsrc, fallback = None, None, None
        needs_w = group == "long" and key in ("xgboost", "lstm", "nhits") and (
            getattr(mdl, "futr_exog", None) and any(c in C.WEATHER_COLS for c in mdl.futr_exog)
            or (key == "xgboost" and any(f.startswith("w_") for f in getattr(mdl, "feature_names", []))))
        if needs_w:
            s = (T - L * step).date() - timedelta(days=1)
            e = (T + cfg["H"] * step).date() + timedelta(days=1)
            weather, wsrc = self._weather(s, e)
            if weather is None:
                raise ArtifactsMissing(f"Mô hình {key} (dài hạn) cần dữ liệu thời tiết nhưng không lấy được: {wsrc}")
            # phải phủ đủ tương lai
            need_end = T + (cfg["H"] - 1) * step
            if weather.index.max() < need_end - pd.Timedelta(hours=6):
                fallback = f"weather covers only until {weather.index.max()}; remaining hours filled (ffill)"
        ctx = make_contexts(grid5, group, pd.DatetimeIndex([T]), L, weather)
        with self._infer_lock:
            p = mdl.predict(ctx)
        from .models import torch_device

        dev = "cpu" if key in ("naive", "seasonal_naive") else torch_device()
        return {"ctx": ctx, "pred": p, "origin": T, "last_obs": last_obs, "source": src, "device": dev,
                "weather_source": wsrc, "note": fallback, "computed_at": time.time()}

    def forecast(self, target: str, horizon: str, model: str = "best", refresh: bool = False) -> dict:
        if target not in C.TARGETS:
            raise NotFound(f"unknown target {target}; expected one of {C.TARGETS}")
        if horizon not in C.HORIZON_TO_GROUP:
            raise NotFound(f"unknown horizon {horizon}; expected one of {list(C.HORIZON_TO_GROUP)}")
        if model != "best" and model not in C.MODEL_KEYS:
            raise NotFound(f"unknown model {model}; expected best or one of {C.MODEL_KEYS}")
        m = self.metrics()
        group = C.HORIZON_TO_GROUP[horizon]
        cfg = C.GROUPS[group]
        steps = cfg["horizons"][horizon]
        key = self.resolve_model(model, target, horizon)
        if not self.model_available(key, group):
            raise ArtifactsMissing(f"Mô hình {key} ({group}) chưa được huấn luyện")
        ck = (group, key)
        if refresh:
            with self._lock:
                self._data_cache = None
                self._fc_cache.pop(ck, None)
        with self._infer_lock:
            with self._lock:
                hit = self._fc_cache.get(ck)
            if not hit or time.time() - hit["computed_at"] > C.FORECAST_CACHE_SEC:
                hit = self._compute(group, key)
                with self._lock:
                    self._fc_cache[ck] = hit
        ctx, p = hit["ctx"], hit["pred"]
        j = C.TARGETS.index(target)
        res_min = cfg["resolution_minutes"]
        hist_n = max(2 * steps, int(6 * 60 / res_min))
        hist_n = min(hist_n, ctx.L)
        past = ctx.past_index(0)[-hist_n:]
        fut = ctx.future_index(0)[:steps]
        history = [{"t": _iso(t), "v": _f(v)} for t, v in zip(past, ctx.Y[0, -hist_n:, j])]
        fc = []
        for k, t in enumerate(fut):
            fc.append({"t": _iso(t), "yhat": _f(p["yhat"][0, j, k]),
                       "lo": _f(p["lo"][0, j, k]) if p.get("lo") is not None else None,
                       "hi": _f(p["hi"][0, j, k]) if p.get("hi") is not None else None})
        met = {}
        for r in m.get("rows", []):
            if r["model"] == key and r["target"] == target and r["horizon"] == horizon:
                met[r["kind"]] = {k: r[k] for k in ("mae", "rmse", "mape", "smape", "mase", "r2", "coverage80", "n_eval")}
        return {
            "target": target,
            "unit": C.UNITS[target],
            "horizon": horizon,
            "group": group,
            "resolution_minutes": res_min,
            "model": key,
            "model_label": C.MODEL_LABELS.get(key, key),
            "requested_model": model,
            "device": hit.get("device"),
            "issued_at": _iso(pd.Timestamp.now(tz=C.TZ).floor("s")),
            "origin": _iso(hit["origin"]),
            "last_observation_at": _iso(hit["last_obs"]),
            "data_source": hit["source"],
            "weather_source": hit.get("weather_source"),
            "context_valid": bool(ctx.valid[0, j]),
            "note": hit.get("note"),
            "history": history,
            "forecast": fc,
            "metrics_at_horizon": met,
        }

    # ------------------------------------------------------------------ metrics / test predictions
    def metrics_table(self, target: str | None = None, horizon: str | None = None, kind: str = "cum",
                      model: str | None = None) -> dict:
        if target and target not in C.TARGETS:
            raise NotFound(f"unknown target {target}; expected one of {C.TARGETS}")
        if horizon and horizon not in C.HORIZON_TO_GROUP:
            raise NotFound(f"unknown horizon {horizon}")
        if model and model not in C.MODEL_KEYS:
            raise NotFound(f"unknown model {model}")
        m = self.metrics()
        rows = [r for r in m.get("rows", [])
                if (not target or r["target"] == target) and (not horizon or r["horizon"] == horizon)
                and (kind == "all" or r["kind"] == kind) and (not model or r["model"] == model)]
        sp = m.get("split", {})
        dataset = {}
        for g, gm in m.get("groups", {}).items():
            npnt = gm.get("n_points", {})
            dataset[g] = {
                "start": sp.get("train", [None])[0],
                "end": (m.get("dataset") or {}).get("end"),
                "n_points": int(sum(npnt.values())) if npnt else None,
                "n_points_split": npnt,
                "resolution_minutes": gm.get("resolution_minutes"),
                "n_origins": gm.get("n_origins"),
                "origin_every_minutes": gm.get("origin_every_minutes"),
                "uses_weather": gm.get("uses_weather"),
                "horizons": list((gm.get("horizons") or {}).keys()),
                "split": {"train_end": sp.get("train", [None, None])[1], "val_end": sp.get("val", [None, None])[1],
                          "test_start": sp.get("test", [None, None])[0], "test_end": sp.get("test", [None, None])[1]},
            }
        return {
            "rows": rows,
            "kind": kind,
            "best": m.get("best", {}).get(kind if kind in ("cum", "point") else "cum"),
            "dataset": dataset,
            "dataset_summary": m.get("dataset"),
            "data_source": m.get("data_source"),
            "split": sp,
            "evaluation": m.get("evaluation"),
            "generated_at": m.get("generated_at"),
            "quick": m.get("quick"),
            "assumptions": m.get("assumptions"),
            "device": {k: v for k, v in (m.get("device") or {}).items() if k != "nvidia_smi"},
            "gpu_usage": (m.get("device") or {}).get("nvidia_smi"),
            "weather_source": m.get("weather_source"),
        }

    def _eval_npz(self, group: str) -> dict:
        p = C.ARTIFACTS_DIR / f"eval_forecasts_{group}.npz"
        if not p.exists():
            raise ArtifactsMissing(f"Không có kết quả dự báo tập test cho nhóm {group}")
        mt = p.stat().st_mtime
        ck = ("npz", group)
        with self._lock:
            hit = self._models.get(ck)
            if hit and hit[0] == mt:
                return hit[1]
        z = np.load(p, allow_pickle=False)
        d = {k: z[k] for k in z.files}
        with self._lock:
            self._models[ck] = (mt, d)
        return d

    def test_predictions(self, target: str, group: str = "short", model: str | None = None,
                         last_days: float | None = None, fmt: str = "series") -> dict:
        """Dự báo trên tập test để vẽ biểu đồ.

        fmt="series": nối các đoạn dự báo H bước từ các origin cách nhau đúng H (12 h cho short, 5 ngày cho long)
        → chuỗi liên tục "dự báo 1..H bước trước" so với giá trị thực (chỉ điểm quan sát thật).
        fmt="samples": 8 origin mẫu, mỗi mẫu có history + actual + dự báo của mọi mô hình.
        """
        if target not in C.TARGETS:
            raise NotFound(f"unknown target {target}")
        if group not in C.GROUPS:
            raise NotFound(f"unknown group {group}")
        if model and model not in ("all",) + tuple(C.MODEL_KEYS):
            raise NotFound(f"unknown model {model}")
        self.metrics()
        cfg = C.GROUPS[group]
        if fmt == "samples":
            p = C.TEST_PRED_DIR / f"{group}_{target}.json"
            if not p.exists():
                raise ArtifactsMissing(f"Không có test predictions cho {group}/{target}")
            obj = json.loads(p.read_text(encoding="utf-8"))
            if model and model != "all":
                obj["models"] = [model]
                for s in obj["samples"]:
                    s["forecasts"] = {model: s["forecasts"].get(model, [])}
            return obj
        z = self._eval_npz(group)
        origins = pd.DatetimeIndex(pd.to_datetime(z["origins"])).tz_convert(C.TZ)
        H = cfg["H"]
        step = pd.Timedelta(minutes=cfg["resolution_minutes"])
        stride = max(1, H // cfg["origin_every_steps"])  # origin cách nhau H bước -> không chồng lấn
        sel = np.arange(0, len(origins), stride)
        if last_days:
            cutoff = origins.max() + H * step - pd.Timedelta(days=float(last_days))
            sel = np.array([i for i in sel if origins[i] >= cutoff - H * step], dtype=int)
        j = C.TARGETS.index(target)
        models = [k for k in C.MODEL_KEYS if f"{k}_yhat" in z and (not model or model == "all" or k == model)]
        ts, act = [], []
        preds = {k: [] for k in models}
        for i in sel:
            fut = pd.date_range(origins[i], periods=H, freq=step)
            for k_step, t in enumerate(fut):
                tt = _iso(t)
                ts.append(tt)
                act.append({"t": tt, "v": _f(z["actual"][i, j, k_step])})
                for mk in models:
                    lo = z.get(f"{mk}_lo")
                    hi = z.get(f"{mk}_hi")
                    preds[mk].append({"t": tt, "yhat": _f(z[f"{mk}_yhat"][i, j, k_step]),
                                      "lo": _f(lo[i, j, k_step]) if lo is not None else None,
                                      "hi": _f(hi[i, j, k_step]) if hi is not None else None,
                                      "lead": k_step + 1})
        hz = list(cfg["horizons"].keys())[-1]
        return {
            "target": target, "unit": C.UNITS[target], "group": group, "horizon": hz,
            "resolution_minutes": cfg["resolution_minutes"],
            "description": f"Concatenated {hz}-ahead forecasts from non-overlapping test origins every {hz}; "
                           f"'lead' = steps ahead of the origin. Actual = observed values only (null = missing).",
            "origins": [_iso(origins[i]) for i in sel],
            "models": models,
            "actual": act,
            "predictions": preds,
        }

    # ------------------------------------------------------------------ training jobs
    def start_training(self, quick: bool = False) -> dict:
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                raise RuntimeError("Đang có một tiến trình huấn luyện chạy")
            st = self._read_status()
            if st.get("state") == "running" and _pid_alive(st.get("pid")):
                raise RuntimeError(f"Đang có một tiến trình huấn luyện chạy (pid {st.get('pid')})")
            C.ensure_dirs()
            job_id = uuid.uuid4().hex[:12]
            cmd = [sys.executable, "-m", "app.ml.train"] + (["--quick"] if quick else [])
            out = open(C.ARTIFACTS_DIR / "train_stdout.log", "w", encoding="utf-8")
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            self._proc = subprocess.Popen(cmd, cwd=str(C.BACKEND_DIR), stdout=out, stderr=subprocess.STDOUT,
                                          creationflags=flags)
            self._job = {"job_id": job_id, "quick": quick, "started_at": _iso(pd.Timestamp.now(tz=C.TZ).floor("s")),
                         "pid": self._proc.pid}
        return {**self.training_status(), "job_id": job_id, "state": "running", "quick": quick,
                "started_at": self._job["started_at"], "progress": 0.0, "stage": "starting",
                "message": "training process started"}

    def _read_status(self) -> dict:
        if C.TRAIN_STATUS_PATH.exists():
            try:
                return json.loads(C.TRAIN_STATUS_PATH.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                return {}
        return {}

    def training_status(self) -> dict:
        st = self._read_status()
        with self._lock:
            job = dict(self._job or {})
            rc = self._proc.poll() if self._proc is not None else None
            running_proc = self._proc is not None and rc is None
        state = st.get("state") or "idle"
        if state == "running" and not running_proc and not _pid_alive(st.get("pid")) and not _recent(st.get("updated_at")):
            state = "error"
            st["error"] = st.get("error") or "training process exited unexpectedly"
        if running_proc and state not in ("running",):
            state = "running"
        log_lines = []
        if C.TRAIN_LOG_PATH.exists():
            try:
                log_lines = C.TRAIN_LOG_PATH.read_text(encoding="utf-8", errors="replace").splitlines()[-30:]
            except Exception:  # noqa: BLE001
                pass
        return {
            "state": state,
            "progress": st.get("progress", 0.0 if state == "idle" else None),
            "stage": st.get("stage"),
            "message": st.get("message"),
            "quick": st.get("quick", job.get("quick")),
            "started_at": st.get("started_at", job.get("started_at")),
            "finished_at": st.get("finished_at"),
            "error": st.get("error"),
            "job_id": job.get("job_id"),
            "pid": st.get("pid", job.get("pid")),
            "returncode": rc,
            "log": log_lines,
        }


class NotFound(LookupError):
    pass


def _recent(ts, minutes: float = 30) -> bool:
    """Status cập nhật trong N phút gần đây -> coi như tiến trình còn sống (khi không kiểm tra được PID)."""
    try:
        return (pd.Timestamp.now(tz=C.TZ) - pd.Timestamp(ts)).total_seconds() < minutes * 60
    except Exception:  # noqa: BLE001
        return False


def _pid_alive(pid) -> bool:
    if not pid:
        return False
    try:
        if sys.platform == "win32":
            out = subprocess.run(["tasklist", "/FI", f"PID eq {int(pid)}", "/NH"], capture_output=True, text=True,
                                 timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
            return str(int(pid)) in out
        import os

        os.kill(int(pid), 0)
        return True
    except Exception:  # noqa: BLE001
        return False


def _f(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return round(v, 4) if np.isfinite(v) else None


def _iso(t) -> str:
    t = pd.Timestamp(t)
    if t.tzinfo is None:
        t = t.tz_localize(C.TZ)
    return t.tz_convert(C.TZ).isoformat()


_SERVICE: ForecastService | None = None


def get_service() -> ForecastService:
    global _SERVICE
    if _SERVICE is None:
        _SERVICE = ForecastService()
    return _SERVICE
