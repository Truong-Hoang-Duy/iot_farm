from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from app.services.sensor_processing_service import get_processed_sensor_bundle

router = APIRouter(prefix="/sensors", tags=["Sensor Data"])


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
        return {
            "data": bundle["nested_data"],
            "latest": bundle["latest"],
            "summary": bundle["summary"],
            "stage_averages": bundle["stage_averages"],
            "pipeline_info": bundle["pipeline_info"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi xử lý dữ liệu cảm biến: {e}")


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
