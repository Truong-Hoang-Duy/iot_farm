# Sử dụng Python 3.11 slim chính thức
FROM python:3.11-slim

# Thiết lập môi trường
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

WORKDIR /app

# Cài đặt build tools nếu cần biên dịch scikit-learn/numpy
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Cài đặt dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Sao chép toàn bộ mã nguồn backend vào container
COPY . .

# Mở cổng giao tiếp (Cloud Run tự động gán qua $PORT)
EXPOSE 8080

# Chạy ứng dụng FastAPI qua Uvicorn
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
