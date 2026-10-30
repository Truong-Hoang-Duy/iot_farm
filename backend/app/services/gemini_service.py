import json
from datetime import datetime
from typing import Dict, Any, List

from app.core.config import GEMINI_API_KEY, GEMINI_MODEL, is_gemini_configured
from app.schemas.recommendation import AdvisorResponse, FertilizerItem
from app.services.prompt_template import SYSTEM_INSTRUCTION, build_agronomy_prompt


def clean_json_string(raw: str) -> str:
    """Loại bỏ markdown code blocks nếu Gemini vô tình đính kèm."""
    text = raw.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def generate_rule_based_fallback(
    plant_type: str,
    age_days: int,
    growth_stage: str,
    sensor: Dict[str, Any],
    forecast_data: Dict[str, Any] | None = None
) -> AdvisorResponse:
    """Bộ suy diễn nông học theo chuẩn sinh lý cây ớt, kết hợp dự báo XGBoost và giai đoạn thực tế."""
    moisture = float(sensor.get("moisture", 50.0) or 50.0)
    pH = float(sensor.get("pH", 6.2) or 6.2)
    ec = float(sensor.get("EC", 1.2) or 1.2)
    n = float(sensor.get("N", 200.0) or 200.0)
    p = float(sensor.get("P", 500.0) or 500.0)
    k = float(sensor.get("K", 800.0) or 800.0)

    score = 100
    warnings: List[str] = []
    tips: List[str] = []
    plan: List[FertilizerItem] = []

    # Kiểm tra dự báo sớm từ mô hình XGBoost Direct (đóng vòng điều khiển theo Slide 21)
    fc_warn = None
    if forecast_data:
        m_lo = forecast_data.get("moisture_lo")
        m_yhat = forecast_data.get("moisture_yhat")
        if (m_lo is not None and m_lo < 45.0) or (m_yhat is not None and m_yhat < 45.0):
            fc_warn = (
                f"Dự báo XGBoost Direct: Độ ẩm đất dự kiến giảm xuống {m_yhat:.1f}% "
                f"(cận an toàn 80% là {m_lo:.1f}%) trong 2 giờ tới. Hệ thống kích hoạt khuyến nghị tưới nhỏ giọt đón đầu "
                f"trước khi vùng rễ rơi vào trạng thái sốc hạn."
            )
            warnings.append(fc_warn)

    if moisture < 45:
        score -= 20
        watering = (
            f"Độ ẩm đất đang rất thấp ({moisture:.1f}%). Cần kích hoạt máy bơm tưới bù ẩm ngay "
            f"1.5 - 2.0 lít/gốc vào khung giờ mát (06:30 sáng hoặc 16:30 chiều) cho cây ở giai đoạn {growth_stage.lower()}."
        )
        warnings.append(
            f"Độ ẩm đất thấp ({moisture:.1f}%) kèm thời tiết nắng ấm làm tăng nguy cơ bọ trĩ "
            "và nhện trắng hại đọt non. Khuyến nghị phun dầu khoáng sinh học vào chiều mát."
        )
    elif moisture < 60:
        score -= 10
        if fc_warn:
            watering = (
                f"Độ ẩm đất hiện đạt {moisture:.1f}% và XGBoost dự báo sẽ giảm xuống {forecast_data.get('moisture_yhat')}%. "
                f"Cần kích hoạt chu kỳ tưới đón đầu 1.5 - 2.0 lít/gốc ngay để giữ độ ẩm ổn định trong ngưỡng 60% - 75%."
            )
        else:
            watering = (
                f"Độ ẩm đất hiện đạt {moisture:.1f}%, thấp hơn khoảng tối ưu (60% - 75%) của giai đoạn {growth_stage.lower()}. "
                "Nên tưới bổ sung 1.5 - 2.0 lít/gốc vào lúc 06:30 sáng và 16:30 chiều để duy trì trao đổi chất vùng rễ."
            )
        warnings.append(
            f"Độ ẩm đất dưới 60% ({moisture:.1f}%) dễ tạo điều kiện cho bọ trĩ và rệp muội phát triển ở mặt dưới lá. "
            "Phun phòng bằng dầu khoáng sinh học hoặc chế phẩm thảo mộc vào chiều mát."
        )
    elif moisture > 80:
        score -= 20
        watering = (
            f"Độ ẩm đất đang quá cao ({moisture:.1f}%). Tạm ngưng tưới và khơi thông rãnh thoát nước "
            "ngay để tránh ngạt oxy vùng rễ chùm (0 - 30cm)."
        )
        warnings.append(
            "Nguy cơ cao thối rễ và bệnh héo rũ do độ ẩm đất vượt ngưỡng an toàn."
        )
    else:
        watering = (
            f"Độ ẩm đất hiện đạt mức tối ưu ({moisture:.1f}%). Duy trì lịch tưới nhỏ giọt định kỳ "
            "vào 06:30 sáng và 16:30 chiều."
        )

    if pH < 5.8:
        score -= 15
        tips.append(
            f"Bổ sung 30 - 50g vôi nông nghiệp quanh tán (cách gốc 15cm) "
            f"để nâng độ pH từ {pH:.2f} lên ngưỡng 6.0 - 6.8, giúp giải phóng canxi và bo cho bộ rễ."
        )
        warnings.append(
            f"Nền đất chua (pH {pH:.2f}) làm tổn thương chóp rễ tơ và thuận lợi cho nấm gây héo rũ phát triển. "
            "Cần tưới nấm đối kháng sinh học định kỳ 15 ngày/lần."
        )
    elif pH > 7.2:
        score -= 15
        tips.append(
            f"Độ pH đất hơi kiềm ({pH:.2f}). Bổ sung phân hữu cơ hoai mục để đưa pH về 6.0 - 6.8."
        )

    if ec < 1.0:
        score -= 5
        tips.append(
            f"Độ dẫn điện EC hiện đạt {ec:.2f} mS/cm (mức khoáng hòa tan thấp). Nên chia nhỏ lượng phân hòa nước tưới thấm để tăng khả năng hấp thu."
        )

    if n < 150:
        score -= 10
        plan.append(FertilizerItem(
            name="Đạm cá hữu cơ",
            timing="06:00 - 08:00 sáng",
            amount="20 - 25g/gốc",
            method="Hòa nước tưới đều quanh tán",
            purpose=f"Bù hàm lượng đạm hữu dụng đang thấp ({n:.0f} ppm) phục vụ giai đoạn {growth_stage.lower()}"
        ))

    if p < 350:
        score -= 10
        plan.append(FertilizerItem(
            name="Super lân kích rễ",
            timing="07:00 - 09:00 sáng",
            amount="25 - 30g/gốc",
            method="Hòa tưới hoặc bón rãnh cách gốc 15cm",
            purpose=f"Bổ sung lân ({p:.0f} ppm) tái tạo rễ tơ và tăng cường hấp thu khoáng"
        ))

    if k < 600:
        score -= 10
        plan.append(FertilizerItem(
            name="Kali sunfat",
            timing="16:00 - 17:30 chiều",
            amount="20g/gốc",
            method="Hòa nước tưới gốc",
            purpose=f"Bổ sung kali ({k:.0f} ppm) giúp cứng cây, chắc cuống và nâng cao chất lượng thương phẩm"
        ))

    plan.append(FertilizerItem(
        name="Phân bón lá canxi - bo hữu cơ",
        timing="06:30 - 08:00 sáng mát trời",
        amount="2ml / lít nước",
        method="Phun sương đều lên tán lá và chồi ngọn",
        purpose="Tăng sức đề kháng mô tế bào, củng cố thành mạch dẫn và chống thối trái, rụng nụ"
    ))

    tips.append(
        "Tưới chế phẩm nấm đối kháng kết hợp phân hữu cơ định kỳ 15 ngày/lần để phục hồi hệ rễ chùm 0 - 30cm."
    )

    score = max(35, min(98, score))

    issues: List[str] = []
    if pH < 5.8:
        issues.append(f"đất chua (pH {pH:.2f})")
    elif pH > 7.2:
        issues.append(f"đất hơi kiềm (pH {pH:.2f})")
    if moisture < 60:
        issues.append(f"thiếu ẩm ({moisture:.1f}%)")
    elif moisture > 80:
        issues.append(f"dư ẩm ({moisture:.1f}%)")
    if n < 150 or k < 600:
        issues.append(f"thiếu hụt đạm ({n:.0f} ppm) và kali ({k:.0f} ppm)")

    if issues:
        summary = (
            f"Cây ớt ở ngày thứ {age_days} (giai đoạn {growth_stage.lower()}) đang ghi nhận tình trạng {', '.join(issues)}. "
            "Cần ưu tiên xử lý pH đất bằng vôi nông nghiệp, tưới bù ẩm đúng khung giờ mát và bổ sung dinh dưỡng theo phác đồ bên dưới."
        )
    else:
        summary = (
            f"Cây ớt ở ngày thứ {age_days} (giai đoạn {growth_stage.lower()}) có các chỉ số lý hóa đất cân bằng tốt. "
            "Tiếp tục duy trì lịch tưới tiêu và dinh dưỡng định kỳ để bảo vệ bộ rễ và năng suất."
        )

    return AdvisorResponse(
        status="success",
        plant_type=plant_type,
        age_days=age_days,
        growth_stage=growth_stage,
        soil_health_score=score,
        summary=summary,
        fertilizer_plan=plan,
        watering_advice=watering,
        pest_disease_warnings=warnings,
        soil_improvement_tips=tips,
        ai_model_used="Chuyên gia nông học AI",
        timestamp=datetime.now().strftime("%H:%M %d/%m/%Y")
    )


