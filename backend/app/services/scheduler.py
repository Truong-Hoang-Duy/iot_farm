import asyncio
from datetime import datetime
from typing import Optional, Dict, Any
from fastapi.concurrency import run_in_threadpool
from app.services.weather_service import summarize_next_hours
from app.services.firebase_service import (
    get_plant_config_from_firebase,
    get_latest_sensor_from_firebase,
    save_recommendation_to_firebase,
    get_cached_recommendation_from_firebase
)
from app.services.gemini_service import get_gemini_agronomy_advice

# Lưu vết lần chạy phân tích tự động gần nhất (tránh chạy lặp lại trong cùng 1 giờ)
_last_auto_run_key: Optional[str] = None

async def run_auto_analysis(trigger_reason: str = "scheduled") -> Optional[Dict[str, Any]]:
    """Thực hiện quy trình đọc cảm biến từ Firebase và lưu khuyến nghị mới."""
    print(f"[Scheduler] Đang kích hoạt phân tích tự động (Lý do: {trigger_reason})...")
    sensor_data = await get_latest_sensor_from_firebase()
    if not sensor_data or "reading" not in sensor_data:
        print("[Scheduler] Chưa có dữ liệu cảm biến mới trên Firebase để phân tích.")
        return None

    reading = sensor_data["reading"]
    # Lấy cấu hình cây trồng do người dùng cài đặt (streaming/config/plant), có giá trị mặc định
    plant = await get_plant_config_from_firebase()
    try:
        weather = await run_in_threadpool(summarize_next_hours, 24)
    except Exception:
        weather = None
    advice = await get_gemini_agronomy_advice(
        plant_type=str(plant.get("type") or "Cây ớt (Chili Pepper)"),
        age_days=int(plant.get("age_days") or 45),
        growth_stage=str(plant.get("growth_stage") or "Ra hoa & tạo quả"),
        sensor=reading,
        custom_notes=f"Phân tích tự động định kỳ - {trigger_reason}",
        weather=weather,
    )

    advice_dict = advice.model_dump()
    advice_dict["sensor_snapshot"] = {
        "timestamp": sensor_data.get("timestamp"),
        "moisture": reading.get("moisture"),
        "soiltemp": reading.get("soiltemp"),
        "pH": reading.get("pH"),
        "EC": reading.get("EC"),
        "N": reading.get("N"),
        "P": reading.get("P"),
        "K": reading.get("K"),
    }
    advice_dict["trigger_reason"] = trigger_reason
    advice_dict["weather_snapshot"] = weather

    # Lưu vào Firebase
    saved = await save_recommendation_to_firebase(advice_dict)
    if saved:
        print(f"[Scheduler] Đã lưu kết quả khuyến nghị mới nhất vào Firebase thành công lúc {datetime.now().strftime('%H:%M:%S')}.")
    return advice_dict

async def auto_recommendation_worker():
    """Vòng lặp chạy ngầm kiểm tra và kích hoạt phân tích theo lịch nông học."""
    global _last_auto_run_key
    print("[Scheduler] Worker phân tích tự động IoT Farm đã khởi động.")
    
    # 1. Kiểm tra lúc khởi động: Nếu Firebase chưa có khuyến nghị nào thì phân tích ngay
    try:
        cached = await get_cached_recommendation_from_firebase()
        if not cached:
            print("[Scheduler] Chưa tìm thấy khuyến nghị nào trên Firebase. Tiến hành phân tích khởi tạo...")
            await run_auto_analysis(trigger_reason="khởi tạo lần đầu")
    except Exception as e:
        print(f"[Scheduler] Lỗi khởi tạo ban đầu: {e}")

    # 2. Vòng lặp kiểm tra định kỳ mỗi 10 phút
    while True:
        try:
            await asyncio.sleep(600) # 10 phút
            now = datetime.now()
            current_hour = now.hour
            current_date_str = now.strftime("%Y-%m-%d")

            # 2 mốc giờ vàng nông học: 06:00 sáng (trước ca tưới sáng) và 16:00 chiều (trước ca tưới chiều)
            is_morning_slot = (current_hour == 6)
            is_afternoon_slot = (current_hour == 16)

            run_key = f"{current_date_str}-{current_hour}"
            if (is_morning_slot or is_afternoon_slot) and _last_auto_run_key != run_key:
                slot_name = "Ca Sáng (06:00)" if is_morning_slot else "Ca Chiều (16:00)"
                print(f"[Scheduler] Đến mốc giờ canh tác {slot_name}. Bắt đầu phân tích...")
                await run_auto_analysis(trigger_reason=f"Định kỳ {slot_name}")
                _last_auto_run_key = run_key

        except asyncio.CancelledError:
            print("[Scheduler] Worker dừng hoạt động.")
            break
        except Exception as e:
            print(f"[Scheduler] Lỗi trong worker: {e}")
