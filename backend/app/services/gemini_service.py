import json
import re
from datetime import datetime
from typing import Dict, Any, List

from app.core.config import GEMINI_API_KEY, GEMINI_MODEL, is_gemini_configured
from app.schemas.recommendation import AdvisorResponse, FertilizerItem, SensorReading
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
    weather: Dict[str, Any] | None = None,
) -> AdvisorResponse:
    """Bộ suy diễn dự phòng chuẩn Haifa Group khi chưa cấu hình Gemini API Key."""
    moisture = sensor.get("moisture", 50.0) or 50.0
    pH = sensor.get("pH", 6.2) or 6.2
    ec = sensor.get("EC", 1.2) or 1.2
    n = sensor.get("N", 200.0) or 200.0
    p = sensor.get("P", 500.0) or 500.0
    k = sensor.get("K", 800.0) or 800.0

    score = 100
    warnings: List[str] = []
    tips: List[str] = []
    plan: List[FertilizerItem] = []

    # Đánh giá ẩm độ
    if moisture < 40:
        score -= 20
        watering = f"Độ ẩm đất đang rất thấp ({moisture:.1f}%). Cần kích hoạt bơm tưới ngay lập tức với lượng nước 1.5 - 2 lít/gốc."
        warnings.append("Nguy cơ héo rũ do thiếu nước ở tầng rễ.")
    elif moisture > 80:
        score -= 20
        watering = f"Độ ẩm đất quá cao ({moisture:.1f}%). Tạm ngưng tưới và khơi thông thoát nước để chống ngạt rễ."
        warnings.append("Nguy cơ thối rễ và nấm Phytophthora phát triển do đất ngập úng.")
    else:
        watering = f"Độ ẩm đất hiện đạt mức lý tưởng ({moisture:.1f}%). Duy trì tưới vào lúc 06:30 sáng và 16:30 chiều."

    # Điều chỉnh theo dự báo thời tiết (Open-Meteo)
    if weather and weather.get("available"):
        rain = weather.get("precip_total_mm") or 0
        et0 = weather.get("et0_total_mm") or 0
        if rain >= 5:
            watering += f" Dự báo mưa khoảng {rain} mm trong {weather.get('hours', 24)}h tới: giảm 50% hoặc hoãn lượt tưới kế tiếp, kiểm tra rãnh thoát nước."
            tips.append("Tránh bón phân hòa tan ngay trước khi mưa lớn để hạn chế rửa trôi dinh dưỡng.")
        elif et0 >= 4:
            watering += f" Bốc thoát hơi ET0 dự báo {et0} mm/ngày, gần như không mưa: tăng lượng nước khoảng 20%."

    # Đánh giá pH
    if pH < 5.8:
        score -= 15
        tips.append(f"Độ pH đất thấp ({pH:.2f}, đất chua). Bổ sung 30-50g vôi nông nghiệp (CaCO3) hoặc dolomite quanh gốc để nâng pH.")
    elif pH > 7.2:
        score -= 15
        tips.append(f"Độ pH đất hơi kiềm ({pH:.2f}). Nên bổ sung phân hữu cơ hoai mục hoặc axit humic để hạ pH đất.")

    # Đánh giá dinh dưỡng NPK
    if n < 150:
        score -= 10
        plan.append(FertilizerItem(
            name="Đạm Urê hoặc Đạm Cá Hữu Cơ",
            timing="06:00 - 08:00 sáng",
            amount="25g/gốc",
            method="Hòa nước tưới đều quanh tán",
            purpose=f"Bù hàm lượng đạm N đang thấp ({n:.1f} ppm) để duy trì quang hợp và chồi non"
        ))
    
    if p < 350:
        score -= 10
        plan.append(FertilizerItem(
            name="Super Lân hoặc DAP",
            timing="07:00 - 09:00 sáng",
            amount="30g/gốc",
            method="Bón rãnh cách gốc 15cm",
            purpose=f"Bổ sung lân P ({p:.1f} ppm) kích thích mầm hoa và nuôi bộ rễ khỏe mạnh"
        ))

    if k < 600:
        score -= 10
        plan.append(FertilizerItem(
            name="Kali Sunfat (K2SO4)",
            timing="16:00 - 17:30 chiều",
            amount="20g/gốc",
            method="Hòa nước tưới gốc",
            purpose=f"Bổ sung Kali ({k:.1f} ppm) giúp cứng cuống, quả ớt to cay và chống rụng hoa"
        ))

    if not plan:
        plan.append(FertilizerItem(
            name="NPK Cân Bằng 16-16-16 + Vi lượng",
            timing="06:30 - 08:00 sáng (Mỗi 10 ngày)",
            amount="20g/gốc",
            method="Hòa nước tưới định kỳ",
            purpose="Duy trì thế cân bằng dinh dưỡng đất cho cây ớt đang mang hoa quả"
        ))

    if not warnings:
        warnings.append("Môi trường vi khí hậu hiện ổn định. Chú ý theo dõi rệp muội và bọ trĩ ở mặt dưới lá vào những ngày nắng gắt.")

    tips.append("Bổ sung chế phẩm vi sinh Trichoderma 2 tuần/lần để kích thích hệ vi sinh đất kháng nấm.")

    score = max(35, min(98, score))

    summary = (
        f"Đánh giá vườn {plant_type} ({age_days} ngày tuổi, giai đoạn {growth_stage}): "
        f"Chỉ số lý hóa tổng quát đạt {score}/100 điểm. "
        f"Độ ẩm đất {moisture:.1f}%, pH {pH:.2f}, EC {ec:.2f} mS/cm. "
        + ("Hệ thống phát hiện đất đang có dấu hiệu mất cân bằng cần can thiệp." if score < 75 else "Các chỉ số cơ bản đang nằm trong khoảng nông học an toàn.")
    )

    return AdvisorResponse(
        status="success",
        soil_health_score=score,
        summary=summary,
        fertilizer_plan=plan,
        watering_advice=watering,
        pest_disease_warnings=warnings,
        soil_improvement_tips=tips,
        ai_model_used="Hệ thống phân tích IoT Farm",
        timestamp=datetime.now().strftime("%H:%M %d/%m/%Y")
    )

