"""LSTM dự báo trực tiếp nhiều bước (seq2vec) viết bằng PyTorch thuần.

Lý do không dùng neuralforecast.LSTM: ở chế độ non-recurrent, bước dự báo k của NF lấy hidden state tại vị trí
(L - H + k) của chuỗi đầu vào, tức bước 1 KHÔNG nhìn thấy H-1 quan sát gần nhất (đã kiểm chứng: MASE@5' ≈ 0.76,
kém xa Naive 0.12). Ở đây dùng kiến trúc kinh điển: LSTM mã hoá toàn bộ cửa sổ -> hidden state cuối h_L
(+ mã hoá biến ngoại sinh tương lai) -> MLP -> H x 3 phân vị (q10, q50, q90).

- Chuẩn hoá theo cửa sổ: (y - median) / IQR của phần đầu vào (chỉ điểm quan sát thật), giống robust scaler.
- Thời tiết: chuẩn hoá z-score với mean/std tính trên TRAIN.
- Loss: pinball (quantile) có mask điểm thiếu; early stopping trên cửa sổ validation, khôi phục trọng số tốt nhất.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C
from .windows import Contexts, fill_nan_2d


def _torch():
    import torch

    return torch


def _hour_feats(idx: pd.DatetimeIndex) -> np.ndarray:
    hr = (idx.hour + idx.minute / 60.0).to_numpy(dtype="float64")
    return np.stack([np.sin(2 * np.pi * hr / 24), np.cos(2 * np.pi * hr / 24)], axis=1)


def _build_net(n_in: int, n_futr: int, H: int, hidden: int, layers: int, dropout: float):
    torch = _torch()
    nn = torch.nn

    class Net(nn.Module):
        def __init__(self):
            super().__init__()
            self.lstm = nn.LSTM(n_in, hidden, num_layers=layers, batch_first=True, dropout=dropout)
            self.futr = nn.Sequential(nn.Linear(H * n_futr, 128), nn.ReLU())
            self.head = nn.Sequential(nn.Linear(hidden + 128 + 1, 256), nn.ReLU(), nn.Dropout(dropout),
                                      nn.Linear(256, H * 3))
            self.H = H

        def forward(self, x, futr, last):
            out, _ = self.lstm(x)
            h = out[:, -1]
            z = torch.cat([h, self.futr(futr.flatten(1)), last], dim=1)
            return self.head(z).view(-1, self.H, 3)

    return Net()


class LSTMDirectForecaster:
    key = "lstm"
    probabilistic = True

    def __init__(self, group: str, quick: bool = False, has_weather: bool = False):
        cfg = C.GROUPS[group]
        self.group = group
        self.quick = quick
        self.use_weather = bool(has_weather and group == "long")
        self.hparams = {
            "h": cfg["H"], "input_size": cfg["input_size"], "hidden_size": 128, "num_layers": 2, "dropout": 0.1,
            "learning_rate": 1e-3, "batch_size": 256, "max_steps": 40 if quick else 2000,
            "val_check_steps": 10 if quick else 100, "early_stop_patience_steps": 3 if quick else 6,
            "max_val_windows": 4096, "loss": "pinball q=(0.1,0.5,0.9)", "scaler": "window robust (median/IQR)",
            "random_seed": C.SEED, "architecture": "LSTM encoder -> last hidden + future-exog MLP -> H x 3 quantiles",
        }
        self.futr_exog = ["hour_sin", "hour_cos"] + (list(C.WEATHER_COLS) if self.use_weather else [])
        self.wstats: dict | None = None
        self.net = None
        self.best_step: int | None = None

    # ---------------------------------------------------------------- data
    def _exog_matrix(self, idx: pd.DatetimeIndex, W: np.ndarray | None) -> np.ndarray:
        X = _hour_feats(idx)
        if self.use_weather:
            mu = np.array(self.wstats["mean"])
            sd = np.array(self.wstats["std"])
            Wz = (np.nan_to_num(W, nan=0.0) - mu) / sd
            X = np.concatenate([X, Wz], axis=1)
        return X.astype(np.float32)

    @staticmethod
    def _scale(yin: np.ndarray, min_in: np.ndarray):
        """yin [B, L] (NaN = thiếu) -> (median, iqr) theo cửa sổ."""
        med = np.nanmedian(yin, axis=1)
        q75, q25 = np.nanpercentile(yin, 75, axis=1), np.nanpercentile(yin, 25, axis=1)
        iqr = q75 - q25
        std = np.nanstd(yin, axis=1)
        iqr = np.where(iqr > 1e-6, iqr, np.where(std > 1e-6, std, 1.0))
        med = np.where(np.isfinite(med), med, 0.0)
        return med, iqr

    def _batch(self, Y, M, X, starts, j_idx):
        """Y [T, n] filled, M [T, n] mask, X [T, F] exog; starts [B]; j_idx [B] -> tensors."""
        L, H = self.hparams["input_size"], self.hparams["h"]
        ar = starts[:, None] + np.arange(L + H)[None, :]
        y = Y[ar, j_idx[:, None]]
        m = M[ar, j_idx[:, None]]
        yin_obs = np.where(m[:, :L] > 0, y[:, :L], np.nan)
        med, iqr = self._scale(yin_obs, None)
        ys = (y - med[:, None]) / iqr[:, None]
        ex = X[ar]
        xin = np.concatenate([ys[:, :L, None], m[:, :L, None], ex[:, :L]], axis=2).astype(np.float32)
        futr = ex[:, L:].astype(np.float32)
        last = ys[:, L - 1:L].astype(np.float32)
        return xin, futr, last, ys[:, L:].astype(np.float32), m[:, L:].astype(np.float32), med, iqr

    def _arrays(self, gd, end):
        v = gd.values[C.TARGETS]
        if end is not None:
            v = v[v.index < end]
        Yraw = v.to_numpy(dtype="float64")
        M = np.isfinite(Yraw).astype(np.float32)
        Y = fill_nan_2d(Yraw)
        W = gd.weather.reindex(v.index).to_numpy() if (self.use_weather and gd.weather is not None) else None
        return v.index, Y, M, W

    def _valid_starts(self, M, lo, hi):
        """start s hợp lệ: cửa sổ [s, s+L+H) nằm trong [lo, hi), đầu vào >= 50% có dữ liệu, đầu ra có >= 1 điểm."""
        L, H = self.hparams["input_size"], self.hparams["h"]
        cs = np.vstack([np.zeros((1, M.shape[1])), np.cumsum(M, axis=0)])
        s = np.arange(max(lo, 0), hi - L - H + 1)
        if len(s) == 0:
            return np.zeros((0, 2), dtype=np.int64)
        in_cnt = cs[s + L] - cs[s]
        out_cnt = cs[s + L + H] - cs[s + L]
        ok = (in_cnt >= 0.5 * L) & (out_cnt >= 1)  # [S, n]
        si, ji = np.nonzero(ok)
        return np.stack([s[si], ji], axis=1)

    # ---------------------------------------------------------------- train
    def _pinball(self, pred, y, m):
        torch = _torch()
        qs = torch.tensor(C.QUANTILES, device=pred.device).view(1, 1, 3)
        d = y.unsqueeze(-1) - pred
        loss = torch.maximum(qs * d, (qs - 1) * d) * m.unsqueeze(-1)
        return loss.sum() / (m.sum() * 3 + 1e-8)

    def fit(self, gd, final: bool = False, **_) -> dict:
        torch = _torch()
        from .models import torch_device

        t0 = time.time()
        torch.manual_seed(C.SEED)
        rng = np.random.default_rng(C.SEED)
        dev = torch_device()
        hp = self.hparams
        L, H = hp["input_size"], hp["h"]
        idx, Y, M, W = self._arrays(gd, None if final else gd.val_end)
        if self.use_weather:
            tr_mask = idx < gd.train_end
            Wt = W[tr_mask] if not final else W
            self.wstats = {"mean": np.nanmean(Wt, axis=0).tolist(),
                           "std": np.where(np.nanstd(Wt, axis=0) > 1e-6, np.nanstd(Wt, axis=0), 1.0).tolist()}
        X = self._exog_matrix(idx, W)
        T = len(Y)
        i_tr = int(idx.searchsorted(gd.train_end))
        if final:
            tr_win = self._valid_starts(M, 0, T)
            va_win = np.zeros((0, 2), dtype=np.int64)
            max_steps = int(self.best_step or hp["max_steps"])
        else:
            tr_win = self._valid_starts(M, 0, i_tr)  # mục tiêu nằm hoàn toàn trong train
            va_win = self._valid_starts(M, i_tr - L, T)  # mục tiêu nằm trong validation
            if len(va_win) > hp["max_val_windows"]:
                va_win = va_win[rng.choice(len(va_win), hp["max_val_windows"], replace=False)]
            max_steps = hp["max_steps"]
        n_futr = X.shape[1]
        self.net = _build_net(2 + n_futr, n_futr, H, hp["hidden_size"], hp["num_layers"], hp["dropout"]).to(dev)
        opt = torch.optim.Adam(self.net.parameters(), lr=hp["learning_rate"])
        sched = torch.optim.lr_scheduler.StepLR(opt, step_size=max(1, max_steps // 3), gamma=0.5)

        def to_t(*arrs):
            return [torch.from_numpy(np.ascontiguousarray(a)).to(dev) for a in arrs]

        val_batches = []
        for b in range(0, len(va_win), 1024):
            w = va_win[b:b + 1024]
            xin, futr, last, yo, mo, _, _ = self._batch(Y, M, X, w[:, 0], w[:, 1])
            val_batches.append((xin, futr, last, yo, mo))

        def val_loss():
            self.net.eval()
            tot, cnt = 0.0, 0.0
            with torch.no_grad():
                for xin, futr, last, yo, mo in val_batches:
                    a = to_t(xin, futr, last, yo, mo)
                    p = self.net(a[0], a[1], a[2])
                    msum = float(a[4].sum())
                    tot += float(self._pinball(p, a[3], a[4])) * msum
                    cnt += msum
            self.net.train()
            return tot / max(cnt, 1.0)

        traj, best, best_state, bad = [], np.inf, None, 0
        self.net.train()
        step = 0
        for step in range(1, max_steps + 1):
            w = tr_win[rng.integers(0, len(tr_win), hp["batch_size"])]
            xin, futr, last, yo, mo, _, _ = self._batch(Y, M, X, w[:, 0], w[:, 1])
            a = to_t(xin, futr, last, yo, mo)
            loss = self._pinball(self.net(a[0], a[1], a[2]), a[3], a[4])
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.net.parameters(), 1.0)
            opt.step()
            sched.step()
            if not final and step % hp["val_check_steps"] == 0:
                vl = val_loss()
                traj.append((step, vl))
                if vl < best - 1e-6:
                    best, bad = vl, 0
                    best_state = {k: v.detach().clone() for k, v in self.net.state_dict().items()}
                    self.best_step = step
                else:
                    bad += 1
                    if bad >= hp["early_stop_patience_steps"]:
                        break
        if best_state is not None:
            self.net.load_state_dict(best_state)
        self.net.eval()
        info = {"device": dev, "train_seconds": round(time.time() - t0, 2), "steps_run": step,
                "n_train_windows": int(len(tr_win)), "n_val_windows": int(len(va_win))}
        if final:
            info["max_steps"] = max_steps
        else:
            info.update(best_step=self.best_step, valid_trajectory=[(int(s), float(v)) for s, v in traj])
        return info

    # ---------------------------------------------------------------- predict
    def predict(self, ctx: Contexts) -> dict:
        torch = _torch()
        from .models import torch_device

        dev = torch_device()
        L, H = self.hparams["input_size"], self.hparams["h"]
        c = ctx.tail(L)
        N, n = c.Y.shape[0], c.Y.shape[2]
        out = np.full((3, N, n, H), np.nan)
        self.net.eval()
        for i in range(N):
            past = c.past_index(i)
            fut = c.future_index(i)
            Wp = c.W_past[i] if (self.use_weather and c.W_past is not None) else None
            Wf = c.W_futr[i] if (self.use_weather and c.W_futr is not None) else None
            Xp = self._exog_matrix(past, Wp)
            Xf = self._exog_matrix(fut, Wf)
            Yr = c.Y[i]  # [L, n]
            Mm = np.isfinite(Yr).astype(np.float32)
            Yf = fill_nan_2d(Yr)
            med, iqr = self._scale(np.where(Mm.T > 0, Yf.T, np.nan), None)
            ys = (Yf.T - med[:, None]) / iqr[:, None]  # [n, L]
            xin = np.concatenate([ys[:, :, None], Mm.T[:, :, None], np.repeat(Xp[None], n, axis=0)], axis=2)
            futr = np.repeat(Xf[None], n, axis=0)
            last = ys[:, -1:]
            with torch.no_grad():
                p = self.net(*[torch.from_numpy(np.ascontiguousarray(a, dtype=np.float32)).to(dev)
                               for a in (xin, futr, last)]).cpu().numpy()  # [n, H, 3]
            p = np.sort(p, axis=2) * iqr[:, None, None] + med[:, None, None]
            for k in range(3):
                out[k, i] = p[:, :, k]
        return {"yhat": out[1], "lo": out[0], "hi": out[2]}

    # ---------------------------------------------------------------- io
    def save(self, d: Path) -> None:
        torch = _torch()
        d.mkdir(parents=True, exist_ok=True)
        torch.save(self.net.state_dict(), d / "lstm_direct.pt")
        (d / "ml_meta.json").write_text(json.dumps({"hparams": self.hparams, "futr_exog": self.futr_exog,
                                                    "use_weather": self.use_weather, "wstats": self.wstats,
                                                    "best_step": self.best_step, "impl": "lstm_direct"}, indent=1),
                                        encoding="utf-8")

    @classmethod
    def load(cls, d: Path, group: str) -> "LSTMDirectForecaster":
        torch = _torch()
        from .models import torch_device

        meta = json.loads((d / "ml_meta.json").read_text(encoding="utf-8"))
        obj = cls(group, has_weather=meta["use_weather"])
        obj.hparams, obj.futr_exog, obj.wstats, obj.best_step = meta["hparams"], meta["futr_exog"], meta["wstats"], meta.get("best_step")
        n_futr = len(obj.futr_exog)
        obj.net = _build_net(2 + n_futr, n_futr, obj.hparams["h"], obj.hparams["hidden_size"], obj.hparams["num_layers"],
                             obj.hparams["dropout"])
        dev = torch_device()
        obj.net.load_state_dict(torch.load(d / "lstm_direct.pt", map_location=dev))
        obj.net.to(dev).eval()
        return obj
