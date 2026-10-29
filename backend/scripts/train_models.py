"""Thin CLI: huấn luyện + đánh giá toàn bộ mô hình dự báo.

    cd backend
    .venv\\Scripts\\python.exe scripts\\train_models.py            # đầy đủ (GPU nếu có)
    .venv\\Scripts\\python.exe scripts\\train_models.py --quick    # smoke test
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ml.train import main  # noqa: E402

if __name__ == "__main__":
    main()