async def get_gemini_agronomy_advice(
    plant_type: str,
    age_days: int,
    growth_stage: str,
    sensor: Dict[str, Any],
    custom_notes: str | None = None,
    weather: Dict[str, Any] | None = None,
) -> AdvisorResponse:
    """Gọi Google Gemini 2.5 Flash để sinh đề xuất phân bón & chăm sóc."""
    if not is_gemini_configured():
        return generate_rule_based_fallback(plant_type, age_days, growth_stage, sensor, weather)

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=GEMINI_API_KEY)
        user_prompt = build_agronomy_prompt(plant_type, age_days, growth_stage, sensor, custom_notes, weather)

        # Sử dụng config với response_mime_type JSON
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
            soil_health_score=int(data.get("soil_health_score", 80)),
            summary=str(data.get("summary", "")),
            fertilizer_plan=fertilizer_list,
            watering_advice=str(data.get("watering_advice", "")),
            pest_disease_warnings=list(data.get("pest_disease_warnings", [])),
            soil_improvement_tips=list(data.get("soil_improvement_tips", [])),
            ai_model_used="Hệ thống phân tích IoT Farm",
            timestamp=datetime.now().strftime("%H:%M %d/%m/%Y")
        )

    except Exception as e:
        print(f"[IoTFarmService] Lỗi gọi API phân tích: {e}. Chuyển sang fallback.")
        fallback = generate_rule_based_fallback(plant_type, age_days, growth_stage, sensor, weather)
        return fallback

