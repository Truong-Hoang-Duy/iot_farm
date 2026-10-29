import json
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx

from app.core.config import GEMINI_API_KEY, GEMINI_MODEL, is_gemini_configured
from app.services.firebase_service import (
    FIREBASE_DB_URL,
    get_today_sensor_from_firebase,
)
from app.services.sensor_processing_service import (
    get_current_plant_context,
    resolve_stage_by_age,
    _processed_cache,
)

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "cache")
ALERTS_CACHE_FILE = os.path.join(CACHE_DIR, "latest_alerts.json")
MOCK_DATE_FILE = os.path.join(CACHE_DIR, "mock_test_sensor.json")

STAGE_TARGETS: Dict[int, Dict[str, Dict[str, Any]]] = {
    1: {
        "moisture": {"label": "Độ ẩm đất", "min": 65.0, "max": 70.0, "unit": "%"},
        "pH": {"label": "Độ pH đất", "min": 6.2, "max": 6.8, "unit": ""},
        "EC": {"label": "Độ dẫn điện EC", "min": 0.8, "max": 1.2, "unit": "mS/cm"},
        "N": {"label": "Đạm (N)", "min": 80.0, "max": 140.0, "unit": "ppm"},
        "P": {"label": "Lân (P)", "min": 300.0, "max": 450.0, "unit": "ppm"},
        "K": {"label": "Kali (K)", "min": 250.0, "max": 400.0, "unit": "ppm"},
        "soiltemp": {"label": "Nhiệt độ đất", "min": 24.0, "max": 28.0, "unit": "°C"},
        "temperature": {"label": "Nhiệt độ không khí", "min": 25.0, "max": 30.0, "unit": "°C"},
        "humidity": {"label": "Độ ẩm không khí", "min": 70.0, "max": 80.0, "unit": "%"},
    },
    2: {
        "moisture": {"label": "Độ ẩm đất", "min": 60.0, "max": 70.0, "unit": "%"},
        "pH": {"label": "Độ pH đất", "min": 6.0, "max": 6.8, "unit": ""},
        "EC": {"label": "Độ dẫn điện EC", "min": 1.2, "max": 1.6, "unit": "mS/cm"},
        "N": {"label": "Đạm (N)", "min": 150.0, "max": 250.0, "unit": "ppm"},
        "P": {"label": "Lân (P)", "min": 300.0, "max": 500.0, "unit": "ppm"},
        "K": {"label": "Kali (K)", "min": 350.0, "max": 550.0, "unit": "ppm"},
        "soiltemp": {"label": "Nhiệt độ đất", "min": 24.0, "max": 29.0, "unit": "°C"},
        "temperature": {"label": "Nhiệt độ không khí", "min": 25.0, "max": 32.0, "unit": "°C"},
        "humidity": {"label": "Độ ẩm không khí", "min": 65.0, "max": 80.0, "unit": "%"},
    },
    3: {
        "moisture": {"label": "Độ ẩm đất", "min": 60.0, "max": 75.0, "unit": "%"},
        "pH": {"label": "Độ pH đất", "min": 6.0, "max": 6.8, "unit": ""},
        "EC": {"label": "Độ dẫn điện EC", "min": 1.2, "max": 2.0, "unit": "mS/cm"},
        "N": {"label": "Đạm (N)", "min": 130.0, "max": 200.0, "unit": "ppm"},
        "P": {"label": "Lân (P)", "min": 350.0, "max": 550.0, "unit": "ppm"},
        "K": {"label": "Kali (K)", "min": 550.0, "max": 800.0, "unit": "ppm"},
        "soiltemp": {"label": "Nhiệt độ đất", "min": 24.0, "max": 29.0, "unit": "°C"},
        "temperature": {"label": "Nhiệt độ không khí", "min": 24.0, "max": 31.0, "unit": "°C"},
        "humidity": {"label": "Độ ẩm không khí", "min": 65.0, "max": 82.0, "unit": "%"},
    },
    4: {
        "moisture": {"label": "Độ ẩm đất", "min": 65.0, "max": 75.0, "unit": "%"},
        "pH": {"label": "Độ pH đất", "min": 6.0, "max": 6.8, "unit": ""},
        "EC": {"label": "Độ dẫn điện EC", "min": 1.5, "max": 2.2, "unit": "mS/cm"},
        "N": {"label": "Đạm (N)", "min": 150.0, "max": 230.0, "unit": "ppm"},
        "P": {"label": "Lân (P)", "min": 350.0, "max": 550.0, "unit": "ppm"},
        "K": {"label": "Kali (K)", "min": 650.0, "max": 950.0, "unit": "ppm"},
        "soiltemp": {"label": "Nhiệt độ đất", "min": 24.0, "max": 29.0, "unit": "°C"},
        "temperature": {"label": "Nhiệt độ không khí", "min": 24.0, "max": 31.0, "unit": "°C"},
        "humidity": {"label": "Độ ẩm không khí", "min": 65.0, "max": 80.0, "unit": "%"},
    },
    5: {
        "moisture": {"label": "Độ ẩm đất", "min": 58.0, "max": 68.0, "unit": "%"},
        "pH": {"label": "Độ pH đất", "min": 6.0, "max": 6.8, "unit": ""},
        "EC": {"label": "Độ dẫn điện EC", "min": 1.4, "max": 2.0, "unit": "mS/cm"},
        "N": {"label": "Đạm (N)", "min": 140.0, "max": 220.0, "unit": "ppm"},
        "P": {"label": "Lân (P)", "min": 300.0, "max": 500.0, "unit": "ppm"},
        "K": {"label": "Kali (K)", "min": 600.0, "max": 900.0, "unit": "ppm"},
        "soiltemp": {"label": "Nhiệt độ đất", "min": 24.0, "max": 30.0, "unit": "°C"},
        "temperature": {"label": "Nhiệt độ không khí", "min": 25.0, "max": 32.0, "unit": "°C"},
        "humidity": {"label": "Độ ẩm không khí", "min": 60.0, "max": 78.0, "unit": "%"},
    },
    6: {
        "moisture": {"label": "Độ ẩm đất", "min": 55.0, "max": 65.0, "unit": "%"},
        "pH": {"label": "Độ pH đất", "min": 6.2, "max": 6.8, "unit": ""},
        "EC": {"label": "Độ dẫn điện EC", "min": 0.8, "max": 1.4, "unit": "mS/cm"},
        "N": {"label": "Đạm (N)", "min": 80.0, "max": 150.0, "unit": "ppm"},
        "P": {"label": "Lân (P)", "min": 250.0, "max": 450.0, "unit": "ppm"},
        "K": {"label": "Kali (K)", "min": 300.0, "max": 500.0, "unit": "ppm"},
        "soiltemp": {"label": "Nhiệt độ đất", "min": 24.0, "max": 29.0, "unit": "°C"},
        "temperature": {"label": "Nhiệt độ không khí", "min": 24.0, "max": 31.0, "unit": "°C"},
        "humidity": {"label": "Độ ẩm không khí", "min": 60.0, "max": 75.0, "unit": "%"},
    },
}