def get_weather_context_for_chili() -> Dict[str, Any] | None:
    """Lấy dự báo khí tượng ngoại sinh 24h tới để bổ sung khuyến nghị tưới & bón phân chủ động cho cây ớt."""
    try:
        from app.services.weather_service import current_weather
        w = current_weather()
        n24 = w.get("next24h") or {}
        rain24 = float(n24.get("precip_total_mm") or 0.0)
        et024 = float(n24.get("et0_total_mm") or 0.0)
        wb24 = round(rain24 - et024, 2)
        tmax = n24.get("temp_max")
        rh_mean = n24.get("rh_mean")

        notes: List[str] = []
        if rain24 >= 10.0:
            notes.append(
                f"Dự báo mưa lớn ({rain24:.1f} mm/24h): Tạm hoãn tưới và không bón phân gốc để tránh rửa trôi Đạm, Kali và tránh ngập úng bộ rễ chùm 0-30cm của cây ớt."
            )
        elif wb24 < -3.0:
            notes.append(
                f"Cân bằng nước âm mạnh ({wb24:.1f} mm/24h, bốc thoát hơi cao): Cần tưới bù ẩm đón đầu để giữ ẩm độ đất 60-75%, tránh khô héo cuống hoa ở nách chảng ba."
            )
        if tmax is not None and float(tmax) >= 34.0:
            notes.append(
                f"Nắng nóng đỉnh điểm {float(tmax):.1f}°C (sóng nhiệt sẽ truyền xuống tầng rễ ớt sau 5-6 giờ): Tưới mát vào sáng sớm trước 08:00."
            )
        if rh_mean is not None and float(rh_mean) >= 85.0:
            notes.append(
                f"Độ ẩm không khí trung bình cao ({float(rh_mean):.0f}%): Nguy cơ bùng phát nấm thán thư quả ớt và héo rũ."
            )
        return {
            "rain_24h_mm": round(rain24, 1),
            "et0_24h_mm": round(et024, 2),
            "water_balance_24h_mm": wb24,
            "temp_max_24h": tmax,
            "rh_mean_24h": rh_mean,
            "agro_note": " ".join(notes) if notes else "Thời tiết 24h tới thuận lợi cho sinh trưởng của cây ớt.",
        }
    except Exception:
        return None


