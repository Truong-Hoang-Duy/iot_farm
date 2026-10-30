"""Các mô hình dự báo: Naive, Seasonal Naive, XGBoost, LSTM, N-HiTS, PatchTST, Chronos-Bolt.

Giao diện chung:
    fit(gd, final=False) -> dict thông tin huấn luyện
    predict(ctx: Contexts) -> {"yhat": [N, n_targets, H], "lo": ..|None, "hi": ..|None}
"""
from __future__ import annotations

import gc
import json
import logging
import os
import time
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C
from .windows import Contexts, FeatureBase, XGB_SPECS, fill_nan_2d, stack_contexts

log = logging.getLogger("ml.models")


# --------------------------------------------------------------------------- device helpers
def torch_device() -> str:
    if C.DEVICE_PREF == "cpu":
        return "cpu"
    import shutil
    import sys

    if "torch" not in sys.modules and shutil.which("nvidia-smi") is None:
        return "cpu"
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except Exception:  # noqa: BLE001
        pass
    if C.DEVICE_PREF == "cuda":
        log.warning("ML_DEVICE=cuda but CUDA not available -> cpu")
    return "cpu"


def gpu_info() -> dict:
    info = {"cuda_available": False, "device": "cpu", "gpu_name": None}
    try:
        import torch

        info["torch_version"] = torch.__version__
        info["torch_cuda"] = torch.version.cuda
        if torch.cuda.is_available():
            p = torch.cuda.get_device_properties(0)
            info.update(cuda_available=True, gpu_name=torch.cuda.get_device_name(0),
                        gpu_memory_gb=round(p.total_memory / 1024 ** 3, 2))
        info["device"] = torch_device()
    except Exception as e:  # noqa: BLE001
        info["error"] = str(e)
    return info


# --------------------------------------------------------------------------- data container
@dataclass
class GroupData:
    group: str
    values: pd.DataFrame  # đã làm sạch (5' hoặc giờ)
    observed: pd.DataFrame
    weather: pd.DataFrame | None  # đã căn theo values.index & điền đủ (chỉ nhóm long)
    train_end: pd.Timestamp  # = bắt đầu validation
    val_end: pd.Timestamp  # = bắt đầu test

    @property
    def cfg(self) -> dict:
        return C.GROUPS[self.group]

    def idx(self, ts: pd.Timestamp) -> int:
        return int(self.values.index.searchsorted(ts))


def _hour_of_day(idx: pd.DatetimeIndex) -> np.ndarray:
    return (idx.hour + idx.minute / 60.0).to_numpy(dtype="float64")


# --------------------------------------------------------------------------- baselines
class NaiveForecaster:
    key = "naive"
    probabilistic = False

    def __init__(self, group: str):
        self.group = group

    def fit(self, gd: GroupData, final: bool = False, **_) -> dict:
        return {"train_seconds": 0.0}

    def predict(self, ctx: Contexts) -> dict:
        N, L, n = ctx.Y.shape
        out = np.full((N, n, ctx.H), np.nan)
        for i in range(N):
            for j in range(n):
                col = ctx.Y[i, :, j]
                f = np.flatnonzero(np.isfinite(col))
                if len(f):
                    out[i, j, :] = col[f[-1]]
        return {"yhat": out, "lo": None, "hi": None}


