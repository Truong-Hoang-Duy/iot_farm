"""API dữ liệu lịch sử cảm biến (InfluxDB, fallback soil_all.json) và đồng bộ Firebase <-> InfluxDB."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from app.core.config import FARM_TZ, SENSOR_FIELDS
from app.services import influx_service as ix
from app.services.sensor_data_service import EVERY_MAP, get_sensor_df
from app.services.sync_service import get_sync_service

router = APIRouter(tags=["History & Sync"])


def _parse_dt(v: Optional[str]) -> Optional[datetime]:
    if not v:
        return None
    ts = pd.Timestamp(v)
    ts = ts.tz_localize(FARM_TZ) if ts.tzinfo is None else ts.tz_convert(FARM_TZ)
    return ts.to_pydatetime()


@router.get("/history")
async def sensor_history(
    start: Optional[str] = Query(None, description="ISO datetime hoặc YYYY-MM-DD (giờ VN nếu không có offset)"),
    end: Optional[str] = Query(None, description="ISO datetime hoặc YYYY-MM-DD"),
    every: str = Query("5m", description="raw|1m|5m|10m|15m|30m|1h|3h|6h|1d"),
    fields: Optional[str] = Query(None, description="Danh sách trường, phân cách bởi dấu phẩy"),
    source: str = Query("auto", pattern="^(auto|influx|json)$"),
):
    if every not in EVERY_MAP:
        raise HTTPException(status_code=400, detail=f"every không hợp lệ, chọn: {', '.join(EVERY_MAP)}")
    flist = [f.strip() for f in fields.split(",")] if fields else SENSOR_FIELDS
    flist = [f for f in flist if f in SENSOR_FIELDS] or SENSOR_FIELDS
    s, e = _parse_dt(start), _parse_dt(end)
    if s is None and e is None:
        raise HTTPException(status_code=400, detail="Cần ít nhất start hoặc end")
    if s is not None and e is not None and every == "raw" and (e - s).days > 31:
        raise HTTPException(status_code=400, detail="every=raw chỉ cho khoảng ≤ 31 ngày")
    try:
        df, src = await run_in_threadpool(get_sensor_df, s, e, every, source)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Không đọc được dữ liệu: {exc}")
    df = df[[f for f in flist if f in df.columns]]
    rows = []
    for ts, row in df.iterrows():
        rec = {"t": ts.isoformat()}
        for f, v in row.items():
            rec[f] = None if pd.isna(v) else round(float(v), 4)
        rows.append(rec)
    return {"fields": flist, "every": every, "source": src, "count": len(rows), "rows": rows, "points": rows}


@router.get("/sync/status")
async def sync_status():
    svc = get_sync_service()
    st = await run_in_threadpool(svc.status)
    if st.get("influx", {}).get("ok"):
        try:
            st["influx_range"] = await run_in_threadpool(ix.sensor_time_range)
        except Exception as exc:
            st["influx_range"] = {"error": str(exc)}
    else:
        st["influx_range"] = None
    return st


@router.get("/sync/logs")
async def sync_logs(
    limit: int = Query(200, ge=1, le=2000),
    direction: Optional[str] = Query(None, pattern="^(firebase_to_influx|influx_to_firebase)$"),
):
    rows = await run_in_threadpool(ix.query_sync_logs, limit, direction)
    if not rows:  # Influx chưa chạy -> trả log trong bộ nhớ
        rows = [r for r in get_sync_service().recent if not direction or r["direction"] == direction][:limit]
    return {"logs": rows, "count": len(rows)}


@router.post("/sync/run")
async def sync_run(direction: str = Query("both", pattern="^(both|firebase_to_influx|fast)$")):
    svc = get_sync_service()
    if direction == "fast":
        return {"fast": await svc.fast_sync(trigger="manual")}
    if direction == "firebase_to_influx":
        return {"fast": await svc.fast_sync(trigger="manual")}
    return await svc.audit(trigger="manual")