def get_xgboost_forecast_summary() -> Dict[str, Any] | None:
    """Trích xuất kết quả dự báo 2 giờ tới từ mô hình XGBoost Direct tốt nhất (Safe Fallback nếu lỗi)."""
    try:
        from app.ml.forecast_service import get_service
        svc = get_service()
        fc_m = svc.forecast(target="moisture", horizon="2h", model="xgboost")
        fc_t = svc.forecast(target="soiltemp", horizon="2h", model="xgboost")
        if not fc_m or not fc_m.get("forecast"):
            return None
        last_m = fc_m["forecast"][-1]
        last_t = fc_t["forecast"][-1] if fc_t and fc_t.get("forecast") else {}
        yhat_m = last_m.get("yhat")
        lo_m = last_m.get("lo", yhat_m)
        hi_m = last_m.get("hi", yhat_m)
        yhat_t = last_t.get("yhat")

        hist = fc_m.get("history", [])
        curr_m = hist[-1]["v"] if hist and hist[-1].get("v") is not None else yhat_m
        diff = (yhat_m - curr_m) if (yhat_m is not None and curr_m is not None) else 0.0
        if diff < -1.5:
            trend = "giảm nhanh"
        elif diff < -0.5:
            trend = "giảm nhẹ"
        elif diff > 1.5:
            trend = "tăng nhanh"
        elif diff > 0.5:
            trend = "tăng nhẹ"
        else:
            trend = "ổn định"

        risk_note = "Bình thường"
        if lo_m is not None and lo_m < 45.0:
            risk_note = "Nguy cơ đất khô hạn trong 2 giờ tới (cận dưới q10 < 45%). Cần tưới đón đầu."
        elif yhat_m is not None and yhat_m > 80.0:
            risk_note = "Nguy cơ độ ẩm quá bão hòa > 80%. Tạm hoãn tưới."

        return {
            "moisture_yhat": round(yhat_m, 1) if yhat_m is not None else None,
            "moisture_lo": round(lo_m, 1) if lo_m is not None else None,
            "moisture_hi": round(hi_m, 1) if hi_m is not None else None,
            "moisture_trend": trend,
            "soiltemp_yhat": round(yhat_t, 1) if yhat_t is not None else None,
            "risk_note": risk_note,
        }
    except Exception as e:
        # Cơ chế kháng lỗi (Safe Fallback): nếu ML chưa sẵn sàng, hệ thống vẫn hoạt động bình thường
        return None


