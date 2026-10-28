import os
from pathlib import Path
from dotenv import load_dotenv

# Tìm thư mục gốc của backend và nạp .env
BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
PORT = int(os.getenv("PORT", "8000"))
HOST = os.getenv("HOST", "0.0.0.0")

def is_gemini_configured() -> bool:
    return bool(GEMINI_API_KEY and len(GEMINI_API_KEY) > 10)
