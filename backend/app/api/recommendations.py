from datetime import datetime
from fastapi import APIRouter, HTTPException
from app.core.config import is_gemini_configured, GEMINI_MODEL
from app.schemas.recommendation import (
    AdvisorRequest,
    AdvisorResponse,
    ChatRequest,
    ChatResponse,
)
from app.services.gemini_service import (
    get_gemini_agronomy_advice,
    chat_with_gemini,
)
from app.services.firebase_service import (
    save_recommendation_to_firebase,
    get_cached_recommendation_from_firebase,
)
from app.services.scheduler import run_auto_analysis, _is_cache_outdated
from app.services.sensor_processing_service import (
    get_current_plant_context,
    resolve_stage_by_age,
)

router = APIRouter(prefix="/recommendations", tags=["Recommendations & IoT Farm Advisor"])


@router.get("/health")
async def health_check():
    """Kiểm tra tình trạng backend và kết nối IoT Farm."""
    return {
        "status": "healthy",
        "system": "IoT Farm Engine",
        "gemini_configured": is_gemini_configured(),
        "gemini_model": GEMINI_MODEL,
        "server_time": datetime.now().isoformat(),
    }


@router.get("/latest")
async def get_latest_cached_recommendation():
    """
    Lấy bản ghi khuyến nghị mới nhất từ DB/Cache.
    Nếu dữ liệu cây trồng hoặc cảm biến đã thay đổi so với bản lưu, tự động phân tích và lưu đè vào DB.
    """
    context = await get_current_plant_context(method="ffill")
    cached = await get_cached_recommendation_from_firebase()

    if cached and not _is_cache_outdated(cached, context):
        return cached

    new_result = await run_auto_analysis(trigger_reason="đồng bộ thay đổi dữ liệu cây trồng")
    if new_result:
        return new_result
    if cached:
        return cached
    raise HTTPException(status_code=404, detail="Chưa có dữ liệu cảm biến để tạo khuyến nghị.")


@router.post("/trigger-scheduled-analysis")
async def trigger_analysis_endpoint():
    """Kích hoạt phân tích tự động và ghi đè kết quả mới nhất vào DB."""
    result = await run_auto_analysis(trigger_reason="kích hoạt thủ công")
    if result:
        return {"status": "success", "message": "Đã phân tích và lưu khuyến nghị vào Firebase.", "data": result}
    raise HTTPException(status_code=500, detail="Không thể thực hiện phân tích tự động.")


@router.post("/ai-advisor", response_model=AdvisorResponse)
async def get_ai_recommendation(payload: AdvisorRequest):
    """
    Sinh phác đồ bón phân, tưới nước và chăm sóc đất trực tiếp từ thông tin cây và cảm biến đã xử lý.
    Ghi đè (overwrite) kết quả mới nhất thẳng vào Firebase /recommendations/latest và local cache.
    """
    context = await get_current_plant_context(method="ffill")

    plant_type = payload.plant_type or context["plant_type"]
    age_days = payload.age_days if payload.age_days and payload.age_days > 0 else context["age_days"]
    if payload.growth_stage:
        growth_stage = payload.growth_stage
    else:
        _, growth_stage = resolve_stage_by_age(age_days)

    if payload.sensor_reading:
        raw_sensor = payload.sensor_reading.model_dump(exclude_none=True)
        sensor_dict = {**context["reading"], **raw_sensor}
    else:
        sensor_dict = context["reading"]

    result = await get_gemini_agronomy_advice(
        plant_type=plant_type,
        age_days=age_days,
        growth_stage=growth_stage,
        sensor=sensor_dict,
        custom_notes=payload.custom_notes,
    )

    result_dict = result.model_dump()
    result_dict["plant_type"] = plant_type
    result_dict["age_days"] = age_days
    result_dict["growth_stage"] = growth_stage
    result_dict["sensor_snapshot"] = {
        "timestamp": context["timestamp"],
        **sensor_dict,
    }
    result_dict["trigger_reason"] = "Người dùng yêu cầu phân tích lại"
    await save_recommendation_to_firebase(result_dict)

    return AdvisorResponse(**result_dict)


@router.post("/chat", response_model=ChatResponse)
async def chat_advisor(payload: ChatRequest):
    """Hỏi đáp trực tiếp cùng trợ lý ảo Gemini về nông nghiệp và cây ớt."""
    context = await get_current_plant_context(method="ffill")
    if payload.sensor_reading:
        sensor_dict = {**context["reading"], **payload.sensor_reading.model_dump(exclude_none=True)}
    else:
        sensor_dict = context["reading"]

    history_dicts = [{"role": h.role, "content": h.content} for h in payload.history]

    reply = await chat_with_gemini(
        message=payload.message,
        sensor=sensor_dict,
        history=history_dicts,
        age_days=context["age_days"],
        growth_stage=context["growth_stage"],
    )
    return ChatResponse(
        reply=reply,
        timestamp=datetime.now().strftime("%H:%M:%S"),
    )
