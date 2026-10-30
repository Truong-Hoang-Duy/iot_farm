"""Dịch vụ thời tiết Open-Meteo (miễn phí, không cần API key).

Nguồn dữ liệu
-------------
* Dữ liệu cũ  : Historical Weather API (ERA5 reanalysis) – https://archive-api.open-meteo.com/v1/archive
                (trễ khoảng 5 ngày so với hiện tại).
* Gần đây + dự báo: Forecast API – https://api.open-meteo.com/v1/forecast (past_days ≤ 92, forecast_days ≤ 16).

Trích dẫn: Zippenfenig, P. (2023). Open-Meteo.com Weather API. Zenodo. https://doi.org/10.5281/zenodo.7970649
           Hersbach, H. et al. (2020). The ERA5 global reanalysis. QJRMS. https://doi.org/10.1002/qj.3803

Mọi DataFrame trả về có index giờ (tz-aware, Asia/Ho_Chi_Minh), các cột theo HOURLY_VARS
(+ soil_temperature / soil_moisture được chuẩn hoá tên giữa 2 API).
"""
from __future__ import annotations

import json
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import pandas as pd

from app.core.config import (
    CACHE_DIR,
    FARM_LAT,
    FARM_LON,
    FARM_TZ,
    WEATHER_FORECAST_TTL_SEC,
)

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# Biến chung có ở cả 2 API
HOURLY_VARS: List[str] = [
    "temperature_2m",
    "relative_humidity_2m",
    "dew_point_2m",
    "precipitation",
    "rain",
    "cloud_cover",
    "shortwave_radiation",
    "et0_fao_evapotranspiration",
    "vapour_pressure_deficit",
    "wind_speed_10m",
    "surface_pressure",
]
# Biến đất: tên khác nhau giữa 2 API -> chuẩn hoá
ARCHIVE_SOIL = {"soil_temperature_0_to_7cm": "soil_temperature", "soil_moisture_0_to_7cm": "soil_moisture"}
FORECAST_SOIL = {"soil_temperature_6cm": "soil_temperature", "soil_moisture_3_to_9cm": "soil_moisture"}
ALL_COLUMNS: List[str] = HOURLY_VARS + ["soil_temperature", "soil_moisture"]

CURRENT_VARS = [
    "temperature_2m", "relative_humidity_2m", "apparent_temperature", "precipitation", "rain",
    "cloud_cover", "wind_speed_10m", "wind_direction_10m", "weather_code", "is_day",
    "surface_pressure", "shortwave_radiation",
]
DAILY_VARS = [
    "temperature_2m_max", "temperature_2m_min", "precipitation_sum", "precipitation_probability_max",
    "et0_fao_evapotranspiration", "shortwave_radiation_sum", "weather_code",
]

ARCHIVE_DELAY_DAYS = 6          # ERA5 trễ ~5 ngày, chừa thêm 1 ngày an toàn
WEATHER_DIR: Path = CACHE_DIR / "weather"
_lock = threading.Lock()
_forecast_cache: Dict[str, Any] = {"at": 0.0, "payload": None}


def _tz_today() -> date:
    return pd.Timestamp.now(tz=FARM_TZ).date()


def _client() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0), follow_redirects=True)


def _hourly_to_df(hourly: Dict[str, Any], rename: Dict[str, str]) -> pd.DataFrame:
    if not hourly or "time" not in hourly:
        return pd.DataFrame(columns=ALL_COLUMNS)
    df = pd.DataFrame(hourly)
    df["time"] = pd.to_datetime(df["time"]).dt.tz_localize(FARM_TZ, nonexistent="shift_forward", ambiguous="NaT")
    df = df.dropna(subset=["time"]).set_index("time").rename(columns=rename)
    for col in ALL_COLUMNS:
        if col not in df.columns:
            df[col] = float("nan")
    return df[ALL_COLUMNS].astype("float64")


def _coord_key(lat: Optional[float] = None, lon: Optional[float] = None) -> tuple[float, float, str]:
    la = round(float(lat if lat is not None else FARM_LAT), 4)
    lo = round(float(lon if lon is not None else FARM_LON), 4)
    return la, lo, f"{la:.4f}_{lo:.4f}"


# ---------------------------------------------------------------------------
# Archive (ERA5) – cache theo tháng
# ---------------------------------------------------------------------------
def _archive_cache_path(year: int, month: int, coord_tag: str = "") -> Path:
    suffix = f"_{coord_tag}" if coord_tag else ""
    return WEATHER_DIR / f"archive_{year:04d}-{month:02d}{suffix}.parquet"


def _fetch_archive(start: date, end: date, lat: Optional[float] = None, lon: Optional[float] = None) -> pd.DataFrame:
    la, lo, _ = _coord_key(lat, lon)
    params = {
        "latitude": la,
        "longitude": lo,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "hourly": ",".join(HOURLY_VARS + list(ARCHIVE_SOIL.keys())),
        "timezone": FARM_TZ,
    }
    with _client() as c:
        r = c.get(ARCHIVE_URL, params=params)
        r.raise_for_status()
        return _hourly_to_df(r.json().get("hourly", {}), ARCHIVE_SOIL)


