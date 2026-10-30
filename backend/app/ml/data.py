"""Nạp & tiền xử lý dữ liệu cảm biến cho pipeline dự báo.

Các bước (mọi lựa chọn được ghi lại trong metrics.json["preprocessing"] và docs/MODELS.md):
 1. Nạp dữ liệu thô: InfluxDB 3 (app.services.influx_service.query_sensor_df) hoặc soil_all.json.
    Key thời gian là giờ địa phương Asia/Ho_Chi_Minh, chấp nhận "HH:MM" và "HH:MM:SS".
 2. Quy tắc hợp lệ từng điểm (nhân quả, không nhìn tương lai):
    - Ngoài miền vật lý (config.VALID_RANGES) -> NaN (không clip về biên).
    - temperature == 0 VÀ humidity == 0 cùng lúc -> lỗi đọc DHT20 -> NaN cả hai.
    - EC, N, P, K đồng thời == 0 -> lỗi đọc Modbus CWT -> NaN cả bốn.
 3. Resample về lưới 5 phút (trung bình trong [t, t+5'), nhãn = đầu bucket), bất kể chu kỳ lấy mẫu 5 s - 24 h.
 4. Lọc ngoại lai Hampel: cửa sổ trượt 7 điểm (±15'), |x - median| > 5 * 1.4826 * max(MAD, sàn) -> NaN.
    Sàn MAD theo độ phân giải cảm biến để tránh đánh dấu nhầm khi chuỗi gần như hằng.
 5. Nội suy tuyến tính chỉ các khoảng trống <= 30 phút (6 điểm) nằm giữa 2 điểm hợp lệ;
    khoảng trống dài hơn giữ NaN (mô hình xử lý bằng mask / NaN-aware).
 6. Nhóm dài hạn: trung bình theo giờ, cần >= 6/12 điểm 5' hợp lệ, ngược lại NaN.

Khi đánh giá rolling-origin, bước 4-5 được chạy LẠI chỉ trên lịch sử trước thời điểm phát dự báo
(make_context) nên không có rò rỉ thông tin tương lai qua tiền xử lý.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C

log = logging.getLogger("ml.data")

HAMPEL_WINDOW = 7
HAMPEL_NSIGMA = 5.0
MAX_INTERP_GAP = 6  # 6 x 5' = 30'
HOURLY_MIN_COUNT = 6
MAD_FLOOR = {
    "temperature": 0.2, "humidity": 0.5, "soiltemp": 0.2, "moisture": 0.5,
    "pH": 0.05, "EC": 0.02, "N": 5.0, "P": 5.0, "K": 5.0,
}

PREPROCESSING_DOC = {
    "validity_rules": {
        "out_of_range_to_nan": C.VALID_RANGES,
        "dht20_zero_pair": "temperature==0 and humidity==0 -> both NaN (DHT20 read failure)",
        "cwt_zero_block": "EC==N==P==K==0 simultaneously -> those 4 NaN (Modbus read failure)",
        "dropped_columns": ["light"],
    },
    "resample": "mean on 5-min grid, label = bucket start, Asia/Ho_Chi_Minh",
    "outliers": f"Hampel centered window={HAMPEL_WINDOW} (±15 min), threshold={HAMPEL_NSIGMA}*1.4826*max(MAD, floor), floor={MAD_FLOOR}",
    "interpolation": f"linear, only interior gaps <= {MAX_INTERP_GAP} steps (30 min); longer gaps stay NaN",
    "hourly": f"mean of 5-min values per hour (label = hour start), requires >= {HOURLY_MIN_COUNT}/12 valid points",
    "causal_eval_cleaning": "in rolling-origin evaluation the Hampel+interpolation is re-run on the history before each origin only",
    "metric_actuals": "metrics are computed only on actually observed (non-imputed, non-outlier) target points",
}


# --------------------------------------------------------------------------- raw loading
def load_json_raw(path: Path | None = None) -> pd.DataFrame:
    if path is None:
        try:
            from app.services.sensor_processing_service import get_cleaned_sensor_dataframe_sync

            df_clean = get_cleaned_sensor_dataframe_sync(method="ffill")
            if df_clean is not None and not df_clean.empty:
                df = df_clean[C.TARGETS].copy()
                idx = pd.to_datetime(df.index, errors="coerce")
                df = df[~idx.isna()]
                idx = idx[~idx.isna()]
                if idx.tz is None:
                    df.index = idx.tz_localize(C.TZ, ambiguous="NaT", nonexistent="shift_forward")
                else:
                    df.index = idx.tz_convert(C.TZ)
                df = df[~df.index.isna()].sort_index()
                df = df[~df.index.duplicated(keep="last")]
                df.index.name = "time"
                return df
        except Exception as exc:  # noqa: BLE001
            log.warning("Fallback to direct JSON file read (%s)", exc)

    path = Path(path or C.JSON_PATH)
    with open(path, "r", encoding="utf-8") as f:
        obj = json.load(f)
    data = obj.get("data", obj)
    ts, rows = [], []
    for day, recs in data.items():
        if not isinstance(recs, dict):
            continue
        for key, rec in recs.items():
            k = key if len(key) > 5 else key + ":00"
            ts.append(f"{day} {k}")
            rec = rec if isinstance(rec, dict) else {}
            rows.append([_to_float(rec.get(t)) for t in C.TARGETS])
    idx = pd.to_datetime(pd.Index(ts), format="%Y-%m-%d %H:%M:%S", errors="coerce")
    df = pd.DataFrame(np.array(rows, dtype="float64").reshape(-1, len(C.TARGETS)), index=idx, columns=C.TARGETS)
    df = df[~df.index.isna()]
    df.index = df.index.tz_localize(C.TZ, ambiguous="NaT", nonexistent="shift_forward")
    df = df[~df.index.isna()].sort_index()
    df = df[~df.index.duplicated(keep="last")]
    df.index.name = "time"
    return df


def _to_float(v) -> float:
    try:
        if v is None:
            return np.nan
        return float(v)
    except (TypeError, ValueError):
        return np.nan


def load_influx_raw(start: datetime | None = None, end: datetime | None = None) -> pd.DataFrame:
    from app.services import influx_service  # lazy: module do main agent quản lý

    df = influx_service.query_sensor_df(start, end)
    if df is None or len(df) == 0:
        return pd.DataFrame(columns=C.TARGETS, dtype="float64")
    df = df.copy()
    if not isinstance(df.index, pd.DatetimeIndex):
        for col in ("time", "_time", "timestamp"):
            if col in df.columns:
                df = df.set_index(col)
                break
        df.index = pd.to_datetime(df.index)
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    df.index = df.index.tz_convert(C.TZ)
    for t in C.TARGETS:
        if t not in df.columns:
            df[t] = np.nan
    df = df[C.TARGETS].apply(pd.to_numeric, errors="coerce").sort_index()
    df = df[~df.index.duplicated(keep="last")]
    df.index.name = "time"
    return df


def load_raw(source: str | None = None, start: datetime | None = None,
             end: datetime | None = None) -> tuple[pd.DataFrame, str]:
    """Trả về (df thô, nguồn đã dùng). auto = influx nếu truy cập được và >= 7 ngày dữ liệu."""
    source = (source or C.DATA_SOURCE or "auto").lower()
    if source in ("auto", "influx"):
        try:
            df = load_influx_raw(start, end)
            span = (df.index.max() - df.index.min()) if len(df) else timedelta(0)
            if source == "influx" or span >= timedelta(days=7):
                if len(df):
                    return df, "influx"
            log.info("Influx has only %s of data -> fallback json", span)
        except Exception as e:  # noqa: BLE001
            if source == "influx":
                raise
            log.info("Influx unavailable (%s) -> fallback json", e)
    df = load_json_raw()
    if start is not None:
        df = df[df.index >= _to_local(start)]
    if end is not None:
        df = df[df.index <= _to_local(end)]
    return df, "json"


def _to_local(t) -> pd.Timestamp:
    t = pd.Timestamp(t)
    return t.tz_convert(C.TZ) if t.tzinfo is not None else t.tz_localize(C.TZ)


# --------------------------------------------------------------------------- cleaning
def apply_validity_rules(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    dht0 = (df["temperature"] == 0) & (df["humidity"] == 0)
    df.loc[dht0, ["temperature", "humidity"]] = np.nan
    cwt0 = (df["EC"] == 0) & (df["N"] == 0) & (df["P"] == 0) & (df["K"] == 0)
    df.loc[cwt0, ["EC", "N", "P", "K"]] = np.nan
    for t, (lo, hi) in C.VALID_RANGES.items():
        s = df[t]
        df[t] = s.where((s >= lo) & (s <= hi))
    return df


def resample_5min(df: pd.DataFrame, start=None, end=None) -> pd.DataFrame:
    out = df.resample("5min", label="left", closed="left").mean()
    if len(out):
        s = pd.Timestamp(start) if start is not None else out.index.min()
        e = pd.Timestamp(end) if end is not None else out.index.max()
        out = out.reindex(pd.date_range(s.floor("5min"), e.floor("5min"), freq="5min", tz=C.TZ, name="time"))
    return out


def hampel_mask(df: pd.DataFrame) -> pd.DataFrame:
    """True = ngoại lai."""
    med = df.rolling(HAMPEL_WINDOW, center=True, min_periods=3).median()
    mad = (df - med).abs().rolling(HAMPEL_WINDOW, center=True, min_periods=3).median()
    floor = pd.Series(MAD_FLOOR)[df.columns]
    scale = 1.4826 * np.maximum(mad, floor.values[None, :])
    return ((df - med).abs() > HAMPEL_NSIGMA * scale).fillna(False)


def interpolate_short_gaps(df: pd.DataFrame, max_gap: int = MAX_INTERP_GAP) -> pd.DataFrame:
    out = df.copy()
    for c in df.columns:
        s = df[c]
        isna = s.isna()
        if not isna.any():
            continue
        grp = (~isna).cumsum()
        gap_len = isna.groupby(grp).transform("sum")
        filled = s.interpolate(method="linear", limit_area="inside")
        out[c] = s.where(~(isna & (gap_len <= max_gap)), filled)
    return out


def make_grid(raw: pd.DataFrame, start=None, end=None) -> pd.DataFrame:
    """Bước nhân quả (từng điểm/bucket): quy tắc hợp lệ + resample lưới 5'."""
    return resample_5min(apply_validity_rules(raw[C.TARGETS]), start, end)


