import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
import numpy as np
import pandas as pd
from sklearn.experimental import enable_iterative_imputer  # noqa: F401
from sklearn.impute import IterativeImputer, KNNImputer, SimpleImputer
from sklearn.preprocessing import StandardScaler

from app.core.config import CACHE_DIR
from app.services.firebase_service import FIREBASE_DB_URL
from app.services.sensor_data_service import invalidate_json_df_cache

VN_TZ = timezone(timedelta(hours=7))

RANDOM_STATE = 42
FREQUENCY = "5min"
FEATURE_COLUMNS = [
    "temperature",
    "humidity",
    "soiltemp",
    "moisture",
    "pH",
    "EC",
    "N",
    "P",
    "K",
]

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
LOCAL_JSON_PATHS = [
    CACHE_DIR / "soil_all.json",
    PROJECT_ROOT / "visualization" / "soil_all.json",
    PROJECT_ROOT / "frontend" / "public" / "soil_all.json",
    PROJECT_ROOT / "frontend" / "soil_all.json",
]

_processed_cache: Dict[str, Dict[str, Any]] = {}
_raw_payload_cache: Optional[Dict[str, Any]] = None
_last_firebase_sync_date: Optional[str] = None
_last_firebase_sync_ts: float = 0.0
_FIREBASE_CHECK_TTL_SEC = 15.0


def _save_payload_to_local_files(payload: Dict[str, Any]) -> List[str]:
    saved_paths: List[str] = []
    target_paths = [
        CACHE_DIR / "soil_all.json",
        PROJECT_ROOT / "frontend" / "public" / "soil_all.json",
        PROJECT_ROOT / "visualization" / "soil_all.json",
    ]
    for path in target_paths:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
            saved_paths.append(str(path))
        except Exception as e:
            print(f"[SensorProcessing] Không thể ghi {path}: {e}")
    return saved_paths


def merge_latest_days_from_firebase_sync(payload: Dict[str, Any]) -> bool:
    """Kiểm tra danh sách ngày trên Firebase (?shallow=true) và kéo bổ sung các ngày mới / 2 ngày gần nhất."""
    data_node = payload.setdefault("data", {})
    changed = False
    try:
        with httpx.Client(timeout=15.0) as client:
            res = client.get(f"{FIREBASE_DB_URL}/data.json?shallow=true")
            if res.status_code != 200 or not isinstance(res.json(), dict):
                return False
            fb_days = sorted(res.json().keys())
            if not fb_days:
                return False
            recent_days = set(fb_days[-2:])
            missing_or_recent = [d for d in fb_days if d not in data_node or d in recent_days]
            for d in missing_or_recent:
                day_res = client.get(f"{FIREBASE_DB_URL}/data/{d}.json")
                if day_res.status_code == 200 and isinstance(day_res.json(), dict):
                    new_records = day_res.json()
                    if data_node.get(d) != new_records:
                        data_node[d] = new_records
                        changed = True
    except Exception as e:
        print(f"[SensorProcessing] Không thể đồng bộ nhanh ngày mới từ Firebase: {e}")
        return False

    if changed:
        _save_payload_to_local_files(payload)
    return changed


async def sync_soil_all_from_firebase() -> Dict[str, Any]:
    """Kéo dữ liệu mới từ Firebase về lưu vào file soil_all.json và làm mới bộ nhớ đệm."""
    global _raw_payload_cache, _processed_cache, _sync_df_cache, _last_firebase_sync_date, _last_firebase_sync_ts
    if _raw_payload_cache is None:
        for path in LOCAL_JSON_PATHS:
            if path.exists():
                try:
                    with path.open("r", encoding="utf-8") as f:
                        loaded = json.load(f)
                        _raw_payload_cache = loaded if "data" in loaded else {"data": loaded}
                        break
                except Exception:
                    pass

    if _raw_payload_cache is not None:
        from fastapi.concurrency import run_in_threadpool

        await run_in_threadpool(merge_latest_days_from_firebase_sync, _raw_payload_cache)
        payload = _raw_payload_cache
    else:
        async with httpx.AsyncClient(timeout=45.0) as client:
            res = await client.get(f"{FIREBASE_DB_URL}/data.json")
            if res.status_code != 200 or not res.json():
                raise RuntimeError(f"Firebase trả về HTTP {res.status_code} hoặc dữ liệu rỗng.")
            fb_data = res.json()
        payload = {"data": fb_data} if "data" not in fb_data else fb_data
        _raw_payload_cache = payload
        _save_payload_to_local_files(payload)

    _processed_cache.clear()
    _sync_df_cache.clear()
    invalidate_json_df_cache()
    _last_firebase_sync_date = datetime.now(VN_TZ).strftime("%Y-%m-%d")
    _last_firebase_sync_ts = time.time()

    days = sorted(payload.get("data", {}).keys())
    return {
        "status": "ok",
        "synced_at": datetime.now(VN_TZ).isoformat(timespec="seconds"),
        "total_days": len(days),
        "first_date": days[0] if days else None,
        "last_date": days[-1] if days else None,
    }


