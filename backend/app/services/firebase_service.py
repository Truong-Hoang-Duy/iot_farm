import json
import os
from datetime import datetime
from typing import Any, Dict, Optional

from app.core.config import CACHE_DIR as _CACHE_DIR
from app.services.firebase_client import get_firebase


async def get_latest_sensor_from_firebase() -> Optional[Dict[str, Any]]:
    """Đọc mẫu quan trắc cảm biến mới nhất từ Firebase Realtime Database (node /data).
    Chỉ truy vấn ngày mới nhất (orderBy $key + limitToLast) thay vì tải toàn bộ node."""
    try:
        fb = get_firebase()
        latest_day = await fb.query_by_key("data", limit_to_last=1)
        if not isinstance(latest_day, dict) or not latest_day:
            return None
        latest_date = sorted(latest_day.keys())[-1]
        times = latest_day[latest_date] or {}
        # Cấu trúc: { "YYYY-MM-DD": { "HH:MM[:SS]": { EC, K, N, P, ... } } }
        sorted_times = sorted(times.keys(), key=lambda t: t if t.count(":") == 2 else t + ":00", reverse=True)
        if not sorted_times:
            return None
        latest_time = sorted_times[0]
        reading = times[latest_time]
        return {
            "date": latest_date,
            "time": latest_time,
            "timestamp": f"{latest_time} {latest_date}",
            "reading": reading,
        }
    except Exception as e:
        print(f"[FirebaseService] Lỗi đọc dữ liệu cảm biến: {e}")
        return None


async def get_plant_config_from_firebase() -> Dict[str, Any]:
    """Đọc cấu hình cây trồng (streaming/config/plant) do người dùng cài đặt trên Dashboard."""
    try:
        cfg = await get_firebase().get("streaming/config/plant")
        return cfg if isinstance(cfg, dict) else {}
    except Exception:
        return {}


CACHE_DIR = str(_CACHE_DIR)
CACHE_FILE = os.path.join(CACHE_DIR, "latest_recommendation.json")

# Biến bộ nhớ đệm
_memory_cache: Optional[Dict[str, Any]] = None


async def save_recommendation_to_firebase(recommendation_dict: Dict[str, Any]) -> bool:
    """Lưu trữ kết quả khuyến nghị mới nhất vào bộ nhớ cache và Firebase."""
    global _memory_cache
    try:
        recommendation_dict["saved_at"] = datetime.now().isoformat()
        _memory_cache = recommendation_dict

        # Lưu file local
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(recommendation_dict, f, ensure_ascii=False, indent=2)

        # Cố gắng đẩy lên Firebase (nếu có quyền ghi)
        try:
            await get_firebase().put("recommendations/latest", recommendation_dict)
        except Exception as e:
            print(f"[FirebaseService] Không đẩy được khuyến nghị lên Firebase: {e}")

        return True
    except Exception as e:
        print(f"[FirebaseService] Lỗi lưu khuyến nghị vào cache: {e}")
        return False


async def get_cached_recommendation_from_firebase() -> Optional[Dict[str, Any]]:
    """Lấy bản ghi khuyến nghị mới nhất đang được lưu trong cache hoặc Firebase."""
    global _memory_cache
    if _memory_cache:
        return _memory_cache

    # Đọc từ file local nếu có
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                _memory_cache = data
                return data
        except Exception:
            pass

    # Đọc từ Firebase
    try:
        data = await get_firebase().get("recommendations/latest")
        if data:
            _memory_cache = data
            return data
    except Exception:
        pass

    return None
