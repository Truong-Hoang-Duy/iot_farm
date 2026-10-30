"""Nguồn dữ liệu cảm biến hợp nhất cho API lịch sử / tương quan:
InfluxDB (ưu tiên) -> fallback file soil_all.json (dữ liệu thật 261 ngày)."""
from __future__ import annotations

import json
import threading
from datetime import date, datetime, timedelta
from typing import Optional, Tuple

import httpx
import pandas as pd

from app.core.config import CACHE_DIR, FARM_TZ, FIREBASE_DB_URL, SENSOR_FIELDS, SOIL_JSON_PATH
from app.services import influx_service as ix

_json_lock = threading.Lock()
_json_df: Optional[pd.DataFrame] = None


def invalidate_json_df_cache() -> None:
    global _json_df
    with _json_lock:
        _json_df = None

EVERY_MAP = {
    "raw": None, "1m": "1 minute", "5m": "5 minutes", "10m": "10 minutes", "15m": "15 minutes",
    "30m": "30 minutes", "1h": "1 hour", "3h": "3 hours", "6h": "6 hours", "1d": "1 day",
}
PANDAS_FREQ = {"1m": "1min", "5m": "5min", "10m": "10min", "15m": "15min", "30m": "30min",
               "1h": "1h", "3h": "3h", "6h": "6h", "1d": "1D"}


def _read_raw_soil_json() -> dict:
    candidates = [
        SOIL_JSON_PATH,
        CACHE_DIR / "soil_all.json",
    ]
    for path in candidates:
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception as e:
                print(f"[SensorData] Lỗi đọc {path}: {e}")

    # Fallback cho container Render khi không có thư mục frontend/public/soil_all.json
    with httpx.Client(timeout=35.0) as client:
        res = client.get(f"{FIREBASE_DB_URL}/data.json")
        res.raise_for_status()
        fb_data = res.json() or {}
    payload = fb_data if "data" in fb_data else {"data": fb_data}
    try:
        cache_path = CACHE_DIR / "soil_all.json"
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    except Exception as e:
        print(f"[SensorData] Không thể lưu cache soil_all.json: {e}")
    return payload


def load_json_df() -> pd.DataFrame:
    global _json_df
    with _json_lock:
        if _json_df is not None:
            return _json_df
        from app.services.sensor_processing_service import get_cleaned_sensor_dataframe_sync
        df_clean = get_cleaned_sensor_dataframe_sync(method="ffill")
        idx = pd.to_datetime(df_clean.index)
        if idx.tz is None:
            idx = idx.tz_localize(FARM_TZ)
        else:
            idx = idx.tz_convert(FARM_TZ)
        df_clean = df_clean.copy()
        df_clean.index = idx
        df_clean.index.name = "time"
        _json_df = df_clean.sort_index()
        return _json_df


def _to_ts(x: Optional[date | datetime], end: bool = False) -> Optional[pd.Timestamp]:
    if x is None:
        return None
    if isinstance(x, datetime):
        ts = pd.Timestamp(x)
        return ts.tz_localize(FARM_TZ) if ts.tzinfo is None else ts.tz_convert(FARM_TZ)
    ts = pd.Timestamp(x, tz=FARM_TZ)
    return ts + pd.Timedelta(days=1) if end else ts


def get_sensor_df(
    start: Optional[date | datetime] = None,
    end: Optional[date | datetime] = None,
    every: str = "5m",
    source: str = "auto",
) -> Tuple[pd.DataFrame, str]:
    """-> (DataFrame, nguồn). `end` dạng date được hiểu là bao gồm cả ngày đó."""
    lo, hi = _to_ts(start), _to_ts(end, end=True)
    if source in ("auto", "influx"):
        try:
            df = ix.query_sensor_df(lo.to_pydatetime() if lo is not None else None,
                                    hi.to_pydatetime() if hi is not None else None,
                                    every=EVERY_MAP.get(every, "5 minutes"))
            if not df.empty or source == "influx":
                return df, "influx"
        except Exception as exc:
            if source == "influx":
                raise
            print(f"[SensorData] InfluxDB không khả dụng ({exc}); dùng soil_all.json")
    df = load_json_df()
    if lo is not None:
        df = df[df.index >= lo]
    if hi is not None:
        df = df[df.index < hi]
    freq = PANDAS_FREQ.get(every)
    if freq and not df.empty:
        df = df.resample(freq).mean()
    return df, "json"


def latest_timestamp(source: str = "auto") -> Optional[pd.Timestamp]:
    if source in ("auto", "influx"):
        try:
            r = ix.sensor_time_range()
            if r.get("tmax"):
                return pd.Timestamp(r["tmax"], tz="UTC").tz_convert(FARM_TZ) if pd.Timestamp(r["tmax"]).tzinfo is None \
                    else pd.Timestamp(r["tmax"]).tz_convert(FARM_TZ)
        except Exception:
            pass
    df = load_json_df()
    return df.index.max() if not df.empty else None

