import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.recommendations import router as recommendations_router
from app.core.config import is_gemini_configured, GEMINI_MODEL
from app.services.scheduler import auto_recommendation_worker

@asynccontextmanager
async def lifespan(app: FastAPI):
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
app.include_router(recommendations_router, prefix="/api")

@app.get("/")
def read_root():
    return {
        "message": "IoT Farm AI Backend is running!",
        "gemini_active": is_gemini_configured(),
        "gemini_model": GEMINI_MODEL,
        "docs_url": "/docs"
    }

if __name__ == "__main__":
    import uvicorn
    from app.core.config import HOST, PORT
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=True)
