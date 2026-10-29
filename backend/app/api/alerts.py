from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Body
from app.services.alerts_service import (
    generate_alerts_from_latest_data,
    insert_mock_latest_sensor_data,
    delete_mock_latest_sensor_data,
)

router = APIRouter(prefix="/alerts", tags=["AI Alerts & Anomaly Detection"])


@router.get("/latest")
async def get_latest_ai_alerts(refresh: bool = False):
    """
    Lấy danh sách cảnh báo được phân tích từ mẫu dữ liệu của ngày mới nhất bằng Gemini AI.
    """
    try:
        return await generate_alerts_from_latest_data(force_refresh=refresh)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi phân tích cảnh báo: {e}")


@router.post("/analyze")
async def analyze_latest_alerts_with_gemini():
    """
    Gửi mẫu đo của ngày mới nhất vào Gemini AI để phân tích lại và cập nhật lên trình duyệt.
    """
    try:
        return await generate_alerts_from_latest_data(force_refresh=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi gọi Gemini phân tích cảnh báo: {e}")


@router.post("/test-mock")
async def create_mock_test_and_analyze(
    custom_reading: Optional[Dict[str, float]] = Body(default=None),
):
    """
    Insert dữ liệu giả của ngày hiện tại mới nhất, truyền Prompt vào Gemini AI
    và đồng bộ cảnh báo trả về lên Firebase / trình duyệt.
    """
    try:
        await insert_mock_latest_sensor_data(custom_reading=custom_reading)
        return await generate_alerts_from_latest_data(force_refresh=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi tạo dữ liệu giả và phân tích cảnh báo: {e}")


@router.delete("/test-mock")
async def remove_mock_test_and_restore():
    """
    Xóa dữ liệu giả của ngày mới nhất sau khi kiểm tra xong và khôi phục về dữ liệu thực tế (31/08/2026).
    """
    try:
        deleted_info = await delete_mock_latest_sensor_data()
        restored = await generate_alerts_from_latest_data(force_refresh=True)
        return {
            "message": f"Đã xóa dữ liệu test ngày {deleted_info.get('deleted_date')} và khôi phục về dữ liệu thực tế.",
            "deleted": deleted_info,
            "data": restored,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi xóa dữ liệu giả: {e}")