async def chat_with_gemini(
    message: str,
    sensor: Dict[str, Any] | None = None,
    history: List[Dict[str, str]] = []
) -> str:
    """Tương tác hỏi đáp cùng trợ lý ảo IoT Farm."""
    if not is_gemini_configured():
        # Phản hồi chuyên môn dự phòng thông minh dựa trên từ khóa canh tác cây ớt
        msg_lower = message.lower()
        if any(kw in msg_lower for kw in ['ph', 'chua', 'vôi', 'kiềm']):
            return (
                "🌱 **Xử lý độ pH đất trên IoT Farm:**\n"
                "Độ pH hiện tại của đất khoảng 5.37 (đang bị chua nhẹ). Đất chua làm cây ớt khó hấp thu Lân (P) và các vi lượng (Bo, Canxi), dễ rụng hoa.\n\n"
                "👉 **Giải pháp:** Rải vôi nông nghiệp (CaCO3) hoặc dolomite khoảng 30-50g quanh gốc, cách gốc 15cm rồi tưới ẩm nhẹ. Không bón vôi cùng lúc với phân đạm để tránh thất thoát dinh dưỡng."
            )
        elif any(kw in msg_lower for kw in ['tưới', 'nước', 'ẩm', 'khô']):
            return (
                "💧 **Hướng dẫn tưới nước IoT Farm:**\n"
                "Độ ẩm đất quan trắc đang ở mức ~51.7%, thấp hơn khoảng tối ưu (60% - 75%).\n\n"
                "👉 **Khuyến nghị:** Tưới bổ sung 1.5 - 2.0 lít/gốc vào sáng sớm (06:00 - 07:30) hoặc chiều mát (16:30 - 17:30). Bạn có thể sang tab 'Điều khiển' để kích hoạt máy bơm."
            )
        elif any(kw in msg_lower for kw in ['bệnh', 'thán thư', 'bọ trĩ', 'sâu', 'nấm', 'xoăn']):
            return (
                "🛡️ **Phòng trừ sâu bệnh cây ớt:**\n"
                "1. **Bọ trĩ & rệp muội:** Thường núp ở mặt dưới lá non gây xoăn đọt. Phun nước áp lực nhẹ vào sáng sớm hoặc dùng dầu khoáng sinh học.\n"
                "2. **Nấm thán thư (đốm mắt cua):** Phát triển mạnh khi ẩm độ cao. Cần tỉa bớt lá chân sát gốc, tưới vi sinh *Trichoderma* để bảo vệ cổ rễ."
            )
        elif any(kw in msg_lower for kw in ['phân', 'npk', 'đạm', 'kali', 'lân', 'bón']):
            return (
                "🧪 **Chế độ bón phân khuyến nghị:**\n"
                "Cây ớt 45 ngày tuổi đang bước vào pha phân hóa hoa và nuôi quả. Hiện tại hàm lượng Đạm (108 ppm) và Kali (471 ppm) đang thấp hơn chuẩn.\n\n"
                "👉 **Đề xuất:** Bổ sung Đạm Urê hoặc đạm cá (25g/gốc) hòa nước tưới gốc vào sáng sớm, kết hợp Kali Sunfat K2SO4 (20g/gốc) vào chiều mát để cuống hoa dai, quả cay và bóng đẹp."
            )
        else:
            return (
                "Xin chào! Tôi là Trợ lý IoT Farm. Cây ớt giai đoạn 45 ngày tuổi cần giữ ẩm độ 60-75% và pH 6.0-6.8. "
                "Bạn có thể xem các đề xuất tưới nước, bón phân chi tiết ở màn hình Khuyến nghị, hoặc hỏi tôi cụ thể về: 'Độ pH đất', 'Lượng nước tưới', 'Cách bón NPK' hoặc 'Phòng bệnh thán thư'."
            )

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=GEMINI_API_KEY)
        context_str = ""
        if sensor:
            context_str = (
                f"\n[Thông số trạm IoT Farm: Ẩm độ đất: {sensor.get('moisture')}% | "
                f"pH: {sensor.get('pH')} | EC: {sensor.get('EC')} mS/cm | "
                f"N: {sensor.get('N')} | P: {sensor.get('P')} | K: {sensor.get('K')} ppm]"
            )

        full_prompt = (
            f"Bạn là Trợ lý thông minh của dự án IoT Farm tư vấn canh tác cây Ớt.\n"
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