async def get_gemini_agronomy_advice(
    plant_type: str,
    age_days: int,
    growth_stage: str,
    sensor: Dict[str, Any],
    custom_notes: str | None = None
) -> AdvisorResponse:
    """Gọi Google Gemini để sinh đề xuất phân bón & chăm sóc cây ớt kết hợp dự báo XGBoost Direct và thời tiết ngoại sinh."""
    forecast_data = get_xgboost_forecast_summary()
    weather_context = get_weather_context_for_chili()

    if not is_gemini_configured():
        return generate_rule_based_fallback(plant_type, age_days, growth_stage, sensor, forecast_data)

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=GEMINI_API_KEY)
        user_prompt = build_agronomy_prompt(
            plant_type, age_days, growth_stage, sensor, custom_notes, forecast_data, weather_context
        )

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                temperature=0.3,
                response_mime_type="application/json"
            )
        )

        clean_text = clean_json_string(response.text)
        data = json.loads(clean_text)

        fertilizer_list = [FertilizerItem(**item) for item in data.get("fertilizer_plan", [])]

        return AdvisorResponse(
            status="success",
            plant_type=plant_type,
            age_days=age_days,
            growth_stage=growth_stage,
            soil_health_score=int(data.get("soil_health_score", 80)),
            summary=str(data.get("summary", "")),
            fertilizer_plan=fertilizer_list,
            watering_advice=str(data.get("watering_advice", "")),
            pest_disease_warnings=list(data.get("pest_disease_warnings", [])),
            soil_improvement_tips=list(data.get("soil_improvement_tips", [])),
            ai_model_used=GEMINI_MODEL,
            timestamp=datetime.now().strftime("%H:%M %d/%m/%Y")
        )

    except Exception as e:
        print(f"[IoTFarmService] Lỗi gọi API phân tích: {e}. Chuyển sang bộ suy diễn nông học.")
        return generate_rule_based_fallback(plant_type, age_days, growth_stage, sensor, forecast_data)


