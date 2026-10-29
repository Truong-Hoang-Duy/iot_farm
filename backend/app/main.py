import asyncio
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
from fastapi.middleware.cors import CORSMiddleware
from app.api.recommendations import router as recommendations_router
from app.api.sensors import router as sensors_router
from app.api.alerts import router as alerts_router
from app.api.weather import router as weather_router

try:
    from app.api.forecast import router as forecast_router
except Exception as _e:
    forecast_router = None
    print(f"[Main] Module dự báo chuỗi thời gian chưa khả dụng: {_e}")

from app.core.config import is_gemini_configured, GEMINI_MODEL
from app.services.scheduler import auto_recommendation_worker
from app.services.sensor_processing_service import get_processed_sensor_bundle

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        bundle = await get_processed_sensor_bundle(method="ffill")
        info = bundle["pipeline_info"]
        print(
            f"[Startup] Đã nạp và làm sạch {info['total_rows']:,} bản ghi cảm biến "
            f"({info['first_date']} -> {info['last_date']})."
        )
    except Exception as e:
        print(f"[Startup] Cảnh báo khi nạp dữ liệu cảm biến ban đầu: {e}")

    # Khởi động worker phân tích định kỳ chạy ngầm
    worker_task = asyncio.create_task(auto_recommendation_worker())
    yield
    # Dừng worker khi ứng dụng tắt
    worker_task.cancel()
    try:
        await worker_task
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

# Cấu hình CORS để Frontend React gọi thoải mái
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