async def fetch_raw_sensor_payload(force_refresh: bool = False) -> Dict[str, Any]:
    """Đọc dữ liệu cảm biến từ Firebase Realtime Database (/data) hoặc bản lưu cục bộ (kèm đồng bộ ngày mới)."""
    global _raw_payload_cache, _last_firebase_sync_date, _last_firebase_sync_ts
    today_vn = datetime.now(VN_TZ).strftime("%Y-%m-%d")
    now_ts = time.time()

    # Nếu đã sang ngày mới hoặc quá TTL kiểm tra nhanh, kiểm tra bản ghi mới trên Firebase
    if _last_firebase_sync_date is not None and _last_firebase_sync_date != today_vn:
        force_refresh = True

    if _raw_payload_cache is not None and not force_refresh:
        if now_ts - _last_firebase_sync_ts > _FIREBASE_CHECK_TTL_SEC:
            from fastapi.concurrency import run_in_threadpool

            _last_firebase_sync_ts = now_ts
            changed = await run_in_threadpool(merge_latest_days_from_firebase_sync, _raw_payload_cache)
            if changed:
                _processed_cache.clear()
                _sync_df_cache.clear()
                invalidate_json_df_cache()
        return _raw_payload_cache

    if _raw_payload_cache is None:
        for path in LOCAL_JSON_PATHS:
            if path.exists():
                with path.open("r", encoding="utf-8") as f:
                    loaded = json.load(f)
                    _raw_payload_cache = loaded if "data" in loaded else {"data": loaded}
                    break

    # Luôn kiểm tra và gộp các ngày mới trên Firebase (ví dụ 29/10, 30/10) vào bộ đệm
    try:
        await sync_soil_all_from_firebase()
        if _raw_payload_cache is not None:
            return _raw_payload_cache
    except Exception as e:
        print(f"[SensorProcessing] Firebase fallback to local cache: {type(e).__name__}")

    if _raw_payload_cache is not None:
        return _raw_payload_cache

    raise RuntimeError("Không tìm thấy dữ liệu cảm biến.")


def build_time_series_dataframe(payload: Dict[str, Any]) -> pd.DataFrame:
    """Chuyển dữ liệu cảm biến theo ngày/giờ thành DataFrame chuỗi thời gian chuẩn."""
    data_node = payload.get("data", payload)
    records: List[Dict[str, Any]] = []

    for day, readings in data_node.items():
        if not isinstance(readings, dict):
            continue
        for clock, values in readings.items():
            if not isinstance(values, dict):
                continue
            norm_clock = clock if len(clock) > 5 else f"{clock}:00"
            records.append({"timestamp_str": f"{day} {norm_clock}", **values})

    df = pd.DataFrame.from_records(records)
    if df.empty or "timestamp_str" not in df:
        raise ValueError("Dữ liệu cảm biến không đúng định dạng data[ngày][giờ].")

    df["timestamp"] = pd.to_datetime(df["timestamp_str"], format="%Y-%m-%d %H:%M:%S", errors="coerce")
    df = (
        df.dropna(subset=["timestamp"])
        .drop(columns=["timestamp_str"])
        .sort_values("timestamp")
        .set_index("timestamp")
    )
    df = df.loc[~df.index.duplicated(keep="last")]
    df = df.drop(columns=["source"], errors="ignore")

    for col in FEATURE_COLUMNS:
        if col not in df.columns:
            df[col] = np.nan
    df = df[FEATURE_COLUMNS].apply(pd.to_numeric, errors="coerce")

    # Resample theo từng đoạn liên tục (tránh tạo dòng giả qua khoảng trống dài giữa các đợt đo)
    segment_id = (df.index.to_series().diff() > pd.Timedelta(hours=24)).cumsum()
    segments = [ seg.resample(FREQUENCY).mean() for _, seg in df.groupby(segment_id) if not seg.empty ]
    df = pd.concat(segments) if segments else df.resample(FREQUENCY).mean()

    recorded_days = {k for k, v in data_node.items() if isinstance(v, dict) and v}
    if recorded_days:
        df = df[df.index.strftime("%Y-%m-%d").isin(recorded_days)]
    return df


