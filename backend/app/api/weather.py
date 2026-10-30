"""API thời tiết (Open-Meteo) + phân tích tương quan thời tiết ↔ cảm biến."""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from app.core.config import FARM_LAT, FARM_LON, FARM_TZ, SENSOR_FIELDS
from app.services import weather_service as ws
from app.services.sensor_data_service import get_sensor_df, latest_timestamp

router = APIRouter(prefix="/weather", tags=["Weather (Open-Meteo)"])

CORR_WEATHER_VARS = [
    "temperature_2m",
    "relative_humidity_2m",
    "vapour_pressure_deficit",
    "shortwave_radiation",
    "et0_fao_evapotranspiration",
    "precipitation_24h",
    "precipitation_72h",
    "water_balance_24h",
    "soil_temperature",
    "soil_moisture",
]
LABELS = {
    "temperature_2m": "Nhiệt độ KK chuẩn 2m (Open-Meteo)",
    "relative_humidity_2m": "Độ ẩm KK chuẩn 2m (Open-Meteo)",
    "vapour_pressure_deficit": "Thâm hụt áp suất hơi VPD",
    "shortwave_radiation": "Bức xạ mặt trời sóng ngắn",
    "et0_fao_evapotranspiration": "Bốc thoát hơi chuẩn FAO ET0",
    "precipitation": "Lượng mưa giờ",
    "precipitation_24h": "Tổng mưa tích lũy 24h",
    "precipitation_72h": "Tổng mưa tích lũy 72h (Rửa trôi)",
    "water_balance_24h": "Cân bằng nước 24h (P − ET0)",
    "soil_temperature": "Nhiệt độ đất tầng rễ (ERA5-Land)",
    "soil_moisture": "Độ ẩm đất tầng rễ (ERA5-Land)",
    "temperature": "Nhiệt độ KK (cảm biến)",
    "humidity": "Độ ẩm KK (cảm biến)",
    "soiltemp": "Nhiệt độ đất (cảm biến)",
    "moisture": "Độ ẩm đất (cảm biến)",
    "pH": "pH đất",
    "EC": "EC đất",
    "N": "Đạm N",
    "P": "Lân P",
    "K": "Kali K",
}


def _loc(lat: Optional[float] = None, lon: Optional[float] = None) -> Dict[str, Any]:
    return {
        "location": {
            "lat": float(lat if lat is not None else FARM_LAT),
            "lon": float(lon if lon is not None else FARM_LON),
        },
        "timezone": FARM_TZ,
    }