class SeasonalNaiveForecaster(NaiveForecaster):
    """ŷ(T+k) = y(T+k - m*ceil(k/m)), m = 1 ngày (288 bước 5' hoặc 24 bước giờ)."""

    key = "seasonal_naive"

    def predict(self, ctx: Contexts) -> dict:
        m = C.GROUPS[self.group]["season"]
        N, L, n = ctx.Y.shape
        H = ctx.H
        k = np.arange(1, H + 1)
        src = (L - 1) + k - m * np.ceil(k / m).astype(int)  # chỉ số trong ngữ cảnh, luôn <= L-1
        assert (src <= L - 1).all() and (src >= 0).all()
        Yf = pd.DataFrame(ctx.Y.reshape(N * L, n)).groupby(np.arange(N * L) // L).ffill().to_numpy().reshape(N, L, n)
        out = np.transpose(Yf[:, src, :], (0, 2, 1))
        return {"yhat": out, "lo": None, "hi": None}


# --------------------------------------------------------------------------- XGBoost
class XGBForecaster:
    """Direct multi-horizon "horizon-as-feature": 1 mô hình / target / nhóm.

    Đầu ra: hồi quy phân vị (q10, q50, q90) cho y(T+h) - y(T); dự báo điểm = q50.
    Hỗ trợ nạp lười (lazy-load) từng biến mục tiêu khi suy luận để tiết kiệm ~800MB RAM trên Render.
    """

    key = "xgboost"
    probabilistic = True

    def __init__(self, group: str, quick: bool = False):
        self.group = group
        self.quick = quick
        self.models: dict = {}
        self.best_iter: dict = {}
        self._model_dir: Path | None = None
        self._dev: str = "cpu"
        self.params = {
            "n_estimators": 60 if quick else 3000,
            "learning_rate": 0.05,
            "max_depth": 8,
            "min_child_weight": 20,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
            "reg_lambda": 1.0,
            "max_bin": 256,
            "tree_method": "hist",
            "objective": "reg:quantileerror",
            "quantile_alpha": list(C.QUANTILES),
            "early_stopping_rounds": 100,
        }
        self.sampling = {
            "short": {"origin_stride": 3, "h_per_origin": 16},
            "long": {"origin_stride": 1, "h_per_origin": 24},
        }[group]
        if quick:
            self.sampling = {"origin_stride": self.sampling["origin_stride"] * 8, "h_per_origin": 6}
        self.feature_names: list[str] = []

    def _get_target_model(self, t: str):
        if t in self.models:
            return self.models[t]
        if self._model_dir is None:
            raise KeyError(f"Model for target {t} is not loaded")
        import xgboost as xgb

        # Chỉ giữ tối đa 1 mô hình XGBoost trong RAM khi suy luận từ đĩa để tránh vượt 512MB RAM
        if len(self.models) >= 1:
            self.models.clear()
            gc.collect()
        m = xgb.XGBRegressor()
        m.load_model(str(self._model_dir / f"{t}.ubj"))
        m.set_params(device=self._dev)
        self.models[t] = m
        return m

    # -- rows
    def _sample_rows(self, gd: GroupData, lo_i: int, hi_i: int, rng) -> tuple[np.ndarray, np.ndarray]:
        """Origin i0 trong [lo_i, hi_i) (chỉ số điểm quan sát cuối), h sao cho i0+h < hi_target."""
        H = gd.cfg["H"]
        L = XGB_SPECS[self.group]["lookback"]
        lo_i = max(lo_i, L)
        i0 = np.arange(lo_i, hi_i, self.sampling["origin_stride"])
        k = self.sampling["h_per_origin"]
        # nửa log-uniform (nhấn mạnh horizon ngắn) + nửa uniform
        hl = np.exp(rng.uniform(0, np.log(H), size=(len(i0), k // 2))).astype(int)
        hu = rng.integers(1, H + 1, size=(len(i0), k - k // 2))
        h = np.clip(np.concatenate([hl, hu], axis=1), 1, H)
        return np.repeat(i0, k), h.ravel()

    def _xy(self, fb: FeatureBase, gd: GroupData, i0, h, j, hour0_all, hi_target: int):
        keep = (i0 + h) < hi_target
        i0, h = i0[keep], h[keep]
        X, names = fb.features(i0, h, j, hour0_all[i0])
        y = fb.Y[i0 + h, j] - fb.Yf[i0, j]
        ok = np.isfinite(y) & np.isfinite(X[:, 0])
        return X[ok], y[ok].astype(np.float32), names

    def fit(self, gd: GroupData, final: bool = False, **_) -> dict:
        import xgboost as xgb

        t0 = time.time()
        rng = np.random.default_rng(C.SEED)
        dev = "cuda" if torch_device() == "cuda" else "cpu"
        Y = gd.values[C.TARGETS].to_numpy(dtype="float64")
        W = gd.weather.to_numpy() if gd.weather is not None else None
        fb = FeatureBase(Y, W, self.group)
        hour0 = _hour_of_day(gd.values.index)
        T = len(Y)
        i_tr, i_val = gd.idx(gd.train_end), gd.idx(gd.val_end)
        info = {"device": dev, "per_target": {}}
        for j, t in enumerate(C.TARGETS):
            p = dict(self.params)
            if final:
                i0, h = self._sample_rows(gd, 0, T - 1, rng)
                Xtr, ytr, names = self._xy(fb, gd, i0, h, j, hour0, T)
                p.pop("early_stopping_rounds")
                p["n_estimators"] = max(50, int(self.best_iter.get(t, p["n_estimators"]) * 1.1))
                model = xgb.XGBRegressor(**p, device=dev, random_state=C.SEED)
                model.fit(Xtr, ytr, verbose=False)
                info["per_target"][t] = {"n_train_rows": int(len(ytr)), "n_estimators": p["n_estimators"]}
            else:
                i0, h = self._sample_rows(gd, 0, i_tr - 1, rng)
                Xtr, ytr, names = self._xy(fb, gd, i0, h, j, hour0, i_tr)
                i0v, hv = self._sample_rows(gd, i_tr - 1, i_val - 1, rng)
                Xva, yva, _ = self._xy(fb, gd, i0v, hv, j, hour0, i_val)
                model = xgb.XGBRegressor(**p, device=dev, random_state=C.SEED)
                model.fit(Xtr, ytr, eval_set=[(Xva, yva)], verbose=False)
                bi = int(getattr(model, "best_iteration", p["n_estimators"] - 1) or 0) + 1
                self.best_iter[t] = bi
                info["per_target"][t] = {"n_train_rows": int(len(ytr)), "n_val_rows": int(len(yva)),
                                         "best_iteration": bi}
            self.models[t] = model
            self.feature_names = names
        info["train_seconds"] = round(time.time() - t0, 2)
        return info

    def predict(self, ctx: Contexts, targets: list[str] | None = None) -> dict:
        L = XGB_SPECS[self.group]["lookback"]
        H = ctx.H
        N = len(ctx.origins)
        Ys, Ws, i0b = stack_contexts(ctx, L)
        fb = FeatureBase(Ys, Ws, self.group, block_len=L + H)
        last_t = ctx.origins - ctx.step
        hour0 = np.repeat(_hour_of_day(last_t), H)
        i0 = np.repeat(i0b, H)
        h = np.tile(np.arange(1, H + 1), N)
        out = np.full((3, N, len(C.TARGETS), H), np.nan)
        for j, t in enumerate(C.TARGETS):
            if targets is not None and t not in targets:
                continue
            X, _ = fb.features(i0, h, j, hour0)
            m = self._get_target_model(t)
            q = m.predict(X).reshape(N * H, -1)
            q = np.sort(q, axis=1) + fb.Yf[i0, j][:, None]
            for k in range(3):
                out[k, :, j, :] = q[:, k].reshape(N, H)
        if self._model_dir is not None:
            self.models.clear()
            gc.collect()
        return {"yhat": out[1], "lo": out[0], "hi": out[2]}

    def save(self, d: Path) -> None:
        d.mkdir(parents=True, exist_ok=True)
        for t, m in self.models.items():
            m.save_model(str(d / f"{t}.ubj"))
        (d / "meta.json").write_text(json.dumps({"best_iter": self.best_iter, "features": self.feature_names,
                                                 "params": self.params}, indent=1), encoding="utf-8")

    @classmethod
    def load(cls, d: Path, group: str) -> "XGBForecaster":
        obj = cls(group)
        meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
        obj.best_iter = meta.get("best_iter", {})
        obj.feature_names = meta.get("features", [])
        obj._dev = "cpu"
        obj._model_dir = d
        return obj


# --------------------------------------------------------------------------- neuralforecast models
NEURAL_CLASSES = {"lstm": "LSTM", "nhits": "NHITS", "patchtst": "PatchTST"}


def neural_hparams(key: str, group: str, quick: bool) -> dict:
    cfg = C.GROUPS[group]
    common = {
        "h": cfg["H"],
        "input_size": cfg["input_size"],
        "learning_rate": 1e-3,
        "max_steps": 30 if quick else 1500,
        "val_check_steps": 10 if quick else 100,
        "early_stop_patience_steps": 3 if quick else 5,
        "batch_size": 32,
        "windows_batch_size": 256,
        "inference_windows_batch_size": 1024,
        "scaler_type": "robust",
        "random_seed": C.SEED,
        # bước trượt cửa sổ (train + validation). Nhóm 5': 6 bước = 30' -> giảm 6x chi phí validation,
        # vẫn còn ~78k cửa sổ huấn luyện; nhóm giờ: 1.
        "step_size": 6 if group == "short" else 1,
    }
    if key == "nhits":
        common.update({
            "n_pool_kernel_size": [16, 8, 1] if group == "short" else [8, 4, 1],
            "n_freq_downsample": [24, 12, 1],
            "mlp_units": [[512, 512]] * 3,
            "dropout_prob_theta": 0.1,
            "windows_batch_size": 512,
        })
    elif key == "lstm":
        common.update({
            "encoder_n_layers": 2,
            "encoder_hidden_size": 128,
            "encoder_dropout": 0.1,
            "decoder_hidden_size": 128,
            "decoder_layers": 2,
        })
    elif key == "patchtst":
        common.update({
            "learning_rate": 5e-4,
            "patch_len": 24 if group == "short" else 24,
            "stride": 12,
            "hidden_size": 128,
            "n_heads": 8,
            "encoder_layers": 3,
            "linear_hidden_size": 256,
            "dropout": 0.2,
            "revin": True,  # RevIN như bài báo gốc (subtract_last mặc định của neuralforecast)
        })
    return common


def futr_exog_for(key: str, group: str, has_weather: bool) -> list[str]:
    if key == "patchtst":
        return []  # PatchTST: đơn biến (channel-independent), không hỗ trợ exog
    cols = ["hour_sin", "hour_cos"]
    if group == "long" and has_weather:
        cols += list(C.WEATHER_COLS)
    return cols


def _naive_ds(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    return idx.tz_convert(C.TZ).tz_localize(None) if idx.tz is not None else idx


def _hour_feats(ds: pd.DatetimeIndex) -> tuple[np.ndarray, np.ndarray]:
    hr = (ds.hour + ds.minute / 60.0).to_numpy(dtype="float64")
    return np.sin(2 * np.pi * hr / 24), np.cos(2 * np.pi * hr / 24)


class NeuralForecaster:
    probabilistic = True

    def __init__(self, key: str, group: str, quick: bool = False, has_weather: bool = False,
                 futr_exog: list[str] | None = None, hparams_override: dict | None = None):
        self.key = key
        self.group = group
        self.quick = quick
        self.hparams = {**neural_hparams(key, group, quick), **(hparams_override or {})}
        self.futr_exog = futr_exog if futr_exog is not None else futr_exog_for(key, group, has_weather)
        self.nf = None
        self.best_step: int | None = None

    def _build(self, max_steps: int, early_stop: bool):
        import neuralforecast.models as M
        from neuralforecast import NeuralForecast
        from neuralforecast.losses.pytorch import MQLoss

        hp = dict(self.hparams)
        hp["max_steps"] = max_steps
        if not early_stop:
            hp["early_stop_patience_steps"] = -1
        dev = torch_device()
        cls = getattr(M, NEURAL_CLASSES[self.key])
        extra = {"futr_exog_list": self.futr_exog} if self.futr_exog else {}
        model = cls(
            **hp,
            **extra,
            loss=MQLoss(level=[80]),
            alias=self.key,
            accelerator="gpu" if dev == "cuda" else "cpu",
            devices=1,
            enable_progress_bar=False,
            enable_model_summary=False,
            logger=False,
            enable_checkpointing=False,
        )
        return NeuralForecast(models=[model], freq=C.GROUPS[self.group]["freq"])

    def _train_df(self, gd: GroupData, end: pd.Timestamp | None) -> pd.DataFrame:
        v = gd.values[C.TARGETS]
        if end is not None:
            v = v[v.index < end]
        ds = _naive_ds(v.index)
        hs, hc = _hour_feats(ds)
        W = gd.weather.reindex(v.index) if gd.weather is not None else None
        parts = []
        for t in C.TARGETS:
            y = v[t].to_numpy(dtype="float64")
            avail = np.isfinite(y).astype(np.float32)
            yf = fill_nan_2d(y[:, None])[:, 0]
            df = pd.DataFrame({"unique_id": t, "ds": ds, "y": yf, "available_mask": avail})
            if "hour_sin" in self.futr_exog:
                df["hour_sin"], df["hour_cos"] = hs, hc
            if W is not None:
                for c in C.WEATHER_COLS:
                    if c in self.futr_exog:
                        df[c] = W[c].to_numpy()
            parts.append(df)
        return pd.concat(parts, ignore_index=True)

    def fit(self, gd: GroupData, final: bool = False, **_) -> dict:
        import torch

        t0 = time.time()
        torch.set_float32_matmul_precision("high")
        if final:
            steps = int(self.best_step or self.hparams["max_steps"])
            self.nf = self._build(max_steps=steps, early_stop=False)
            df = self._train_df(gd, None)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                self.nf.fit(df=df, val_size=0)
            info = {"max_steps": steps, "n_rows": int(len(df))}
        else:
            self.nf = self._build(max_steps=self.hparams["max_steps"], early_stop=True)
            df = self._train_df(gd, gd.val_end)  # train + val (val chỉ cho early stopping)
            val_size = int(gd.idx(gd.val_end) - gd.idx(gd.train_end))
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                self.nf.fit(df=df, val_size=val_size)
            m = self.nf.models[0]
            vt = list(getattr(m, "valid_trajectories", []) or [])
            tt = list(getattr(m, "train_trajectories", []) or [])
            if vt:
                best = min(vt, key=lambda x: x[1])
                self.best_step = int(max(best[0], self.hparams["val_check_steps"]))
            else:
                self.best_step = int(self.hparams["max_steps"])
            info = {"val_size": val_size, "n_rows": int(len(df)), "best_step": self.best_step,
                    "steps_run": int(tt[-1][0]) if tt else None,
                    "valid_trajectory": [(int(s), float(l)) for s, l in vt]}
        info["train_seconds"] = round(time.time() - t0, 2)
        info["device"] = torch_device()
        return info

    def _ctx_frames(self, ctx: Contexts):
        L = self.hparams["input_size"]
        c = ctx.tail(L)
        N = len(c.origins)
        rows, futr = [], []
        for i in range(N):
            past = _naive_ds(c.past_index(i))
            fut = _naive_ds(c.future_index(i))
            hs, hc = _hour_feats(past)
            fs, fc = _hour_feats(fut)
            Yfill = fill_nan_2d(c.Y[i])
            for j, t in enumerate(C.TARGETS):
                uid = f"{i:05d}|{t}"
                d = {"unique_id": uid, "ds": past, "y": Yfill[:, j],
                     "available_mask": np.isfinite(c.Y[i, :, j]).astype(np.float32)}
                f = {"unique_id": uid, "ds": fut}
                if "hour_sin" in self.futr_exog:
                    d["hour_sin"], d["hour_cos"] = hs, hc
                    f["hour_sin"], f["hour_cos"] = fs, fc
                for k, wc in enumerate(C.WEATHER_COLS):
                    if wc in self.futr_exog:
                        d[wc] = c.W_past[i, :, k]
                        f[wc] = c.W_futr[i, :, k]
                rows.append(pd.DataFrame(d))
                futr.append(pd.DataFrame(f))
        return pd.concat(rows, ignore_index=True), pd.concat(futr, ignore_index=True)

    def predict(self, ctx: Contexts) -> dict:
        assert self.nf is not None, "model not fitted"
        df, futr = self._ctx_frames(ctx)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            if self.futr_exog:
                fc = self.nf.predict(df=df, futr_df=futr)
            else:
                fc = self.nf.predict(df=df)
        fc = fc.reset_index() if "unique_id" not in fc.columns else fc
        cols = [c for c in fc.columns if c.startswith(self.key)]
        med = next(c for c in cols if c.endswith("median") or c == self.key)
        lo = next((c for c in cols if "-lo-" in c), None)
        hi = next((c for c in cols if "-hi-" in c), None)
        fc = fc.sort_values(["unique_id", "ds"])
        N, H, n = len(ctx.origins), ctx.H, len(C.TARGETS)
        uid_order = [f"{i:05d}|{t}" for i in range(N) for t in C.TARGETS]
        fc = fc.set_index("unique_id").loc[uid_order]

        def arr(col):
            return fc[col].to_numpy(dtype="float64").reshape(N, n, H)

        if lo and hi:
            q = np.sort(np.stack([arr(lo), arr(med), arr(hi)]), axis=0)  # chống "quantile crossing"
            return {"yhat": arr(med), "lo": q[0], "hi": q[2]}
        return {"yhat": arr(med), "lo": None, "hi": None}

    def save(self, d: Path) -> None:
        d.mkdir(parents=True, exist_ok=True)
        self.nf.save(path=str(d), overwrite=True, save_dataset=False)
        (d / "ml_meta.json").write_text(json.dumps({"best_step": self.best_step, "hparams": self.hparams,
                                                    "futr_exog": self.futr_exog}, indent=1), encoding="utf-8")

    @classmethod
    def load(cls, d: Path, key: str, group: str) -> "NeuralForecaster":
        from neuralforecast import NeuralForecast

        meta = json.loads((d / "ml_meta.json").read_text(encoding="utf-8"))
        obj = cls(key, group)
        obj.hparams = meta["hparams"]
        obj.futr_exog = meta["futr_exog"]
        obj.best_step = meta.get("best_step")
        kw = {}
        if torch_device() != "cuda":
            kw["accelerator"] = "cpu"
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            obj.nf = NeuralForecast.load(path=str(d), **kw)
        return obj


# --------------------------------------------------------------------------- Chronos-Bolt
_CHRONOS_PIPE = None


def get_chronos_pipeline():
    global _CHRONOS_PIPE
    if _CHRONOS_PIPE is None:
        import torch
        from chronos import BaseChronosPipeline

        dev = torch_device()
        _CHRONOS_PIPE = BaseChronosPipeline.from_pretrained(
            C.CHRONOS_MODEL_ID, device_map=dev, torch_dtype=torch.float32)
    return _CHRONOS_PIPE


class ChronosForecaster:
    """Zero-shot (không huấn luyện lại). Ngữ cảnh tối đa 2048 bước (giới hạn của Chronos-Bolt)."""

    key = "chronos"
    probabilistic = True

    def __init__(self, group: str, context_length: int = 2048, batch_size: int = 64):
        self.group = group
        self.context_length = context_length
        self.batch_size = batch_size

    def fit(self, gd: GroupData, final: bool = False, **_) -> dict:
        t0 = time.time()
        get_chronos_pipeline()
        return {"train_seconds": 0.0, "load_seconds": round(time.time() - t0, 2), "zero_shot": True,
                "model_id": C.CHRONOS_MODEL_ID, "device": torch_device()}

    def predict(self, ctx: Contexts) -> dict:
        import torch

        pipe = get_chronos_pipeline()
        c = ctx.tail(self.context_length)
        N, L, n = c.Y.shape
        series = np.transpose(c.Y, (0, 2, 1)).reshape(N * n, L)
        # bỏ NaN ở đầu chuỗi (Chronos tự xử lý NaN bên trong qua mask)
        qs = []
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            for s in range(0, len(series), self.batch_size):
                batch = torch.tensor(series[s:s + self.batch_size], dtype=torch.float32)
                q, _ = pipe.predict_quantiles(batch, prediction_length=ctx.H, quantile_levels=list(C.QUANTILES))
                qs.append(q.cpu().numpy())
        q = np.concatenate(qs, axis=0).reshape(N, n, ctx.H, 3)
        return {"yhat": q[..., 1], "lo": q[..., 0], "hi": q[..., 2]}