def impute_and_clean_dataframe(
    df_raw: pd.DataFrame,
    method: str = "ffill",
    cap: Optional[str] = None,
    smoothing: bool = False,
) -> pd.DataFrame:
    """Xử lý dữ liệu khuyết và làm sạch nhiễu chuỗi thời gian cảm biến."""
    x_df = df_raw.copy()
    sample_idx = np.linspace(0, len(x_df) - 1, min(1000, len(x_df)), dtype=int)
    fit_sample = x_df.iloc[sample_idx].copy()

    method_clean = (method or "ffill").lower().strip()

    if method_clean == "median":
        imputer = SimpleImputer(strategy="median")
        imputer.fit(fit_sample)
        values = imputer.transform(x_df)
        cleaned_df = pd.DataFrame(values, index=x_df.index, columns=x_df.columns)
    elif method_clean == "ffill":
        fallback = x_df.median()
        cleaned_df = x_df.ffill().fillna(fallback)
    elif method_clean in ("knn", "mice"):
        scaler = StandardScaler()
        fit_scaled = scaler.fit_transform(fit_sample)
        all_scaled = scaler.transform(x_df)
        if method_clean == "knn":
            imputer = KNNImputer(n_neighbors=5, metric="nan_euclidean", weights="distance")
        else:
            imputer = IterativeImputer(max_iter=3, random_state=RANDOM_STATE, sample_posterior=False)
        imputer.fit(fit_scaled)
        imputed_scaled = imputer.transform(all_scaled)
        values = scaler.inverse_transform(imputed_scaled)
        cleaned_df = pd.DataFrame(values, index=x_df.index, columns=x_df.columns)
    else:
        raise ValueError(f"Phương pháp xử lý khuyết không hợp lệ: {method}")

    if cap:
        cap_clean = cap.lower().strip()
        if cap_clean == "zscore":
            center = cleaned_df.mean()
            scale = cleaned_df.std(ddof=0).replace(0, 1)
            lower, upper = center - 3 * scale, center + 3 * scale
            cleaned_df = cleaned_df.clip(lower, upper, axis="columns")
        elif cap_clean == "iqr":
            q1, q3 = cleaned_df.quantile(0.25), cleaned_df.quantile(0.75)
            width = (q3 - q1).replace(0, 1)
            lower, upper = q1 - 1.5 * width, q3 + 1.5 * width
            cleaned_df = cleaned_df.clip(lower, upper, axis="columns")

    if smoothing:
        cleaned_df = cleaned_df.rolling(window=12, min_periods=1).mean()

    return cleaned_df.round(2)


def _df_to_reading_dict(series_or_row: pd.Series) -> Dict[str, float]:
    return {
        "moisture": round(float(series_or_row["moisture"]), 2),
        "pH": round(float(series_or_row["pH"]), 2),
        "EC": round(float(series_or_row["EC"]), 2),
        "N": round(float(series_or_row["N"]), 2),
        "P": round(float(series_or_row["P"]), 2),
        "K": round(float(series_or_row["K"]), 2),
        "soiltemp": round(float(series_or_row["soiltemp"]), 2),
        "temperature": round(float(series_or_row["temperature"]), 2),
        "humidity": round(float(series_or_row["humidity"]), 2),
    }


