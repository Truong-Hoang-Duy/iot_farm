import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.recommendations import router as recommendations_router
from app.api.data import router as data_router
from app.api.weather import router as weather_router
from app.core.config import is_gemini_configured, GEMINI_MODEL
from app.services.scheduler import auto_recommendation_worker
from app.services.sync_service import get_sync_service

try:  # module dự báo (ML) – có thể chưa cài đủ thư viện
    from app.api.forecast import router as forecast_router
except Exception as exc:  # pragma: no cover
    forecast_router = None
    print(f"[Main] Chưa nạp được API dự báo: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Khởi động các worker chạy ngầm: khuyến nghị định kỳ + đồng bộ Firebase <-> InfluxDB
    tasks = [
        asyncio.create_task(auto_recommendation_worker()),
        asyncio.create_task(get_sync_service().worker()),
    ]
    yield
    # Dừng worker khi ứng dụng tắt
    for t in tasks:
        t.cancel()
    for t in tasks:
        try:
            await t
        except asyncio.CancelledError:
            pass

app = FastAPI(
    title="IoT Farm Engine API",
    description="Backend FastAPI hỗ trợ phân tích dữ liệu quan trắc đất, đồng bộ Firebase ↔ InfluxDB, "
                "dữ liệu thời tiết và dự báo chuỗi thời gian cho hệ thống IoT Farm",
    version="2.0.0",
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
app.include_router(recommendations_router, prefix="/api")
app.include_router(data_router, prefix="/api")
app.include_router(weather_router, prefix="/api")
if forecast_router is not None:
    app.include_router(forecast_router, prefix="/api")

@app.get("/")
def read_root():
    return {
        "message": "IoT Farm AI Backend is running!",
        "gemini_active": is_gemini_configured(),
        "gemini_model": GEMINI_MODEL,
        "forecast_api": forecast_router is not None,
        "docs_url": "/docs"
    }

if __name__ == "__main__":
    import uvicorn
    from app.core.config import HOST, PORT
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=True)