async def chat_with_gemini(
    message: str,
    sensor: Dict[str, Any] | None = None,
    history: List[Dict[str, str]] = [],
    age_days: int | None = None,
    growth_stage: str | None = None,
) -> str:
    """Tương tác hỏi đáp cùng trợ lý ảo canh tác."""
    stage_label = f"ngày thứ {age_days} ({growth_stage})" if age_days and growth_stage else "hiện tại"

    if not is_gemini_configured():
        msg_lower = message.lower()
        moisture = sensor.get("moisture", 51.7) if sensor else 51.7
        ph_val = sensor.get("pH", 5.37) if sensor else 5.37
        n_val = sensor.get("N", 109) if sensor else 109
        k_val = sensor.get("K", 472) if sensor else 472

        if any(kw in msg_lower for kw in ['ph', 'chua', 'vôi', 'kiềm']):
            return (
                f"**Xử lý độ pH đất ({stage_label}):**\n"
                f"Độ pH đất hiện đo được {ph_val} (đang bị chua so với chuẩn 6.0 - 6.8). Đất chua làm rễ ớt bị nghẽn hấp thu Canxi và Bo.\n\n"
                "**Giải pháp:** Rải vôi nông nghiệp (CaCO3) hoặc Dolomite liều lượng 30 - 50g/gốc, cách gốc 15cm rồi tưới ẩm nhẹ. Không trộn chung vôi với phân đạm."
            )
        elif any(kw in msg_lower for kw in ['tưới', 'nước', 'ẩm', 'khô']):
            return (
                f"**Hướng dẫn tưới nước ({stage_label}):**\n"
                f"Độ ẩm đất quan trắc đang ở mức {moisture}%, thấp hơn ngưỡng tối ưu (60% - 75%).\n\n"
                "**Khuyến nghị:** Tưới bổ sung 1.5 - 2.0 lít/gốc vào sáng sớm (06:30) hoặc chiều mát (16:30)."
            )
        elif any(kw in msg_lower for kw in ['bệnh', 'thán thư', 'bọ trĩ', 'sâu', 'nấm', 'xoăn']):
            return (
                f"**Phòng trừ sâu bệnh cây ớt ({stage_label}):**\n"
                "1. **Bọ trĩ & nhện trắng:** Phát triển mạnh khi ẩm độ đất thấp và trời nắng. Phun dầu khoáng sinh học SK Enspray 99EC vào chiều mát.\n"
                f"2. **Nấm rễ Fusarium:** Đất chua (pH {ph_val}) dễ làm nấm xâm nhập cổ rễ. Tưới vi sinh *Trichoderma* định kỳ 15 ngày/lần."
            )
        elif any(kw in msg_lower for kw in ['phân', 'npk', 'đạm', 'kali', 'lân', 'bón']):
            return (
                f"**Chế độ bón phân khuyến nghị ({stage_label}):**\n"
                f"Chỉ số hiện tại ghi nhận Đạm ({n_val} ppm) và Kali ({k_val} ppm) thấp hơn ngưỡng tối ưu.\n\n"
                "**Đề xuất:** Bổ sung Đạm hữu cơ/đạm cá (20-25g/gốc) vào sáng sớm, kết hợp Kali Sunfat K2SO4 (20g/gốc) vào chiều mát và phun Canxi-Bo qua lá."
            )
        else:
            return (
                f"Xin chào! Tôi là Trợ lý Nông học AI. Vườn ớt đang ở {stage_label} "
                f"(Ẩm đất {moisture}%, pH {ph_val}). Bạn có thể hỏi chi tiết về cách hạ phèn nâng pH, lịch tưới nước, phối trộn NPK hoặc phòng trừ bọ trĩ, nấm rễ."
            )

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=GEMINI_API_KEY)
        context_str = f"\n[Trạng thái cây: {stage_label}]"
        if sensor:
            context_str += (
                f"\n[Thông số quan trắc: Ẩm độ đất: {sensor.get('moisture')}% | "
                f"pH: {sensor.get('pH')} | EC: {sensor.get('EC')} mS/cm | "
                f"N: {sensor.get('N')} | P: {sensor.get('P')} | K: {sensor.get('K')} ppm]"
            )

        full_prompt = (
            f"Bạn là Trợ lý Nông học thông minh tư vấn canh tác cây Ớt.\n"
            f"{context_str}\n"
            f"Người dùng hỏi: {message}\n"
            f"Hãy trả lời ngắn gọn, thiết thực, khoa học và dễ hiểu bằng tiếng Việt."
        )

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=full_prompt,
            config=types.GenerateContentConfig(
                temperature=0.5
            )
        )
        return response.text.strip()
    except Exception as e:
        return f"Xin lỗi, trợ lý AI tạm thời bận: {e}"
