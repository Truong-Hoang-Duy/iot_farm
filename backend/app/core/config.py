import os
from pathlib import Path
from dotenv import load_dotenv

# Tìm thư mục gốc của backend và nạp .env
BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    val = os.getenv(name)
    if val is None or val.strip() == "":
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)).strip())
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)).strip())
    except (TypeError, ValueError):
        return default


def _path(name: str, default: str) -> Path:
    raw = os.getenv(name, default).strip() or default
    p = Path(raw)
    return p if p.is_absolute() else (BASE_DIR / p)


# ---------------- Gemini ----------------
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()

# ---------------- Server ----------------
PORT = _int("PORT", 8000)
HOST = os.getenv("HOST", "0.0.0.0")

# ---------------- Firebase ----------------
FIREBASE_DB_URL = os.getenv(
    "FIREBASE_DB_URL",
    "https://iot-farm-chilli-default-rtdb.asia-southeast1.firebasedatabase.app",
).strip().rstrip("/")
# Cách 1 (khuyến nghị cho backend): Service Account JSON (quyền Admin, bỏ qua Security Rules)
FIREBASE_SERVICE_ACCOUNT = os.getenv(
    "FIREBASE_SERVICE_ACCOUNT", "secrets/firebase-service-account.json"
).strip()
# Cách 2: tài khoản Firebase Auth email/password + Web API Key
FIREBASE_API_KEY = os.getenv("FIREBASE_API_KEY", "").strip()
FIREBASE_AUTH_EMAIL = os.getenv("FIREBASE_AUTH_EMAIL", "").strip()
FIREBASE_AUTH_PASSWORD = os.getenv("FIREBASE_AUTH_PASSWORD", "").strip()

DEVICE_ID = os.getenv("DEVICE_ID", "jetson-nano-01").strip()

# ---------------- InfluxDB 3 ----------------
INFLUX_URL = os.getenv("INFLUX_URL", "http://localhost:18181").strip().rstrip("/")
INFLUX_DB = os.getenv("INFLUX_DB", "iot_farm").strip()
INFLUX_TOKEN = os.getenv("INFLUX_TOKEN", "").strip()

# ---------------- Đồng bộ Firebase <-> InfluxDB ----------------
SYNC_ENABLED = _bool("SYNC_ENABLED", True)
SYNC_INTERVAL_SEC = max(10, _int("SYNC_INTERVAL_SEC", 60))          # Firebase -> Influx (hôm nay + hôm qua)
SYNC_AUDIT_INTERVAL_SEC = max(60, _int("SYNC_AUDIT_INTERVAL_SEC", 1800))  # đối chiếu toàn bộ + backfill
SYNC_AUDIT_DAYS = max(0, _int("SYNC_AUDIT_DAYS", 30))               # 0 = mọi ngày
BACKFILL_TO_FIREBASE = _bool("BACKFILL_TO_FIREBASE", True)          # Influx -> Firebase
BACKFILL_DAYS = max(0, _int("BACKFILL_DAYS", 7))                    # 0 = mọi ngày
SYNC_LOG_NOOP_TO_FIREBASE = _bool("SYNC_LOG_NOOP_TO_FIREBASE", False)

# ---------------- Vị trí vườn / thời tiết ----------------
FARM_LAT = _float("FARM_LAT", 10.843322589355028)
FARM_LON = _float("FARM_LON", 106.83888868895238)
FARM_TZ = os.getenv("FARM_TZ", "Asia/Ho_Chi_Minh").strip()
WEATHER_FORECAST_TTL_SEC = max(60, _int("WEATHER_FORECAST_TTL_SEC", 1800))

# ---------------- Thư mục cache / dữ liệu ----------------
CACHE_DIR = _path("CACHE_DIR", "app/cache")
SOIL_JSON_PATH = _path("SOIL_JSON_PATH", "../frontend/public/soil_all.json")

SENSOR_FIELDS = ["temperature", "humidity", "soiltemp", "moisture", "pH", "EC", "N", "P", "K"]


def is_gemini_configured() -> bool:
    return bool(GEMINI_API_KEY and len(GEMINI_API_KEY) > 10)
