import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from app.services.firebase_service import (
    save_recommendation_to_firebase,
    get_cached_recommendation_from_firebase,
)
from app.services.gemini_service import get_gemini_agronomy_advice
from app.services.sensor_processing_service import (
    get_current_plant_context,
    get_processed_sensor_bundle,
    sync_soil_all_from_firebase,
)

VN_TZ = timezone(timedelta(hours=7))
_last_auto_run_key: Optional[str] = None
_last_midnight_sync_date: Optional[str] = None


def _is_cache_outdated(cached: Optional[Dict[str, Any]], context: Dict[str, Any]) -> bool:
    """Kiểm tra bản lưu trong DB có bị lệch tuổi cây, giai đoạn hoặc mẫu đo cảm biến mới nhất không."""
    if not cached:
        return True
    if cached.get("age_days") != context["age_days"]:
        return True
    if cached.get("growth_stage") != context["growth_stage"]:
        return True
    snap = cached.get("sensor_snapshot") or {}
    latest_reading = context["reading"]
    for key in ("moisture", "pH", "EC", "N", "P", "K"):
        if snap.get(key) != latest_reading.get(key):
            return True
    return False


async def run_auto_analysis(trigger_reason: str = "scheduled") -> Optional[Dict[str, Any]]:
    """Thực hiện phân tích trực tiếp từ dữ liệu cây trồng & cảm biến đã làm sạch và lưu thẳng vào DB."""
    print(f"[Scheduler] Đang phân tích khuyến nghị (Lý do: {trigger_reason})...")
    try:
        context = await get_current_plant_context(method="ffill")
    except Exception as e:
        print(f"[Scheduler] Không thể lấy ngữ cảnh cây trồng: {e}")
        return None

    reading = context["reading"]
    advice = await get_gemini_agronomy_advice(
        plant_type=context["plant_type"],
        age_days=context["age_days"],
        growth_stage=context["growth_stage"],
        sensor=reading,
        custom_notes=f"Phân tích tự động - {trigger_reason}",
    )

    advice_dict = advice.model_dump()
    advice_dict["plant_type"] = context["plant_type"]
    advice_dict["age_days"] = context["age_days"]
    advice_dict["growth_stage"] = context["growth_stage"]
    advice_dict["sensor_snapshot"] = {
        "timestamp": context["timestamp"],
        **reading,
    }
    advice_dict["trigger_reason"] = trigger_reason

    saved = await save_recommendation_to_firebase(advice_dict)
    if saved:
        print(
            f"[Scheduler] Đã lưu khuyến nghị mới nhất (Ngày {context['age_days']} - {context['growth_stage']}) "
            f"vào DB lúc {datetime.now().strftime('%H:%M:%S')}."
        )
    return advice_dict


async def auto_recommendation_worker():
    """Vòng lặp chạy ngầm kiểm tra và đồng bộ khuyến nghị với dữ liệu cây trồng thực tế."""
    global _last_auto_run_key, _last_midnight_sync_date
    print("[Scheduler] Worker phân tích tự động IoT Farm đã khởi động.")

    try:
        context = await get_current_plant_context(method="ffill")
        cached = await get_cached_recommendation_from_firebase()
        if _is_cache_outdated(cached, context):
            print("[Scheduler] Dữ liệu khuyến nghị trong DB chưa khớp với trạng thái cây hiện tại. Đang cập nhật...")
            await run_auto_analysis(trigger_reason="đồng bộ dữ liệu thực tế")
    except Exception as e:
        print(f"[Scheduler] Lỗi kiểm tra khởi tạo ban đầu: {e}")

    while True:
        try:
            await asyncio.sleep(600)
            now = datetime.now(VN_TZ)
            current_hour = now.hour
            current_date_str = now.strftime("%Y-%m-%d")

            # Mốc 00:00 (0h đêm): Tự động kéo dữ liệu từ Firebase về cập nhật soil_all.json và bộ nhớ đệm
            if current_hour == 0 and _last_midnight_sync_date != current_date_str:
                print(f"[Scheduler] 00:00 ngày {current_date_str}: Bắt đầu đồng bộ /soil_all.json từ Firebase...")
                try:
                    sync_res = await sync_soil_all_from_firebase()
                    await get_processed_sensor_bundle(method="ffill", force_refresh=False)
                    _last_midnight_sync_date = current_date_str
                    print(
                        f"[Scheduler] Đã cập nhật /soil_all.json lúc 0h đêm "
                        f"({sync_res['total_days']} ngày, đến {sync_res['last_date']})."
                    )
                except Exception as sync_err:
                    print(f"[Scheduler] Lỗi đồng bộ /soil_all.json lúc 0h đêm: {sync_err}")

            is_morning_slot = current_hour == 6
            is_afternoon_slot = current_hour == 16

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
