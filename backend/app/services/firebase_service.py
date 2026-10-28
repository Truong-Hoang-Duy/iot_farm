import os
from typing import Dict, Any, Optional
from datetime import datetime
import httpx

FIREBASE_DB_URL = os.getenv(
    "FIREBASE_DB_URL",
    "https://iot-farm-chilli-default-rtdb.asia-southeast1.firebasedatabase.app"
)

async def get_latest_sensor_from_firebase() -> Optional[Dict[str, Any]]:
    """Đọc mẫu quan trắc cảm biến 7 in 1 mới nhất từ Firebase Realtime Database (node /data)."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(f"{FIREBASE_DB_URL}/data.json")
            if res.status_code != 200 or not res.json():
                return None
            
            data = res.json()
            # Cấu trúc: { "YYYY-MM-DD": { "HH:MM:SS": { EC, K, N, P, ... } } }
            sorted_dates = sorted(data.keys(), reverse=True)
            if not sorted_dates:
                return None
            
            latest_date = sorted_dates[0]
            times = data[latest_date]
            sorted_times = sorted(times.keys(), reverse=True)
            if not sorted_times:
                return None
            
            latest_time = sorted_times[0]
            reading = times[latest_time]
            return {
                "date": latest_date,
                "time": latest_time,
                "timestamp": f"{latest_time} {latest_date}",
                "reading": reading
            }
    except Exception as e:
        print(f"[FirebaseService] Lỗi đọc dữ liệu cảm biến: {e}")
        return None

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "cache")
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
        import json
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(recommendation_dict, f, ensure_ascii=False, indent=2)

        # Cố gắng đẩy lên Firebase (nếu có quyền ghi)
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.put(
                    f"{FIREBASE_DB_URL}/recommendations/latest.json",
                    json=recommendation_dict
                )
                if res.status_code == 200:
                    return True
        except Exception:
            pass

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
            import json
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                _memory_cache = data
                return data
        except Exception:
            pass

    # Đọc từ Firebase
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(f"{FIREBASE_DB_URL}/recommendations/latest.json")
            if res.status_code == 200 and res.json():
                _memory_cache = res.json()
                return res.json()
    except Exception:
        pass

    return None