ALERTS_SYSTEM_INSTRUCTION = """
Bạn là chuyên gia nông sinh học và hệ thống cảnh báo sớm IoT chuyên sâu về cây ớt.
Nhiệm vụ của bạn là phân tích mẫu đo cảm biến mới nhất của vườn ớt, đối chiếu với ngưỡng sinh học chuẩn của giai đoạn hiện tại và tạo danh sách cảnh báo chính xác, thực tế bằng tiếng Việt tự nhiên (không dùng thuật ngữ tiếng Anh hay tên khoa học Latinh trong ngoặc).

Yêu cầu bắt buộc:
- Chỉ tạo cảnh báo cho những thông số đang vượt ra ngoài ngưỡng chuẩn (thấp hơn min hoặc cao hơn max).
- Phân loại mức độ nghiêm trọng (level):
  + level = 2 (Khẩn cấp): Khi chỉ số lệch nghiêm trọng đe dọa trực tiếp đến bộ rễ, hoa, quả hoặc gây nguy cơ dịch bệnh bùng phát mạnh (ví dụ: ẩm đất < 45% hoặc > 80%, pH < 5.5, nhiệt độ đất > 31°C, EC quá thấp < 0.5 hoặc quá cao > 2.5).
  + level = 1 (Cảnh báo): Khi chỉ số lệch khỏi ngưỡng tối ưu nhưng ở mức trung bình cần điều chỉnh sớm.
- Phản hồi DUY NHẤT một chuỗi JSON hợp lệ (không kèm markdown ```json) có cấu trúc mảng các đối tượng cảnh báo như sau:
[
  {
    "id": "<Tên chỉ số kèm giá trị ngắn gọn, viết hoa chữ cái đầu, ví dụ: Độ ẩm đất (38.5%) hoặc Độ pH đất (5.12)>",
    "level": <1 hoặc 2>,
    "message": "<1-2 câu phân tích rõ giá trị thực đo so với chuẩn và cơ chế sinh lý ảnh hưởng trực tiếp lên cây ớt ở giai đoạn hiện tại>",
    "action": "<1-2 câu hướng dẫn hành động khắc phục cụ thể, định lượng rõ ràng>"
  }
]
"""