def clean_grid(g: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Hampel + nội suy khoảng trống ngắn trên lưới 5'. Trả về (giá trị, mask quan sát thực)."""
    out_mask = hampel_mask(g)
    g = g.mask(out_mask)
    observed = g.notna()
    return interpolate_short_gaps(g), observed


def clean_5min(raw: pd.DataFrame, start=None, end=None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """raw (bất kỳ chu kỳ) -> (df 5' đã làm sạch, mask quan sát thực = True)."""
    g = make_grid(raw, start, end)
    out_mask = hampel_mask(g)
    g = g.mask(out_mask)
    observed = g.notna()
    g = interpolate_short_gaps(g)
    return g, observed


def to_hourly(df5: pd.DataFrame, observed5: pd.DataFrame | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    r = df5.resample("1h", label="left", closed="left")
    cnt = r.count()
    h = r.mean().where(cnt >= HOURLY_MIN_COUNT)
    if observed5 is not None:
        obs = observed5.resample("1h", label="left", closed="left").sum() >= HOURLY_MIN_COUNT
    else:
        obs = h.notna()
    return h, obs & h.notna()


def data_summary(df5: pd.DataFrame, observed: pd.DataFrame, raw: pd.DataFrame) -> dict:
    return {
        "start": df5.index.min().isoformat(),
        "end": df5.index.max().isoformat(),
        "n_raw_records": int(len(raw)),
        "n_grid_points_5min": int(len(df5)),
        "observed_fraction": {t: round(float(observed[t].mean()), 4) for t in C.TARGETS},
        "missing_after_cleaning_fraction": {t: round(float(df5[t].isna().mean()), 4) for t in C.TARGETS},
    }


# --------------------------------------------------------------------------- weather
def _align_weather(w: pd.DataFrame) -> pd.DataFrame:
    """Đưa thời tiết Open-Meteo về bucket [HH, HH+1) như dữ liệu cảm biến theo giờ.

    Biến tức thời (gắn nhãn HH = giá trị tại HH): bucket = trung bình (HH, HH+1).
    Biến tích lũy giờ trước (nhãn HH+1 = tổng HH..HH+1): bucket = giá trị tại HH+1.
    """
    w = w.copy()
    if w.index.tz is None:
        w.index = w.index.tz_localize(C.TZ)
    w.index = w.index.tz_convert(C.TZ)
    w = w[~w.index.duplicated(keep="last")].sort_index()
    full = pd.date_range(w.index.min().floor("1h"), w.index.max().floor("1h"), freq="1h", tz=C.TZ)
    w = w.reindex(full)
    cols = [c for c in C.WEATHER_COLS if c in w.columns]
    out = pd.DataFrame(index=full)
    for c in cols:
        s = pd.to_numeric(w[c], errors="coerce")
        if c in C.WEATHER_ACCUM_COLS:
            out[c] = s.shift(-1)
        else:
            out[c] = (s + s.shift(-1)) / 2.0
    out.index.name = "time"
    return out


def get_weather_hourly(start: date, end: date, allow_cache: bool = True) -> tuple[pd.DataFrame | None, str]:
    """Thời tiết theo giờ (bucket-aligned) cho [start, end]. Trả về (df|None, mô tả nguồn)."""
    if not C.USE_WEATHER:
        return None, "disabled (ML_USE_WEATHER=0)"
    err = None
    try:
        from app.services import weather_service  # lazy

        w = weather_service.get_weather_hourly_df(start, end)
        if w is not None and len(w):
            w = _align_weather(w)
            if allow_cache:
                try:
                    _merge_weather_cache(w)
                except Exception as e:  # noqa: BLE001
                    log.warning("weather cache write failed: %s", e)
            return w, "app.services.weather_service (Open-Meteo ERA5 archive + forecast)"
    except Exception as e:  # noqa: BLE001
        err = e
        log.warning("weather_service unavailable: %s", e)
    if allow_cache and C.WEATHER_CACHE_PATH.exists():
        w = pd.read_parquet(C.WEATHER_CACHE_PATH)
        s = pd.Timestamp(start).tz_localize(C.TZ)
        e = pd.Timestamp(end).tz_localize(C.TZ) + pd.Timedelta(days=1)
        w = w[(w.index >= s) & (w.index < e)]
        if len(w):
            return w, f"artifacts cache {C.WEATHER_CACHE_PATH.name} (weather_service error: {err})"
    return None, f"unavailable ({err})"


def _merge_weather_cache(w: pd.DataFrame) -> None:
    C.ensure_dirs()
    if C.WEATHER_CACHE_PATH.exists():
        old = pd.read_parquet(C.WEATHER_CACHE_PATH)
        w = pd.concat([old[~old.index.isin(w.index)], w]).sort_index()
    w.to_parquet(C.WEATHER_CACHE_PATH)


def weather_for_index(weather: pd.DataFrame | None, idx: pd.DatetimeIndex) -> pd.DataFrame | None:
    """Reindex thời tiết theo lưới giờ, nội suy/ffill/bfill để không còn NaN (cho mô hình neural)."""
    if weather is None:
        return None
    w = weather.reindex(pd.DatetimeIndex(weather.index.union(idx))).sort_index()
    w = w.interpolate(method="linear", limit_direction="both").ffill().bfill()
    w = w.reindex(idx)
    return w