def get_archive_df(start: date, end: date, lat: Optional[float] = None, lon: Optional[float] = None) -> pd.DataFrame:
    """ERA5 hourly cho [start, end] (cắt tại ngày hiện tại - ARCHIVE_DELAY_DAYS). Cache parquet theo tháng."""
    la, lo, tag = _coord_key(lat, lon)
    default_tag = f"{round(FARM_LAT, 4):.4f}_{round(FARM_LON, 4):.4f}"
    coord_tag = "" if tag == default_tag else tag

    last_ok = _tz_today() - timedelta(days=ARCHIVE_DELAY_DAYS)
    end = min(end, last_ok)
    if start > end:
        return pd.DataFrame(columns=ALL_COLUMNS)
    WEATHER_DIR.mkdir(parents=True, exist_ok=True)
    frames: List[pd.DataFrame] = []
    cur = date(start.year, start.month, 1)
    while cur <= end:
        nxt = (pd.Timestamp(cur) + pd.offsets.MonthBegin(1)).date()
        m_start, m_end = cur, min(nxt - timedelta(days=1), last_ok)
        path = _archive_cache_path(cur.year, cur.month, coord_tag)
        month_complete = (nxt - timedelta(days=1)) <= last_ok
        df_m: Optional[pd.DataFrame] = None
        if path.exists():
            try:
                df_m = pd.read_parquet(path)
                # tháng chưa đủ -> làm mới nếu cache thiếu những ngày đã có trên ERA5
                if not month_complete and (df_m.index.max().date() < m_end):
                    df_m = None
            except Exception:
                df_m = None
        if df_m is None:
            df_m = _fetch_archive(m_start, m_end, la, lo)
            if not df_m.empty:
                df_m.to_parquet(path)
        frames.append(df_m)
        cur = nxt
    df = pd.concat(frames).sort_index() if frames else pd.DataFrame(columns=ALL_COLUMNS)
    df = df[~df.index.duplicated(keep="last")]
    lo_ts = pd.Timestamp(start, tz=FARM_TZ)
    hi_ts = pd.Timestamp(end + timedelta(days=1), tz=FARM_TZ)
    return df[(df.index >= lo_ts) & (df.index < hi_ts)]


# ---------------------------------------------------------------------------
# Forecast API (gần đây + tương lai) – cache trong bộ nhớ + file
# ---------------------------------------------------------------------------
def get_forecast_payload(force: bool = False, lat: Optional[float] = None, lon: Optional[float] = None) -> Dict[str, Any]:
    """JSON gốc từ Forecast API: hourly (92 ngày trước + 16 ngày tới), daily, current."""
    la, lo, tag = _coord_key(lat, lon)
    with _lock:
        now = time.time()
        cached_entry = _forecast_cache.get(tag)
        if not force and cached_entry and cached_entry.get("payload") and now - cached_entry.get("at", 0.0) < WEATHER_FORECAST_TTL_SEC:
            return cached_entry["payload"]
        params = {
            "latitude": la,
            "longitude": lo,
            "hourly": ",".join(HOURLY_VARS + list(FORECAST_SOIL.keys()) + ["precipitation_probability"]),
            "daily": ",".join(DAILY_VARS),
            "current": ",".join(CURRENT_VARS),
            "past_days": 92,
            "forecast_days": 16,
            "timezone": FARM_TZ,
        }
        default_tag = f"{round(FARM_LAT, 4):.4f}_{round(FARM_LON, 4):.4f}"
        cache_file = WEATHER_DIR / ("forecast_latest.json" if tag == default_tag else f"forecast_{tag}.json")
        try:
            with _client() as c:
                r = c.get(FORECAST_URL, params=params)
                r.raise_for_status()
                payload = r.json()
            WEATHER_DIR.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(payload), encoding="utf-8")
        except Exception as exc:  # mất mạng -> dùng bản cache gần nhất nếu có
            if cached_entry and cached_entry.get("payload"):
                return cached_entry["payload"]
            if cache_file.exists():
                payload = json.loads(cache_file.read_text(encoding="utf-8"))
                payload["_stale"] = True
                payload["_error"] = str(exc)
            else:
                raise
        _forecast_cache[tag] = {"at": now, "payload": payload}
        return payload


def get_forecast_df(force: bool = False, lat: Optional[float] = None, lon: Optional[float] = None) -> pd.DataFrame:
    payload = get_forecast_payload(force=force, lat=lat, lon=lon)
    df = _hourly_to_df(payload.get("hourly", {}), FORECAST_SOIL)
    hp = payload.get("hourly", {}).get("precipitation_probability")
    if hp is not None and len(hp) == len(df):
        df["precipitation_probability"] = pd.Series(hp, index=df.index, dtype="float64")
    return df


