import asyncio
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from app.api.recommendations import router as recommendations_router
from app.api.sensors import router as sensors_router
from app.api.alerts import router as alerts_router
from app.api.weather import router as weather_router
from app.api.data import router as data_router

try:
    from app.api.forecast import router as forecast_router
except Exception as _e:
    forecast_router = None
    print(f"[Main] Module dự báo chuỗi thời gian chưa khả dụng: {_e}")

from app.core.config import is_gemini_configured, GEMINI_MODEL
from app.services.scheduler import auto_recommendation_worker
from app.services.sensor_processing_service import get_processed_sensor_bundle
from app.services.sync_service import get_sync_service


async def _warmup_sensor_cache() -> None:
    try:
        bundle = await get_processed_sensor_bundle(method="ffill")
        info = bundle["pipeline_info"]
        print(
            f"[Startup] Đã nạp và làm sạch {info['total_rows']:,} bản ghi cảm biến "
            f"({info['first_date']} -> {info['last_date']})."
        )
    except asyncio.CancelledError:
        raise
    except Exception as e:
        print(f"[Startup] Cảnh báo khi nạp dữ liệu cảm biến ban đầu: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Chạy ngầm việc nạp dữ liệu, đồng bộ 2 chiều và phân tích định kỳ để Uvicorn mở cổng tức thì (tránh 502 trên Render)
    warmup_task = asyncio.create_task(_warmup_sensor_cache())
    sync_task = asyncio.create_task(get_sync_service().worker())
    worker_task = asyncio.create_task(auto_recommendation_worker())
    yield
    # Dừng các worker khi ứng dụng tắt
    for t in (warmup_task, sync_task, worker_task):
        t.cancel()
    for t in (warmup_task, sync_task, worker_task):
        try:
            await t
        except asyncio.CancelledError:
            pass

app = FastAPI(
    title="IoT Farm Engine API",
    description="Backend FastAPI hỗ trợ phân tích dữ liệu quan trắc đất và đề xuất canh tác cho hệ thống IoT Farm",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Cấu hình CORS và nén GZip để truyền dữ liệu cảm biến đã xử lý từ /api/sensors/* nhanh chóng
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gắn router
app.include_router(sensors_router, prefix="/api")
app.include_router(recommendations_router, prefix="/api")
app.include_router(alerts_router, prefix="/api")
app.include_router(weather_router, prefix="/api")
app.include_router(data_router, prefix="/api")
if forecast_router is not None:
    app.include_router(forecast_router, prefix="/api")

@app.get("/")
def read_root():
    return {
        "message": "IoT Farm AI & Sensor Processing Backend is running!",
        "gemini_active": is_gemini_configured(),
        "gemini_model": GEMINI_MODEL,
        "docs_url": "/docs"
    }

if __name__ == "__main__":
    import uvicorn
    from app.core.config import HOST, PORT
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=True)
