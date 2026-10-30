"""Cửa sổ ngữ cảnh (rolling-origin) và đặc trưng cho XGBoost.

Quy ước thời gian: origin T_o = thời điểm của BƯỚC DỰ BÁO ĐẦU TIÊN. Ngữ cảnh gồm L bước
[T_o - L*Δ, T_o - Δ]; chỉ dùng quan sát có nhãn < T_o. Bước k (1..H) có nhãn T_o + (k-1)*Δ.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import config as C
from . import data as D


@dataclass
class Contexts:
    group: str
    origins: pd.DatetimeIndex  # [N]
    Y: np.ndarray  # [N, L, n_targets] (NaN = thiếu)
    valid: np.ndarray  # [N, n_targets] ngữ cảnh đủ dữ liệu để dự báo
    W_past: np.ndarray | None  # [N, L, n_weather]
    W_futr: np.ndarray | None  # [N, H, n_weather]
    step: pd.Timedelta
    L: int
    H: int

    def past_index(self, i: int) -> pd.DatetimeIndex:
        return pd.date_range(end=self.origins[i] - self.step, periods=self.L, freq=self.step)

    def future_index(self, i: int) -> pd.DatetimeIndex:
        return pd.date_range(start=self.origins[i], periods=self.H, freq=self.step)

    def tail(self, L: int) -> "Contexts":
        L = min(L, self.L)
        return Contexts(self.group, self.origins, self.Y[:, -L:], self.valid,
                        None if self.W_past is None else self.W_past[:, -L:], self.W_futr,
                        self.step, L, self.H)


def group_step(group: str) -> pd.Timedelta:
    return pd.Timedelta(minutes=C.GROUPS[group]["resolution_minutes"])


def make_contexts(grid5: pd.DataFrame, group: str, origins, L: int,
                  weather: pd.DataFrame | None = None) -> Contexts:
    """Tạo ngữ cảnh cho mỗi origin, làm sạch (Hampel + nội suy) CHỈ trên lịch sử < origin."""
    cfg = C.GROUPS[group]
    H = cfg["H"]
    step = group_step(group)
    five = pd.Timedelta(minutes=5)
    origins = pd.DatetimeIndex(origins)
    N, n = len(origins), len(C.TARGETS)
    Y = np.full((N, L, n), np.nan, dtype="float64")
    margin = five * (D.HAMPEL_WINDOW // 2 + 1)
    for i, T in enumerate(origins):
        start = T - L * step
        sl = grid5.loc[(grid5.index >= start - margin) & (grid5.index < T)]
        assert len(sl) == 0 or sl.index.max() < T, "leakage: context contains data at/after origin"
        full = pd.date_range(start - margin, T - five, freq="5min", tz=C.TZ)
        sl = sl.reindex(full)
        vals, obs = D.clean_grid(sl)
        if group == "long":
            vals, _ = D.to_hourly(vals, obs)
        idx = pd.date_range(start, T - step, freq=step, tz=C.TZ)
        Y[i] = vals.reindex(idx)[C.TARGETS].to_numpy(dtype="float64")
    fin = np.isfinite(Y)
    recent = 12
    vw = min(L, cfg["input_size"])  # độ đủ dữ liệu xét trên cửa sổ đầu vào chuẩn của nhóm
    valid = (fin[:, -vw:, :].mean(axis=1) >= 0.5) & fin[:, -recent:, :].any(axis=1)

    W_past = W_futr = None
    if group == "long" and weather is not None:
        nw = len(weather.columns)
        W_past = np.zeros((N, L, nw))
        W_futr = np.zeros((N, H, nw))
        all_idx = pd.date_range(origins.min() - L * step, origins.max() + (H - 1) * step, freq=step, tz=C.TZ)
        Wf = D.weather_for_index(weather, all_idx)
        for i, T in enumerate(origins):
            W_past[i] = Wf.loc[pd.date_range(T - L * step, T - step, freq=step, tz=C.TZ)].to_numpy()
            W_futr[i] = Wf.loc[pd.date_range(T, T + (H - 1) * step, freq=step, tz=C.TZ)].to_numpy()
    return Contexts(group, origins, Y, valid, W_past, W_futr, step, L, H)


def actuals_for(values: pd.DataFrame, observed: pd.DataFrame, origins, group: str) -> np.ndarray:
    """Giá trị thực [N, n_targets, H] — chỉ các điểm quan sát thực (không nội suy/ngoại lai)."""
    H = C.GROUPS[group]["H"]
    step = group_step(group)
    v = values[C.TARGETS].where(observed[C.TARGETS])
    out = np.full((len(origins), len(C.TARGETS), H), np.nan)
    for i, T in enumerate(origins):
        idx = pd.date_range(T, T + (H - 1) * step, freq=step, tz=C.TZ)
        out[i] = v.reindex(idx).to_numpy().T
    return out


def fill_nan_2d(a: np.ndarray) -> np.ndarray:
    """Nội suy tuyến tính theo trục 0 (thời gian), ffill/bfill 2 đầu; cột toàn NaN -> 0."""
    a = np.array(a, dtype="float64", copy=True)
    x = np.arange(a.shape[0])
    for j in range(a.shape[1]):
        col = a[:, j]
        m = np.isfinite(col)
        if m.all():
            continue
        if not m.any():
            a[:, j] = 0.0
            continue
        a[:, j] = np.interp(x, x[m], col[m])
    return a


# --------------------------------------------------------------------------- XGBoost features
XGB_SPECS = {
    "short": {"lags": [1, 2, 3, 6, 12, 24, 48, 72, 144, 288], "rmean": [6, 12, 36, 72, 288],
              "rstd": [12, 72, 288], "cross_diff": 12, "profile_days": 2, "lookback": 576},
    "long": {"lags": [1, 2, 3, 6, 12, 24, 48, 72, 168], "rmean": [6, 12, 24, 72, 168],
             "rstd": [24, 168], "cross_diff": 24, "profile_days": 7, "lookback": 336},
}


def _ffill(a: np.ndarray, block_len: int | None = None) -> np.ndarray:
    df = pd.DataFrame(a)
    if block_len:
        grp = np.arange(len(df)) // block_len
        return df.groupby(grp).ffill().groupby(grp).bfill().to_numpy()
    return df.ffill().bfill().to_numpy()


class FeatureBase:
    """Tính sẵn các mảng dùng chung cho mọi target trên một chuỗi 2D Y [T, n]."""

    def __init__(self, Y: np.ndarray, W: np.ndarray | None, group: str, block_len: int | None = None):
        self.group = group
        self.spec = XGB_SPECS[group]
        self.Y = Y
        self.Yf = _ffill(Y, block_len)
        df = pd.DataFrame(self.Yf)
        self.rmean = {w: df.rolling(w, min_periods=max(1, w // 2)).mean().to_numpy() for w in self.spec["rmean"]}
        self.rstd = {w: df.rolling(w, min_periods=max(2, w // 2)).std().to_numpy() for w in self.spec["rstd"]}
        self.W = W
        if W is not None:
            names = [c for c in C.WEATHER_COLS][: W.shape[1]]
            self.wnames = names
            Wz = np.nan_to_num(W, nan=0.0)
            self.Wcum = np.cumsum(Wz, axis=0)

    def features(self, i0: np.ndarray, h: np.ndarray, j: int, hour0: np.ndarray) -> tuple[np.ndarray, list[str]]:
        sp = self.spec
        m = C.GROUPS[self.group]["season"]
        step_h = C.GROUPS[self.group]["resolution_minutes"] / 60.0
        i0 = np.asarray(i0, dtype=np.int64)
        h = np.asarray(h, dtype=np.int64)
        Yf = self.Yf
        level = Yf[i0, j]
        cols, names = [level], ["level"]

        def take(idx, jj=j):
            assert (idx <= i0).all(), "leakage: feature index after origin"
            assert (i0 - idx < sp["lookback"]).all(), "lookback exceeds context"
            return Yf[idx, jj]

        for l in sp["lags"]:
            cols.append(take(i0 - l) - level); names.append(f"lag{l}")
        for w, a in self.rmean.items():
            cols.append(a[i0, j] - level); names.append(f"rmean{w}")
        for w, a in self.rstd.items():
            cols.append(a[i0, j]); names.append(f"rstd{w}")
        k0 = np.ceil(h / m).astype(np.int64)
        s_vals = []
        for d in range(sp["profile_days"]):
            s_vals.append(take(i0 + h - m * (k0 + d)) - level)
        cols.append(s_vals[0]); names.append("seas1")
        cols.append(s_vals[1]); names.append("seas2")
        prof = np.nanmean(np.vstack(s_vals), axis=0) if len(s_vals) > 2 else (s_vals[0] + s_vals[1]) / 2
        cols.append(prof); names.append(f"seas_mean{sp['profile_days']}d")
        d = sp["cross_diff"]
        for jj, t in enumerate(C.TARGETS):
            cols.append(Yf[i0, jj]); names.append(f"x_{t}")
            cols.append(Yf[i0, jj] - take(i0 - d, jj)); names.append(f"xd_{t}")
        hour_t = (hour0 + h * step_h) % 24
        cols += [h.astype(float), np.sin(2 * np.pi * hour_t / 24), np.cos(2 * np.pi * hour_t / 24),
                 np.sin(2 * np.pi * hour0 / 24), np.cos(2 * np.pi * hour0 / 24)]
        names += ["h", "hour_t_sin", "hour_t_cos", "hour0_sin", "hour0_cos"]
        if self.W is not None:
            # thời tiết tại thời điểm mục tiêu là covariate "biết trước" (dự báo Open-Meteo khi suy luận)
            for k, wn in enumerate(self.wnames):
                cols.append(self.W[i0 + h, k]); names.append(f"w_{wn}")
            for wn in ("precipitation", "et0_fao_evapotranspiration", "shortwave_radiation"):
                if wn in self.wnames:
                    k = self.wnames.index(wn)
                    cols.append(self.Wcum[i0 + h, k] - self.Wcum[i0, k]); names.append(f"wcum_{wn}")
                    cols.append(self.Wcum[i0, k] - self.Wcum[np.maximum(i0 - 24, 0), k]); names.append(f"wpast24_{wn}")
        X = np.column_stack(cols).astype(np.float32)
        return X, names


def stack_contexts(ctx: Contexts, L: int):
    """Ghép ngữ cảnh thành chuỗi dài [N*(L+H), n] (+ thời tiết) để tái dùng FeatureBase khi suy luận."""
    N, n, H = ctx.Y.shape[0], ctx.Y.shape[2], ctx.H
    Y = np.full((N, L + H, n), np.nan)
    Y[:, :L] = ctx.Y[:, -L:]
    Y = Y.reshape(N * (L + H), n)
    W = None
    if ctx.W_past is not None and ctx.W_futr is not None:
        nw = ctx.W_past.shape[2]
        W = np.concatenate([ctx.W_past[:, -L:], ctx.W_futr], axis=1).reshape(N * (L + H), nw)
    i0 = np.arange(N) * (L + H) + L - 1
    return Y, W, i0
