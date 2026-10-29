"""Cấu hình chung cho pipeline dự báo (ML).

Biến môi trường (đọc trực tiếp bằng os.getenv, đã được main agent bổ sung vào .env.example):

| Biến                    | Mặc định                         | Ý nghĩa |
|-------------------------|----------------------------------|---------|
| ML_DATA_SOURCE          | auto                             | auto | influx | json (auto = Influx nếu truy vấn được và có >= 7 ngày) |
| ML_JSON_PATH            | <repo>/frontend/public/soil_all.json | File JSON dự phòng |
| ML_ARTIFACTS_DIR        | <repo>/backend/artifacts         | Nơi lưu mô hình + metrics |
| ML_DEVICE               | auto                             | auto | cuda | cpu |
| ML_FORECAST_CACHE_SEC   | 300                              | Thời gian cache kết quả dự báo |
| ML_CHRONOS_MODEL        | amazon/chronos-bolt-small        | Model id HuggingFace |
| ML_USE_WEATHER          | 1                                | 0 = không dùng thời tiết cho nhóm dài hạn |
| HF_HOME                 | <artifacts>/hf_cache             | Cache HuggingFace (tải Chronos 1 lần) |
"""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent

try:  # nạp backend/.env khi chạy CLI độc lập (app.core.config cũng làm việc này khi chạy server)
    from dotenv import load_dotenv

    load_dotenv(BACKEND_DIR / ".env")
except Exception:  # noqa: BLE001
    pass

ARTIFACTS_DIR = Path(os.getenv("ML_ARTIFACTS_DIR", str(BACKEND_DIR / "artifacts"))).resolve()
MODELS_DIR = ARTIFACTS_DIR / "models"
TEST_PRED_DIR = ARTIFACTS_DIR / "test_predictions"
METRICS_PATH = ARTIFACTS_DIR / "metrics.json"
MODEL_CARDS_PATH = ARTIFACTS_DIR / "model_cards.json"
TRAIN_STATUS_PATH = ARTIFACTS_DIR / "train_status.json"
TRAIN_LOG_PATH = ARTIFACTS_DIR / "train.log"
WEATHER_CACHE_PATH = ARTIFACTS_DIR / "weather_hourly.parquet"
HF_CACHE_DIR = Path(os.getenv("HF_HOME", str(ARTIFACTS_DIR / "hf_cache"))).resolve()

# HuggingFace cache phải được đặt trước khi import transformers/chronos
os.environ.setdefault("HF_HOME", str(HF_CACHE_DIR))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
# Nếu trọng số Chronos đã có trong cache -> chạy offline (không gọi mạng khi suy luận)
if (HF_CACHE_DIR / "hub" / "models--amazon--chronos-bolt-small" / "snapshots").exists():
    os.environ.setdefault("HF_HUB_OFFLINE", "1")

JSON_PATH = Path(os.getenv("ML_JSON_PATH", str(REPO_DIR / "frontend" / "public" / "soil_all.json"))).resolve()
DATA_SOURCE = os.getenv("ML_DATA_SOURCE", "auto").strip().lower()
DEVICE_PREF = os.getenv("ML_DEVICE", "auto").strip().lower()
FORECAST_CACHE_SEC = int(os.getenv("ML_FORECAST_CACHE_SEC", "300"))
CHRONOS_MODEL_ID = os.getenv("ML_CHRONOS_MODEL", "amazon/chronos-bolt-small")
USE_WEATHER = os.getenv("ML_USE_WEATHER", "1").strip() not in ("0", "false", "no")

TZ = "Asia/Ho_Chi_Minh"
LAT, LON = 10.843322589355028, 106.83888868895238
SEED = 42

TARGETS = ["temperature", "humidity", "soiltemp", "moisture", "pH", "EC", "N", "P", "K"]
UNITS = {
    "temperature": "°C", "humidity": "%RH", "soiltemp": "°C", "moisture": "%",
    "pH": "", "EC": "mS/cm", "N": "mg/kg", "P": "mg/kg", "K": "mg/kg",
}

# Miền giá trị vật lý hợp lệ (ngoài miền -> NaN, KHÔNG clip về biên để tránh tạo giá trị giả)
# Nguồn: datasheet DHT20 (-40..80 °C, 0..100 %RH) & cảm biến đất CWT 7in1 (pH 3..9 thực tế,
# EC 0..20 mS/cm, NPK 0..1999 mg/kg). Nhiệt độ không khí được giới hạn chặt hơn cho khí hậu TP.HCM.
VALID_RANGES = {
    "temperature": (5.0, 55.0),
    "humidity": (0.0, 100.0),
    "soiltemp": (5.0, 60.0),
    "moisture": (0.0, 100.0),
    "pH": (0.0, 14.0),
    "EC": (0.0, 20.0),
    "N": (0.0, 1999.0),
    "P": (0.0, 1999.0),
    "K": (0.0, 1999.0),
}

# Hai nhóm dự báo đa độ phân giải (plan mục 6)
GROUPS = {
    "short": {
        "freq": "5min",
        "resolution_minutes": 5,
        "H": 144,
        "input_size": 576,
        "season": 288,
        "horizons": {"5m": 1, "10m": 2, "30m": 6, "1h": 12, "2h": 24, "6h": 72, "12h": 144},
        "origin_every_steps": 72,  # rolling origin mỗi 6 giờ trong tập test
    },
    "long": {
        "freq": "1h",
        "resolution_minutes": 60,
        "H": 120,
        "input_size": 336,
        "season": 24,
        "horizons": {"1d": 24, "2d": 48, "3d": 72, "4d": 96, "5d": 120},
        "origin_every_steps": 12,  # rolling origin mỗi 12 giờ trong tập test
    },
}

HORIZON_TO_GROUP = {h: g for g, cfg in GROUPS.items() for h in cfg["horizons"]}

WEATHER_COLS = [
    "temperature_2m", "relative_humidity_2m", "precipitation", "shortwave_radiation",
    "et0_fao_evapotranspiration", "cloud_cover", "vapour_pressure_deficit", "wind_speed_10m",
]
# Biến Open-Meteo dạng tích lũy/trung bình "giờ trước đó" (giá trị gắn nhãn HH = tổng HH-1..HH)
WEATHER_ACCUM_COLS = ["precipitation", "shortwave_radiation", "et0_fao_evapotranspiration"]

MODEL_KEYS = ["xgboost", "lstm", "nhits", "patchtst", "chronos", "seasonal_naive", "naive"]
MODEL_LABELS = {
    "xgboost": "XGBoost",
    "lstm": "LSTM",
    "nhits": "N-HiTS",
    "patchtst": "PatchTST",
    "chronos": "Chronos-Bolt (small)",
    "seasonal_naive": "Seasonal Naive (1 ngày)",
    "naive": "Naive",
}

SPLIT = {"train": 0.7, "val": 0.1, "test": 0.2}
QUANTILES = (0.1, 0.5, 0.9)  # khoảng dự báo 80 %


def ensure_dirs() -> None:
    for p in (ARTIFACTS_DIR, MODELS_DIR, TEST_PRED_DIR, HF_CACHE_DIR):
        p.mkdir(parents=True, exist_ok=True)