async def get_processed_sensor_bundle(
    method: str = "ffill",
    cap: Optional[str] = None,
    smoothing: bool = False,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    """Trả về dữ liệu cảm biến đã xử lý làm sạch và tổng hợp theo từng giai đoạn sinh trưởng."""
    payload = await fetch_raw_sensor_payload(force_refresh=force_refresh)
    cache_key = f"{method}_{cap}_{smoothing}"
    if cache_key in _processed_cache and not force_refresh:
        return _processed_cache[cache_key]

    df_raw = build_time_series_dataframe(payload)

    missing_per_col = df_raw.isna().sum().to_dict()
    total_missing_cells = int(df_raw.isna().sum().sum())

    df_clean = impute_and_clean_dataframe(df_raw, method=method, cap=cap, smoothing=smoothing)

    df_export = df_clean.copy()
    df_export["date_str"] = df_export.index.strftime("%Y-%m-%d")
    df_export["time_str"] = df_export.index.strftime("%H:%M")

    nested_data: Dict[str, Dict[str, Dict[str, float]]] = {}
    for date_str, group in df_export.groupby("date_str", sort=True):
        day_dict: Dict[str, Dict[str, float]] = {}
        records = group.set_index("time_str")[FEATURE_COLUMNS].to_dict(orient="index")
        for t_str, vals in records.items():
            day_dict[t_str] = {k: round(float(v), 2) for k, v in vals.items()}
        nested_data[date_str] = day_dict

    sorted_dates = sorted(nested_data.keys())
    first_date = sorted_dates[0]
    last_date = sorted_dates[-1]
    last_times = sorted(nested_data[last_date].keys())
    latest_time = last_times[-1]
    latest_reading = nested_data[last_date][latest_time]

    overall_avg = _df_to_reading_dict(df_clean[FEATURE_COLUMNS].mean())

    stage_windows: List[Tuple[int, int]] = [
        (0, 24),
        (25, 54),
        (55, 89),
        (90, 134),
        (135, 219),
        (220, len(sorted_dates) - 1),
    ]
    stage_averages: List[Dict[str, Any]] = []
    for idx, (s_day, e_day) in enumerate(stage_windows):
        s_idx = min(len(sorted_dates) - 1, max(0, s_day))
        e_idx = min(len(sorted_dates) - 1, max(s_idx, e_day))
        s_date = sorted_dates[s_idx]
        e_date = sorted_dates[e_idx]

        mask = (df_clean.index >= pd.Timestamp(f"{s_date} 00:00:00")) & (
            df_clean.index <= pd.Timestamp(f"{e_date} 23:59:59")
        )
        slice_df = df_clean.loc[mask, FEATURE_COLUMNS]
        stage_averages.append(
            {
                "stageNumber": idx + 1,
                "minDays": s_idx + 1,
                "maxDays": e_idx + 1,
                "startDate": s_date,
                "endDate": e_date,
                "daysRecorded": e_idx - s_idx + 1,
                "sampleCount": int(len(slice_df)),
                "averageReading": _df_to_reading_dict(slice_df.mean()),
            }
        )

    bundle = {
        "pipeline_info": {
            "imputation_method": method,
            "outlier_cap": cap,
            "smoothing_1h": smoothing,
            "total_rows": int(len(df_clean)),
            "total_days": len(sorted_dates),
            "first_date": first_date,
            "last_date": last_date,
            "missing_cells_imputed": total_missing_cells,
            "missing_by_feature": {k: int(v) for k, v in missing_per_col.items()},
            "remaining_missing": int(df_clean.isna().sum().sum()),
        },
        "latest": {
            "date": last_date,
            "time": latest_time,
            "timestamp": f"{last_date} {latest_time}",
            "reading": latest_reading,
        },
        "summary": {
            "totalDays": len(sorted_dates),
            "totalSamples": int(len(df_clean)),
            "firstDate": first_date,
            "lastDate": last_date,
            "missingCellsImputed": total_missing_cells,
            "missingByFeature": {k: int(v) for k, v in missing_per_col.items()},
            "imputationMethod": method,
            "overallAverage": overall_avg,
            "latestReading": latest_reading,
        },
        "stage_averages": stage_averages,
        "nested_data": nested_data,
        "df_clean": df_clean,
    }

    _processed_cache[cache_key] = bundle
    return bundle


_sync_df_cache: Dict[str, pd.DataFrame] = {}


def get_cleaned_sensor_dataframe_sync(method: str = "ffill") -> pd.DataFrame:
    """Trả về DataFrame cảm biến đã qua bước tiền xử lý và làm sạch (phục vụ đồng bộ cho /api/sensors/history và tương quan)."""
    global _raw_payload_cache, _last_firebase_sync_date
    today_vn = datetime.now(VN_TZ).strftime("%Y-%m-%d")
    cache_key = f"{method}_None_False"
    if cache_key in _processed_cache and "df_clean" in _processed_cache[cache_key] and _last_firebase_sync_date == today_vn:
        return _processed_cache[cache_key]["df_clean"].copy()
    if method in _sync_df_cache and _last_firebase_sync_date == today_vn:
        return _sync_df_cache[method].copy()

    payload_data: Optional[Dict[str, Any]] = _raw_payload_cache
    if payload_data is None:
        for path in LOCAL_JSON_PATHS:
            if path.exists():
                with path.open("r", encoding="utf-8") as f:
                    loaded = json.load(f)
                    payload_data = loaded if "data" in loaded else {"data": loaded}
                    break
    if payload_data is None:
        with httpx.Client(timeout=35.0) as client:
            res = client.get(f"{FIREBASE_DB_URL}/data.json")
            res.raise_for_status()
            fb = res.json() or {}
            payload_data = fb if "data" in fb else {"data": fb}
    else:
        merge_latest_days_from_firebase_sync(payload_data)

    _raw_payload_cache = payload_data
    _last_firebase_sync_date = today_vn
    df_raw = build_time_series_dataframe(payload_data)
    df_clean = impute_and_clean_dataframe(df_raw, method=method)
    _sync_df_cache[method] = df_clean
    return df_clean.copy()


STAGE_DEFINITIONS = [
    (1, 1, 25, "Cây con và bén rễ"),
    (2, 26, 55, "Phân cành chảng ba"),
    (3, 56, 90, "Ra hoa và đậu quả"),
    (4, 91, 135, "Nuôi quả non"),
    (5, 136, 220, "Thu hoạch rộ nhiều đợt"),
    (6, 221, 9999, "Cuối vụ và phục hồi đất"),
]


def resolve_stage_by_age(age_days: int) -> Tuple[int, str]:
    """Xác định số thứ tự và tên giai đoạn sinh trưởng dựa trên tuổi cây thực tế."""
    for stage_num, min_d, max_d, stage_name in STAGE_DEFINITIONS:
        if min_d <= age_days <= max_d:
            return stage_num, stage_name
    return STAGE_DEFINITIONS[-1][0], STAGE_DEFINITIONS[-1][3]


async def get_current_plant_context(method: str = "ffill") -> Dict[str, Any]:
    """Lấy trực tiếp thông tin cây trồng và mẫu cảm biến mới nhất đã xử lý từ bộ nhớ đệm."""
    bundle = await get_processed_sensor_bundle(method=method)
    age_days = int(bundle["summary"]["totalDays"])
    stage_num, stage_name = resolve_stage_by_age(age_days)
    latest = bundle["latest"]
    stage_list = bundle.get("stage_averages", [])
    current_stage_avg = (
        stage_list[stage_num - 1]["averageReading"]
        if 0 <= stage_num - 1 < len(stage_list)
        else bundle["summary"]["overallAverage"]
    )
    return {
        "plant_type": "Cây ớt",
        "age_days": age_days,
        "stage_number": stage_num,
        "growth_stage": stage_name,
        "first_date": bundle["summary"]["firstDate"],
        "last_date": bundle["summary"]["lastDate"],
        "timestamp": latest["timestamp"],
        "reading": latest["reading"],
        "stage_average": current_stage_avg,
    }
