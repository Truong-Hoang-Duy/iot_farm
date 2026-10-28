from datetime import datetime
from fastapi import APIRouter, HTTPException
from app.core.config import is_gemini_configured, GEMINI_MODEL
from app.schemas.recommendation import (
    AdvisorRequest, 
    AdvisorResponse, 
    ChatRequest, 
    ChatResponse
)
from app.services.gemini_service import (
    get_gemini_agronomy_advice, 
    chat_with_gemini
)
from app.services.firebase_service import (
    save_recommendation_to_firebase,
    get_cached_recommendation_from_firebase
)
from app.services.scheduler import run_auto_analysis

router = APIRouter(prefix="/recommendations", tags=["Recommendations & IoT Farm Advisor"])

@router.get("/health")
async def health_check():
    """Kiểm tra tình trạng backend và kết nối IoT Farm."""
    return {
        "status": "healthy",
        "system": "IoT Farm Engine",
        "gemini_configured": is_gemini_configured(),
        "gemini_model": GEMINI_MODEL,
        "server_time": datetime.now().isoformat()
    }

@router.get("/latest")
async def get_latest_cached_recommendation():
    """Lấy bản ghi khuyến nghị mới nhất từ Firebase cache (phản hồi ngay lập tức 0s)."""
    cached = await get_cached_recommendation_from_firebase()
    if cached:
        return cached
    # Nếu chưa có cache, chạy phân tích và trả về
    new_result = await run_auto_analysis(trigger_reason="yêu cầu lần đầu")
    if new_result:
        return new_result
    raise HTTPException(status_code=404, detail="Chưa có dữ liệu cảm biến để tạo khuyến nghị.")

@router.post("/trigger-scheduled-analysis")
async def trigger_analysis_endpoint():
    """Kích hoạt phân tích tự động từ Jetson Nano hoặc hệ thống cảnh báo."""
    result = await run_auto_analysis(trigger_reason="kích hoạt thủ công / sự cố")
    if result:
        return {"status": "success", "message": "Đã phân tích và lưu khuyến nghị vào Firebase.", "data": result}
    raise HTTPException(status_code=500, detail="Không thể thực hiện phân tích tự động.")

@router.post("/ai-advisor", response_model=AdvisorResponse)
async def get_ai_recommendation(payload: AdvisorRequest):
    """
    Sinh phác đồ bón phân, tưới nước và chăm sóc đất dựa trên dữ liệu cảm biến thực tế.
    Tự động đồng bộ kết quả lên Firebase /recommendations/latest.
    """
    sensor_dict = payload.sensor_reading.model_dump()
    result = await get_gemini_agronomy_advice(
        plant_type=payload.plant_type,
        age_days=payload.age_days,
        growth_stage=payload.growth_stage,
        sensor=sensor_dict,
        custom_notes=payload.custom_notes
    )

    # Tự động cập nhật lên Firebase
    result_dict = result.model_dump()
    result_dict["sensor_snapshot"] = sensor_dict
    result_dict["trigger_reason"] = "Người dùng yêu cầu phân tích"
    await save_recommendation_to_firebase(result_dict)

    return result

@router.post("/chat", response_model=ChatResponse)
async def chat_advisor(payload: ChatRequest):
    """
    Hỏi đáp trực tiếp cùng trợ lý ảo Gemini về nông nghiệp và cây ớt.
    """
    sensor_dict = payload.sensor_reading.model_dump() if payload.sensor_reading else None
    history_dicts = [{"role": h.role, "content": h.content} for h in payload.history]
    
    reply = await chat_with_gemini(
        message=payload.message,
        sensor=sensor_dict,
        history=history_dicts
    )
    return ChatResponse(
        reply=reply,
        timestamp=datetime.now().strftime("%H:%M:%S")
    )
