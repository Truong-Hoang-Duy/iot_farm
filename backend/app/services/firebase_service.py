import os
import json
from typing import Dict, Any, Optional
from datetime import datetime
import httpx

FIREBASE_DB_URL = os.getenv(
    "FIREBASE_DB_URL",
    "https://iot-farm-chilli-default-rtdb.asia-southeast1.firebasedatabase.app"
)


async def get_today_sensor_from_firebase(target_date: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Chỉ đọc mẫu quan trắc của đúng ngày hiện tại (YYYY-MM-DD) từ Firebase Realtime Database (/data/{today}).
    Nếu ngày hôm nay chưa có dữ liệu trên Firebase thì trả về None (không lùi về ngày cũ).
    """
    today_str = target_date or datetime.now().strftime("%Y-%m-%d")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            day_res = await client.get(f"{FIREBASE_DB_URL}/data/{today_str}.json")
            if day_res.status_code == 200 and isinstance(day_res.json(), dict):
                times = day_res.json()
                sorted_times = sorted(times.keys(), reverse=True)
                for latest_time in sorted_times:
                    reading = times[latest_time]
                    if isinstance(reading, dict) and reading:
                        return {
                            "date": today_str,
                            "time": latest_time,
                            "timestamp": f"{today_str} {latest_time}",
                            "reading": reading,
                        }
    except Exception as e:
        print(f"[FirebaseService] Lỗi đọc dữ liệu ngày {today_str} từ Firebase: {e}")
    return None


async def get_latest_sensor_from_firebase() -> Optional[Dict[str, Any]]:
    """
    Đọc trực tiếp mẫu quan trắc của ngày mới nhất từ Firebase Realtime Database (node /data).
    Sử dụng shallow query để lấy danh sách ngày nhanh chóng, sau đó chỉ tải dữ liệu của ngày mới nhất.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            shallow_res = await client.get(f"{FIREBASE_DB_URL}/data.json?shallow=true")
            if shallow_res.status_code == 200 and shallow_res.json():
                date_keys = list(shallow_res.json().keys())
                sorted_dates = sorted(date_keys, reverse=True)
                for latest_date in sorted_dates:
                    day_res = await client.get(f"{FIREBASE_DB_URL}/data/{latest_date}.json")
                    if day_res.status_code == 200 and isinstance(day_res.json(), dict):
                        times = day_res.json()
                        sorted_times = sorted(times.keys(), reverse=True)
                        for latest_time in sorted_times:
                            reading = times[latest_time]
                            if isinstance(reading, dict) and reading:
                                return {
                                    "date": latest_date,
                                    "time": latest_time,
                                    "timestamp": f"{latest_date} {latest_time}",
                                    "total_days_on_firebase": len(sorted_dates),
                                    "reading": reading,
                                }
    except Exception as e:
        print(f"[FirebaseService] Lỗi đọc dữ liệu cảm biến mới nhất từ Firebase: {e}")
    return None


CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "cache")
CACHE_FILE = os.path.join(CACHE_DIR, "latest_recommendation.json")

_memory_cache: Optional[Dict[str, Any]] = None


async def save_recommendation_to_firebase(recommendation_dict: Dict[str, Any]) -> bool:
    """Lưu trữ kết quả khuyến nghị mới nhất vào bộ nhớ cache và Firebase."""
    global _memory_cache
    try:
        recommendation_dict["saved_at"] = datetime.now().isoformat()
        _memory_cache = recommendation_dict

        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(recommendation_dict, f, ensure_ascii=False, indent=2)

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

    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                _memory_cache = data
                return data
        except Exception:
            pass

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(f"{FIREBASE_DB_URL}/recommendations/latest.json")
            if res.status_code == 200 and res.json():
                _memory_cache = res.json()
                return res.json()
    except Exception:
        pass

    return None