def _clean_json_text(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def get_active_mock_sensor() -> Optional[Dict[str, Any]]:
    """Đọc dữ liệu giả (test) của ngày hiện tại nếu đang được kích hoạt."""
    if os.path.exists(MOCK_DATE_FILE):
        try:
            with open(MOCK_DATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    return None


async def insert_mock_latest_sensor_data(
    custom_reading: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """
    Insert dữ liệu cảm biến giả của ngày hiện tại mới nhất lên Firebase (/data/{date}/{time})
    và lưu trạng thái test để tạo cảnh báo bằng Gemini AI.
    """
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H:%M:%S")

    reading = custom_reading or {
        "moisture": 38.4,
        "pH": 5.12,
        "EC": 0.42,
        "N": 62.5,
        "P": 215.0,
        "K": 240.0,
        "soiltemp": 32.6,
        "temperature": 34.8,
        "humidity": 52.0,
    }

    mock_payload = {
        "is_mock_test": True,
        "date": date_str,
        "time": time_str,
        "timestamp": f"{date_str} {time_str}",
        "reading": reading,
    }

    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(MOCK_DATE_FILE, "w", encoding="utf-8") as f:
        json.dump(mock_payload, f, ensure_ascii=False, indent=2)

    # Ghi lên Firebase node /data/{date_str}/{time_str}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.put(
                f"{FIREBASE_DB_URL}/data/{date_str}/{time_str}.json",
                json=reading,
            )
    except Exception as e:
        print(f"[AlertsService] Cảnh báo khi ghi mock data lên Firebase: {e}")

    return mock_payload


async def delete_mock_latest_sensor_data() -> Dict[str, Any]:
    """
    Xóa dữ liệu cảm biến giả của ngày mới nhất khỏi Firebase (/data/{mock_date})
    và khôi phục cảnh báo về dữ liệu thực tế (31/08/2026).
    """
    mock_data = get_active_mock_sensor()
    deleted_date = None

    if mock_data and mock_data.get("date"):
        deleted_date = mock_data["date"]
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.delete(f"{FIREBASE_DB_URL}/data/{deleted_date}.json")
        except Exception as e:
            print(f"[AlertsService] Lỗi xóa mock data trên Firebase: {e}")

    if os.path.exists(MOCK_DATE_FILE):
        try:
            os.remove(MOCK_DATE_FILE)
        except Exception:
            pass

    _processed_cache.clear()
    return {"deleted_date": deleted_date}


def detect_anomalies(
    reading: Dict[str, float],
    stage_number: int,
) -> List[Dict[str, Any]]:
    """Đối chiếu mẫu cảm biến mới nhất với ngưỡng chuẩn của giai đoạn hiện tại."""
    targets = STAGE_TARGETS.get(stage_number, STAGE_TARGETS[6])
    anomalies: List[Dict[str, Any]] = []

    for key, spec in targets.items():
        val = reading.get(key)
        if val is None:
            continue
        val_f = float(val)
        t_min = float(spec["min"])
        t_max = float(spec["max"])
        unit = spec["unit"]

        if val_f < t_min:
            diff = round(val_f - t_min, 2)
            anomalies.append(
                {
                    "key": key,
                    "label": spec["label"],
                    "value": val_f,
                    "min": t_min,
                    "max": t_max,
                    "unit": unit,
                    "status": "Thấp hơn ngưỡng chuẩn",
                    "delta": f"{diff}{unit}",
                }
            )
        elif val_f > t_max:
            diff = round(val_f - t_max, 2)
            anomalies.append(
                {
                    "key": key,
                    "label": spec["label"],
                    "value": val_f,
                    "min": t_min,
                    "max": t_max,
                    "unit": unit,
                    "status": "Vượt quá ngưỡng chuẩn",
                    "delta": f"+{diff}{unit}",
                }
            )

    return anomalies


def build_alerts_gemini_prompt(
    plant_type: str,
    age_days: int,
    stage_number: int,
    growth_stage: str,
    timestamp: str,
    reading: Dict[str, float],
    anomalies: List[Dict[str, Any]],
) -> str:
    """Tạo Prompt động chi tiết gửi vào Google Gemini để sinh cảnh báo."""
    anomaly_lines = "\n".join(
        [
            f"  - {a['label']} ({a['key']}): Thực đo = {a['value']}{a['unit']} | "
            f"Chuẩn Giai đoạn {stage_number} = {a['min']} - {a['max']}{a['unit']} "
            f"({a['status']}, lệch {a['delta']})"
            for a in anomalies
        ]
    )

    prompt = f"""
Hãy phân tích mẫu quan trắc mới nhất của hệ thống IoT Farm và tạo danh sách cảnh báo cho trình duyệt:
- Cây trồng: {plant_type}
- Thời gian canh tác: Ngày thứ {age_days} (Giai đoạn {stage_number}: {growth_stage})
- Thời điểm lấy mẫu mới nhất: {timestamp}
- Toàn bộ số đo tại thời điểm {timestamp}:
  + Độ ẩm đất (moisture): {reading.get('moisture')}%
  + Độ pH đất (pH): {reading.get('pH')}
  + Độ dẫn điện (EC): {reading.get('EC')} mS/cm
  + Nhiệt độ đất (soiltemp): {reading.get('soiltemp')}°C
  + Nhiệt độ không khí (temperature): {reading.get('temperature')}°C
  + Độ ẩm không khí (humidity): {reading.get('humidity')}%
  + Đạm (N): {reading.get('N')} ppm | Lân (P): {reading.get('P')} ppm | Kali (K): {reading.get('K')} ppm

- Các chỉ số đang vượt ngưỡng an toàn tại thời điểm {timestamp} ({len(anomalies)} chỉ số):
{anomaly_lines}

Hãy sinh danh sách cảnh báo JSON theo đúng cấu trúc yêu cầu cho các chỉ số vượt ngưỡng trên.
""".strip()
    return prompt


async def generate_alerts_from_latest_data(force_refresh: bool = False) -> Dict[str, Any]:
    """
    Chỉ lấy trực tiếp mẫu dữ liệu của đúng NGÀY HIỆN TẠI (YYYY-MM-DD) trên Firebase (/data/{today}),
    tạo prompt truyền vào Gemini AI, lưu kết quả cảnh báo lên Firebase /notifications và trả về.
    """
    context = await get_current_plant_context(method="ffill")
    today_str = datetime.now().strftime("%Y-%m-%d")

    # Truy vấn trực tiếp dữ liệu của ngày hôm nay trên Firebase (/data/{today_str})
    fb_today = await get_today_sensor_from_firebase(today_str)

    age_days = context["age_days"]
    stage_number, growth_stage = resolve_stage_by_age(age_days)
    plant_type = context["plant_type"]

    if not fb_today or not fb_today.get("reading"):
        # Nếu ngày hôm nay chưa có dữ liệu đo trên Firebase thì xóa cảnh báo cũ và không lùi về ngày trước
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.delete(f"{FIREBASE_DB_URL}/notifications.json")
        except Exception:
            pass

        empty_bundle = {
            "status": "no_data_today",
            "is_mock_test": False,
            "sensor_timestamp": f"{today_str} (Chưa có dữ liệu đo hôm nay)",
            "sensor_reading": {},
            "plant_context": {
                "plant_type": plant_type,
                "age_days": age_days,
                "stage_number": stage_number,
                "growth_stage": growth_stage,
            },
            "anomalies_detected": [],
            "prompt_used": (
                f"Hệ thống chưa ghi nhận mẫu đo cảm biến nào trong ngày hôm nay ({today_str}). "
                "Ngay khi trạm IoT gửi số liệu mới lên hệ thống, trợ lý AI sẽ tự động kiểm tra với mức chuẩn và cảnh báo kịp thời."
            ),
            "ai_model_used": GEMINI_MODEL,
            "generated_at": datetime.now().isoformat(),
            "alerts": [],
        }
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(ALERTS_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(empty_bundle, f, ensure_ascii=False, indent=2)
        return empty_bundle

    timestamp = fb_today["timestamp"]
    reading = {**context["reading"], **fb_today["reading"]}
    is_mock = False

    # Kiểm tra cache nếu không bắt buộc phân tích lại và cùng timestamp của ngày hôm nay
    if not force_refresh and os.path.exists(ALERTS_CACHE_FILE):
        try:
            with open(ALERTS_CACHE_FILE, "r", encoding="utf-8") as f:
                cached = json.load(f)
                if (
                    cached.get("sensor_timestamp") == timestamp
                    and cached.get("alerts")
                ):
                    return cached
        except Exception:
            pass

    anomalies = detect_anomalies(reading, stage_number)
    prompt = build_alerts_gemini_prompt(
        plant_type=plant_type,
        age_days=age_days,
        stage_number=stage_number,
        growth_stage=growth_stage,
        timestamp=timestamp,
        reading=reading,
        anomalies=anomalies,
    )

    alerts_list: List[Dict[str, Any]] = []
    ai_model_used = GEMINI_MODEL

    if anomalies and is_gemini_configured():
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=GEMINI_API_KEY)
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=ALERTS_SYSTEM_INSTRUCTION,
                    temperature=0.3,
                    response_mime_type="application/json",
                ),
            )
            clean_text = _clean_json_text(response.text)
            parsed = json.loads(clean_text)
            if isinstance(parsed, dict) and "alerts" in parsed:
                parsed = parsed["alerts"]

            if isinstance(parsed, list):
                for item in parsed:
                    alerts_list.append(
                        {
                            "id": str(item.get("id", "Cảnh báo cảm biến")),
                            "level": int(item.get("level", 1)),
                            "message": str(item.get("message", "")),
                            "action": str(item.get("action", "")),
                            "time": timestamp,
                            "active": True,
                        }
                    )
        except Exception as e:
            print(f"[AlertsService] Lỗi gọi Gemini sinh cảnh báo: {e}")
            ai_model_used = f"{GEMINI_MODEL} (Fallback)"

    # Lưu thẳng lên Firebase node /notifications để đồng bộ realtime với trình duyệt
    notifications_map: Dict[str, Dict[str, Any]] = {}
    for idx, alert in enumerate(alerts_list):
        safe_key = (
            alert["id"]
            .replace(".", "_")
            .replace("#", "_")
            .replace("$", "_")
            .replace("[", "(")
            .replace("]", ")")
            .replace("/", "-")
        )
        notifications_map[safe_key] = {
            "action": alert["action"],
            "active": True,
            "level": alert["level"],
            "message": alert["message"],
            "time": alert["time"],
        }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.put(
                f"{FIREBASE_DB_URL}/notifications.json",
                json=notifications_map,
            )
    except Exception as e:
        print(f"[AlertsService] Cảnh báo khi đồng bộ /notifications lên Firebase: {e}")

    result_bundle = {
        "status": "success",
        "is_mock_test": is_mock,
        "sensor_timestamp": timestamp,
        "sensor_reading": reading,
        "plant_context": {
            "plant_type": plant_type,
            "age_days": age_days,
            "stage_number": stage_number,
            "growth_stage": growth_stage,
        },
        "anomalies_detected": anomalies,
        "prompt_used": prompt,
        "ai_model_used": ai_model_used,
        "generated_at": datetime.now().isoformat(),
        "alerts": alerts_list,
    }

    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(ALERTS_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(result_bundle, f, ensure_ascii=False, indent=2)

    return result_bundle