# ---------------------------------------------------------------------------
# API hợp nhất (dùng cho ML + Dashboard)
# ---------------------------------------------------------------------------
def get_weather_hourly_df(start: date, end: date, lat: Optional[float] = None, lon: Optional[float] = None) -> pd.DataFrame:
    """Thời tiết hourly [start, end] (theo ngày địa phương). Ưu tiên ERA5 cho quá khứ xa,
    Forecast API (past_days/forecast_days) cho ~92 ngày gần đây và 16 ngày tới.
    Thêm cột `kind` ('archive' | 'forecast')."""
    if isinstance(start, datetime):
        start = start.date()
    if isinstance(end, datetime):
        end = end.date()
    parts: List[pd.DataFrame] = []
    try:
        arch = get_archive_df(start, end, lat=lat, lon=lon)
        if not arch.empty:
            arch = arch.copy()
            arch["kind"] = "archive"
            parts.append(arch)
    except Exception as exc:
        print(f"[Weather] Lỗi tải ERA5 archive: {exc}")
    try:
        fc = get_forecast_df(lat=lat, lon=lon)
        lo = pd.Timestamp(start, tz=FARM_TZ)
        hi = pd.Timestamp(end + timedelta(days=1), tz=FARM_TZ)
        fc = fc[(fc.index >= lo) & (fc.index < hi)].copy()
        if not fc.empty:
            fc["kind"] = "forecast"
            parts.append(fc)
    except Exception as exc:
        print(f"[Weather] Lỗi tải Forecast API: {exc}")
    if not parts:
        return pd.DataFrame(columns=ALL_COLUMNS + ["kind"])
    df = pd.concat(parts).sort_index()
    # archive được ưu tiên khi trùng giờ (đã đo/tái phân tích, chính xác hơn dự báo)
    df["_prio"] = (df["kind"] == "archive").astype(int)
    df = df.sort_values("_prio").loc[lambda d: ~d.index.duplicated(keep="last")].sort_index()
    return df.drop(columns="_prio")


def df_to_records(df: pd.DataFrame) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if df is None or df.empty:
        return out
    for ts, row in df.iterrows():
        rec: Dict[str, Any] = {"t": ts.isoformat()}
        for k, v in row.items():
            if isinstance(v, float) and pd.isna(v):
                rec[k] = None
            elif hasattr(v, "item"):
                rec[k] = v.item()
            else:
                rec[k] = v
        out.append(rec)
    return out


def get_current(lat: Optional[float] = None, lon: Optional[float] = None) -> Dict[str, Any]:
    la, lo, _ = _coord_key(lat, lon)
    payload = get_forecast_payload(lat=la, lon=lo)
    return {
        "location": {"lat": la, "lon": lo},
        "timezone": payload.get("timezone", FARM_TZ),
        "current": payload.get("current", {}),
        "current_units": payload.get("current_units", {}),
        "stale": bool(payload.get("_stale", False)),
    }


def get_daily_forecast(days: int = 16, lat: Optional[float] = None, lon: Optional[float] = None) -> List[Dict[str, Any]]:
    payload = get_forecast_payload(lat=lat, lon=lon)
    daily = payload.get("daily", {}) or {}
    times = daily.get("time", []) or []
    today = _tz_today().isoformat()
    rows = []
    for i, t in enumerate(times):
        if t < today:
            continue
        rows.append({k: (daily[k][i] if i < len(daily.get(k, [])) else None) for k in daily.keys() if k != "time"} | {"t": t})
    return rows[:days]


def summarize_next_hours(hours: int = 24, lat: Optional[float] = None, lon: Optional[float] = None) -> Dict[str, Any]:
    """Tóm tắt thời tiết N giờ tới – dùng cho khuyến nghị tưới/bón phân."""
    try:
        fc = get_forecast_df(lat=lat, lon=lon)
    except Exception as exc:
        return {"available": False, "error": str(exc)}
    now = pd.Timestamp.now(tz=FARM_TZ).floor("h")
    nxt = fc[(fc.index >= now) & (fc.index < now + pd.Timedelta(hours=hours))]
    if nxt.empty:
        return {"available": False}

    def _r(x: Any, n: int = 1) -> Optional[float]:
        return None if pd.isna(x) else round(float(x), n)

    return {
        "available": True,
        "hours": hours,
        "precip_total_mm": _r(nxt["precipitation"].sum()),
        "precip_prob_max": _r(nxt["precipitation_probability"].max(), 0) if "precipitation_probability" in nxt else None,
        "rain_hours": int((nxt["precipitation"] > 0.1).sum()),
        "temp_min": _r(nxt["temperature_2m"].min()),
        "temp_max": _r(nxt["temperature_2m"].max()),
        "rh_mean": _r(nxt["relative_humidity_2m"].mean(), 0),
        "et0_total_mm": _r(nxt["et0_fao_evapotranspiration"].sum(), 2),
        "radiation_mean": _r(nxt["shortwave_radiation"].mean(), 0),
    }

