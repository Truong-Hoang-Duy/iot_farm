from datetime import datetime
from typing import Optional
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from app.core.config import FARM_TZ, SENSOR_FIELDS
from app.services.sensor_data_service import EVERY_MAP, get_sensor_df
from app.services.sensor_processing_service import (
    build_nested_data_from_df,
    get_processed_sensor_bundle,
    sync_soil_all_from_firebase,
)

router = APIRouter(prefix="/sensors", tags=["Sensor Data"])


def _parse_dt(v: Optional[str]) -> Optional[datetime]:
    if not v:
        return None
    ts = pd.Timestamp(v)
    ts = ts.tz_localize(FARM_TZ) if ts.tzinfo is None else ts.tz_convert(FARM_TZ)
    return ts.to_pydatetime()


@router.get("/data")
async def get_cleaned_sensor_data(
    method: str = Query(
        "ffill",
        description="Phương pháp điền khuyết: ffill, median, knn, mice",
    ),
    cap: Optional[str] = Query(
        None,
        description="Xử lý ngoại lệ: iqr hoặc zscore",
    ),
    smoothing: bool = Query(
        False,
        description="Làm trơn trung bình trượt 1 giờ",
    ),
    days: Optional[int] = Query(
        None,
        ge=1,
        le=365,
        description="Giới hạn số ngày gần nhất trả về trong trường data (mặc định trả toàn bộ)",
    ),
    refresh: bool = Query(
        False,
        description="Buộc tải lại dữ liệu gốc từ Firebase",
    ),
):
    """Trả về dữ liệu cảm biến đã được xử lý làm sạch tại Backend."""
    try:
        bundle = await get_processed_sensor_bundle(
            method=method,
            cap=cap,
            smoothing=smoothing,
            force_refresh=refresh,
        )
        nested = await run_in_threadpool(build_nested_data_from_df, bundle["df_clean"], days)
        return {
            "data": nested,
            "latest": bundle["latest"],
            "summary": bundle["summary"],
            "stage_averages": bundle["stage_averages"],
            "pipeline_info": bundle["pipeline_info"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi xử lý dữ liệu cảm biến: {e}")


@router.get("/history")
async def get_cleaned_sensor_history(
    start: Optional[str] = Query(None, description="ISO datetime hoặc YYYY-MM-DD"),
    end: Optional[str] = Query(None, description="ISO datetime hoặc YYYY-MM-DD"),
    every: str = Query("5m", description="raw|1m|5m|10m|15m|30m|1h|3h|6h|1d"),
    fields: Optional[str] = Query(None, description="Danh sách trường phân cách bởi dấu phẩy"),
):
    """Trả về chuỗi thời gian lịch sử cảm biến đã qua làm sạch từ pipeline của sensors.py."""
    if every not in EVERY_MAP:
        raise HTTPException(status_code=400, detail=f"every không hợp lệ, chọn: {', '.join(EVERY_MAP)}")
    flist = [f.strip() for f in fields.split(",")] if fields else SENSOR_FIELDS
    flist = [f for f in flist if f in SENSOR_FIELDS] or SENSOR_FIELDS
    s, e = _parse_dt(start), _parse_dt(end)
    try:
        # Đảm bảo bộ đệm dữ liệu đã xử lý luôn sẵn sàng
        await get_processed_sensor_bundle(method="ffill")
        df, src = await run_in_threadpool(get_sensor_df, s, e, every, "json")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Không đọc được dữ liệu cảm biến đã xử lý: {exc}")
    df = df[[f for f in flist if f in df.columns]]
    rows = []
    for ts, row in df.iterrows():
        rec = {"t": ts.isoformat()}
        for f, v in row.items():
            rec[f] = None if pd.isna(v) else round(float(v), 4)
        rows.append(rec)
    return {"fields": flist, "every": every, "source": f"processed_{src}", "count": len(rows), "rows": rows, "points": rows}


@router.get("/latest")
async def get_latest_cleaned_sensor(
    method: str = Query("ffill", description="Phương pháp điền khuyết: ffill, median, knn, mice"),
    refresh: bool = Query(False, description="Buộc đồng bộ lại từ Firebase"),
):
    """Trả về mẫu đo cảm biến mới nhất đã qua xử lý làm sạch."""
    try:
        bundle = await get_processed_sensor_bundle(method=method, force_refresh=refresh)
        return {
            **bundle["latest"],
            "pipeline_info": bundle["pipeline_info"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi đọc mẫu cảm biến mới nhất: {e}")


@router.get("/stages-summary")
async def get_stages_cleaned_summary(
    method: str = Query("ffill", description="Phương pháp điền khuyết: ffill, median, knn, mice"),
    cap: Optional[str] = Query(None, description="Xử lý ngoại lệ: iqr hoặc zscore"),
    smoothing: bool = Query(False, description="Làm trơn trung bình trượt 1 giờ"),
    refresh: bool = Query(False, description="Buộc đồng bộ lại từ Firebase"),
):
    """Trả về dữ liệu cảm biến trung bình theo từng giai đoạn phát triển của cây trồng."""
    try:
        bundle = await get_processed_sensor_bundle(
            method=method,
            cap=cap,
            smoothing=smoothing,
            force_refresh=refresh,
        )
        return {
            "latest": bundle["latest"],
            "summary": bundle["summary"],
            "stage_averages": bundle["stage_averages"],
            "pipeline_info": bundle["pipeline_info"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi tổng hợp dữ liệu theo giai đoạn: {e}")


@router.post("/sync-soil-json")
async def sync_soil_json_endpoint():
    """Kéo dữ liệu mới nhất từ Firebase Realtime Database về cập nhật file soil_all.json và làm mới cache."""
    try:
        sync_info = await sync_soil_all_from_firebase()
        bundle = await get_processed_sensor_bundle(method="ffill", force_refresh=False)
        return {
            **sync_info,
            "pipeline_info": bundle["pipeline_info"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi đồng bộ soil_all.json từ Firebase: {e}")
