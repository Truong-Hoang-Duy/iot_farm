"""API dự báo — main agent mount dưới prefix /api  ->  /api/forecast/...

Mọi xử lý nặng (nạp dữ liệu, suy luận GPU, đọc artifacts) chạy trong threadpool.
503 khi chưa có artifacts (chưa huấn luyện); 404 khi target/model/horizon không tồn tại; 409 khi đang train.
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from starlette.concurrency import run_in_threadpool

router = APIRouter(prefix="/forecast", tags=["Forecast"])


def _svc():
    from app.ml.forecast_service import get_service

    return get_service()


async def _call(fn, *args, **kwargs):
    from app.ml.forecast_service import ArtifactsMissing, NotFound

    try:
        return await run_in_threadpool(fn, *args, **kwargs)
    except ArtifactsMissing as e:
        raise HTTPException(status_code=503, detail=str(e))
    except NotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/models")
async def list_models():
    """[{key, name, family, paper, doi_url, year, available, trained_at, device, gpu_name, hyperparameters,
    description, status:{short, long}}]"""
    return await _call(_svc().models_info)


@router.get("/runtime")
async def runtime_info():
    """Thiết bị suy luận hiện tại (GPU), thiết bị lúc train, danh sách target/horizon."""
    return await _call(_svc().runtime_info)


@router.get("/metrics")
async def get_metrics(
    target: Optional[str] = None,
    horizon: Optional[str] = None,
    kind: Literal["cum", "point", "all"] = Query("cum", description="cum = gộp bước 1..k, point = chỉ bước k"),
    model: Optional[str] = None,
):
    return await _call(_svc().metrics_table, target, horizon, kind, model)


@router.get("/test-predictions")
async def get_test_predictions(
    target: str,
    group: Literal["short", "long"] = "short",
    model: Optional[str] = Query(None, description="lọc 1 mô hình; bỏ trống = tất cả"),
    last_days: Optional[float] = Query(None, description="chỉ trả về N ngày cuối của tập test"),
    format: Literal["series", "samples"] = "series",
):
    return await _call(_svc().test_predictions, target, group, model, last_days, format)


@router.post("/train")
async def start_training(quick: bool = False):
    """Chạy huấn luyện ở tiến trình nền (subprocess). Theo dõi qua GET /api/forecast/train/status."""
    return await _call(_svc().start_training, quick)


@router.get("/train/status")
async def training_status():
    """{state: idle|running|done|error, progress 0..1, stage, message, quick, started_at, finished_at, error, log[]}"""
    return await _call(_svc().training_status)


@router.get("")
async def get_forecast(
    target: str = "moisture",
    horizon: str = "6h",
    model: str = "best",
    refresh: bool = False,
):
    """Dự báo: history (quan sát gần nhất) + forecast [{t, yhat, lo, hi}] tới horizon yêu cầu."""
    if refresh:
        from app.services.sensor_processing_service import get_processed_sensor_bundle

        try:
            await get_processed_sensor_bundle(method="ffill", force_refresh=True)
        except Exception:
            pass
    return await _call(_svc().forecast, target, horizon, model, refresh)