def _enrich_agro_features(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return df
    out = df.copy()
    if "precipitation" in out.columns:
        out["precipitation_24h"] = out["precipitation"].rolling(24, min_periods=1).sum().round(2)
        out["precipitation_72h"] = out["precipitation"].rolling(72, min_periods=1).sum().round(2)
    if "et0_fao_evapotranspiration" in out.columns:
        et0_24h = out["et0_fao_evapotranspiration"].rolling(24, min_periods=1).sum()
        if "precipitation_24h" in out.columns:
            out["water_balance_24h"] = (out["precipitation_24h"] - et0_24h).round(2)
    return out


def _clean(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (float, np.floating)):
        return None if (math.isnan(v) or math.isinf(v)) else round(float(v), 4)
    return v


@router.get("/current")
async def weather_current(
    lat: Optional[float] = Query(None, description="Vĩ độ trang trại"),
    lon: Optional[float] = Query(None, description="Kinh độ trang trại"),
):
    try:
        cur = await run_in_threadpool(ws.get_current, lat, lon)
        cur["next24h"] = await run_in_threadpool(ws.summarize_next_hours, 24, lat, lon)
        cur["next48h"] = await run_in_threadpool(ws.summarize_next_hours, 48, lat, lon)
        df = await run_in_threadpool(ws.get_forecast_df, False, lat, lon)
        df = _enrich_agro_features(df)
        now = pd.Timestamp.now(tz=FARM_TZ).floor("h")
        win = df[(df.index >= now - pd.Timedelta(hours=12)) & (df.index <= now + pd.Timedelta(hours=48))].copy()
        win["kind"] = "forecast"
        cur["hourly"] = ws.df_to_records(win)
        return cur
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Không lấy được dữ liệu thời tiết: {exc}")


@router.get("/forecast")
async def weather_forecast(
    days: int = Query(7, ge=1, le=16),
    lat: Optional[float] = Query(None, description="Vĩ độ trang trại"),
    lon: Optional[float] = Query(None, description="Kinh độ trang trại"),
):
    try:
        df = await run_in_threadpool(ws.get_forecast_df, False, lat, lon)
        df = _enrich_agro_features(df)
        now = pd.Timestamp.now(tz=FARM_TZ).floor("h")
        fut = df[(df.index >= now) & (df.index < now + pd.Timedelta(days=days))].copy()
        fut["kind"] = "forecast"
        daily = await run_in_threadpool(ws.get_daily_forecast, days, lat, lon)
        return {**_loc(lat, lon), "days": days, "hourly": ws.df_to_records(fut), "daily": daily}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Không lấy được dự báo thời tiết: {exc}")


@router.get("/history")
async def weather_history(
    start: date = Query(..., description="YYYY-MM-DD"),
    end: Optional[date] = Query(None, description="YYYY-MM-DD (mặc định hôm nay)"),
    lat: Optional[float] = Query(None, description="Vĩ độ trang trại"),
    lon: Optional[float] = Query(None, description="Kinh độ trang trại"),
):
    end = end or pd.Timestamp.now(tz=FARM_TZ).date()
    if end < start:
        raise HTTPException(status_code=400, detail="end phải >= start")
    if (end - start).days > 400:
        raise HTTPException(status_code=400, detail="Khoảng tối đa 400 ngày")
    try:
        df = await run_in_threadpool(ws.get_weather_hourly_df, start - timedelta(days=3), end, lat, lon)
        df = _enrich_agro_features(df)
        now = pd.Timestamp.now(tz=FARM_TZ)
        lo_ts = pd.Timestamp(start, tz=FARM_TZ)
        df = df[(df.index >= lo_ts) & (df.index <= now)]
        return {**_loc(lat, lon), "start": start.isoformat(), "end": end.isoformat(), "hourly": ws.df_to_records(df)}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Không lấy được dữ liệu thời tiết cũ: {exc}")


def _correlation(
    days: int,
    method: str,
    max_lag_h: int,
    end: Optional[date],
    lat: Optional[float] = None,
    lon: Optional[float] = None,
) -> Dict[str, Any]:
    from scipy import stats

    last = pd.Timestamp(end, tz=FARM_TZ) + pd.Timedelta(days=1) if end else latest_timestamp()
    if last is None:
        raise HTTPException(status_code=404, detail="Chưa có dữ liệu cảm biến")
    start_ts = (last - pd.Timedelta(days=days)).floor("h")
    sensor, source = get_sensor_df(start_ts.to_pydatetime(), last.to_pydatetime(), every="1h")
    if sensor.empty:
        raise HTTPException(status_code=404, detail="Không có dữ liệu cảm biến trong khoảng đã chọn")
    sensor.index = sensor.index.floor("h")
    sensor = sensor.groupby(level=0).mean()
    weather = ws.get_weather_hourly_df(start_ts.date() - timedelta(days=3), last.date(), lat=lat, lon=lon)
    if weather.empty:
        raise HTTPException(status_code=503, detail="Không lấy được dữ liệu thời tiết cho khoảng này")
    weather = weather.drop(columns=["kind"], errors="ignore")
    weather = _enrich_agro_features(weather)
    wvars = [v for v in CORR_WEATHER_VARS if v in weather.columns and weather[v].notna().sum() > 24]
    svars = [v for v in SENSOR_FIELDS if v in sensor.columns and sensor[v].notna().sum() > 24]
    joined = sensor[svars].join(weather[wvars], how="inner")
    n = int(len(joined.dropna(how="all")))

    matrix: List[List[Optional[float]]] = []
    pvals: List[List[Optional[float]]] = []
    best_lag: List[List[Optional[int]]] = []
    best_corr: List[List[Optional[float]]] = []
    for w in wvars:
        row, prow, lrow, crow = [], [], [], []
        for s in svars:
            pair = joined[[w, s]].dropna()
            if len(pair) < 24 or pair[w].std() == 0 or pair[s].std() == 0:
                row.append(None); prow.append(None); lrow.append(None); crow.append(None)
                continue
            if method == "spearman":
                r, p = stats.spearmanr(pair[w], pair[s])
            else:
                r, p = stats.pearsonr(pair[w], pair[s])
            row.append(_clean(r)); prow.append(_clean(p))
            # độ trễ: thời tiết tại t ảnh hưởng cảm biến tại t+lag
            best = (0, r)
            for lag in range(1, max_lag_h + 1):
                shifted = joined[s].shift(-lag)
                pr = pd.concat([joined[w], shifted], axis=1).dropna()
                if len(pr) < 24:
                    break
                rr = pr.iloc[:, 0].corr(pr.iloc[:, 1], method="spearman" if method == "spearman" else "pearson")
                if pd.notna(rr) and abs(rr) > abs(best[1]):
                    best = (lag, rr)
            lrow.append(int(best[0])); crow.append(_clean(best[1]))
        matrix.append(row); pvals.append(prow); best_lag.append(lrow); best_corr.append(crow)

    # Insights
    pairs = []
    for i, w in enumerate(wvars):
        for j, s in enumerate(svars):
            r = matrix[i][j]
            p = pvals[i][j]
            if r is not None and p is not None and p < 0.05:
                pairs.append((abs(r), r, w, s, best_lag[i][j], best_corr[i][j]))
    pairs.sort(reverse=True)
    insights: List[str] = []
    for _, r, w, s, lag, rc in pairs[:6]:
        dirn = "thuận" if r > 0 else "nghịch"
        strength = "rất mạnh" if abs(r) >= 0.8 else "mạnh" if abs(r) >= 0.6 else "trung bình" if abs(r) >= 0.4 else "yếu"
        txt = f"{LABELS.get(w, w)} tương quan {dirn} {strength} với {LABELS.get(s, s)} (r = {r:.2f})"
        if lag and rc is not None and abs(rc) > abs(r) + 0.02:
            txt += f"; mạnh nhất khi trễ {lag} giờ (r = {rc:.2f})"
        insights.append(txt + ".")
    nxt = ws.summarize_next_hours(24, lat=lat, lon=lon)
    if nxt.get("available"):
        if (nxt.get("precip_total_mm") or 0) >= 5:
            insights.append(f"Dự báo mưa {nxt['precip_total_mm']} mm trong 24h tới → nên giảm/hoãn tưới.")
        elif (nxt.get("et0_total_mm") or 0) >= 4:
            insights.append(f"ET0 24h tới khoảng {nxt['et0_total_mm']} mm, gần như không mưa → cần đảm bảo lượng nước tưới.")
    return {
        "method": method, "days": days, "max_lag_h": max_lag_h, "source": source,
        "location": _loc(lat, lon)["location"],
        "period": {"start": start_ts.isoformat(), "end": last.isoformat()},
        "variables_weather": wvars, "variables_sensor": svars, "labels": LABELS,
        "matrix": matrix, "pvalues": pvals, "lag": {"best_lag_h": best_lag, "best_corr": best_corr},
        "n": n, "insights": insights,
    }


@router.get("/correlation")
async def weather_correlation(
    days: int = Query(90, ge=3, le=365),
    method: str = Query("pearson", pattern="^(pearson|spearman)$"),
    max_lag_h: int = Query(24, ge=0, le=72),
    end: Optional[date] = Query(None, description="Ngày kết thúc (mặc định: ngày có dữ liệu cảm biến mới nhất)"),
    lat: Optional[float] = Query(None, description="Vĩ độ trang trại"),
    lon: Optional[float] = Query(None, description="Kinh độ trang trại"),
):
    try:
        return await run_in_threadpool(_correlation, days, method, max_lag_h, end, lat, lon)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Lỗi phân tích tương quan: {exc}")
