# 🌱 IoT Farm – hệ thống giám sát & điều khiển nông nghiệp thông minh

> **Dự án IoT nông nghiệp thông minh** — Trường Đại học Công nghệ Thông tin, ĐHQG TP.HCM (UIT)  
> Hệ thống IoT giám sát thông số đất (NPK, pH, EC, độ ẩm, nhiệt độ), khí quyển (DHT20) và điều khiển tưới tiêu, chiếu sáng qua mạch **Waveshare 3CH Relay** trên **Jetson Nano** kết nối thời gian thực với **Firebase Realtime Database**.

---

## 📌 Mục lục
1. [Giới thiệu](#-giới-thiệu)
2. [Cơ chế truy cập](#-cơ-chế-truy-cập)
3. [Hướng dẫn cài đặt & chạy dự án](#-hướng-dẫn-cài-đặt--chạy-dự-án)
4. [Điều khiển đèn & máy bơm qua mạch Waveshare 3CH Relay](#-điều-khiển-đèn--máy-bơm-qua-mạch-waveshare-3ch-relay)
5. [Các tính năng chính](#-các-tính-năng-chính)
6. [Công nghệ sử dụng](#-công-nghệ-sử-dụng)
7. [Cấu trúc mã nguồn](#-cấu-trúc-mã-nguồn)

---

## 📖 Giới thiệu

**IoT Farm** là nền tảng fullstack kết hợp thiết bị biên (**Jetson Nano**) để giám sát và điều khiển canh tác thông minh:
- Quan trắc thời gian thực chỉ số đất từ cảm biến **CWT 7in1 RS485** (độ ẩm đất, nhiệt độ đất, pH, EC, N, P, K) và không khí từ **DHT20 I2C** (nhiệt độ, độ ẩm không khí).
- Điều khiển **đèn chiếu sáng (Relay 1 – CH1)** và **máy bơm nước (Relay 2 – CH2)** trên mạch **Waveshare 3CH Relay** với đầy đủ 3 chế độ: **tự động**, **thủ công** và **theo lập lịch**.
- Dự báo chuỗi thời gian bằng Machine Learning (XGBoost, LSTM, PatchTST, N-HiTS) kết hợp dữ liệu khí tượng Open-Meteo và tư vấn nông học AI từ Google Gemini.

---

## 🔐 Cơ chế truy cập

Hệ thống mở truy cập trực tiếp tại [http://localhost:8080/](http://localhost:8080/) để giám sát và điều khiển mà không bắt buộc đăng nhập trên giao diện cục bộ.

---

## 🚀 Hướng dẫn cài đặt & chạy dự án

### 1. Yêu cầu môi trường
- **Máy tính chạy Web & Backend (Windows / macOS / Linux)**:
  - **Node.js**: phiên bản 18 trở lên (khuyến nghị Node.js 20 LTS).
  - **Python**: phiên bản 3.10 trở lên (khuyến nghị Python 3.12).
- **Thiết bị biên (Jetson Nano)**:
  - JetPack 4.6 / Ubuntu 18.04 / Python 3.6, thư viện `Jetson.GPIO` có sẵn trên hệ điều hành.

### 2. Cài đặt thư viện lần đầu (trên Windows PowerShell)
Mở PowerShell tại thư mục dự án `D:\SDH_UIT\Data Processing\Final Project_v2\iot_farm`:

```powershell
cd "D:\SDH_UIT\Data Processing\Final Project_v2\iot_farm"

# Cài đặt thư viện cho Frontend (React + Vite)
npm run install:frontend

# Cài đặt thư viện cho Backend (FastAPI + ML)
npm run install:backend
```

*(Bạn cũng có thể tạo môi trường ảo riêng cho `backend/` bằng `python -m venv backend\.venv` trước khi cài `pip install -r backend\requirements.txt`).*

### 3. Cấu hình Google Gemini API key (tùy chọn)
Để bật tư vấn nông học chuyên sâu bằng Google Gemini, tạo file `backend/.env` với nội dung:
```env
GEMINI_API_KEY="AIzaSy..."
```
*(Nếu không cấu hình, hệ thống tự động dùng bộ suy diễn nông học chuẩn Haifa Group mà không phát sinh lỗi).*

### 4. Khởi chạy Web (Frontend + Backend) trên Windows

#### Cách 1: Chạy đồng thời bằng 1 lệnh duy nhất (khuyến nghị)
```powershell
cd "D:\SDH_UIT\Data Processing\Final Project_v2\iot_farm"
npm run dev
```

#### Cách 2: Mở 2 cửa sổ PowerShell riêng biệt
- **Cửa sổ 1 – Backend FastAPI (cổng 8000)**:
  ```powershell
  cd "D:\SDH_UIT\Data Processing\Final Project_v2\iot_farm\backend"
  python -m uvicorn app.main:app --reload --port 8000
  ```
- **Cửa sổ 2 – Frontend Vite (cổng 8080)**:
  ```powershell
  cd "D:\SDH_UIT\Data Processing\Final Project_v2\iot_farm\frontend"
  npm run dev
  ```

Sau khi khởi động thành công, mở trình duyệt tại:
- **Giao diện người dùng:** [http://localhost:8080/](http://localhost:8080/)
- **Tài liệu API Swagger:** [http://localhost:8000/docs](http://localhost:8000/docs)

### 5. Khởi chạy tác tử biên (edge agent) trên Jetson Nano
Sao chép thư mục `edge/` sang Jetson Nano (đặt ở đường dẫn không có dấu cách như `~/iot-farm/edge`):

```bash
cd ~/iot-farm/edge
chmod +x install.sh
sudo ./install.sh --no-start

# Kiểm tra cấu hình Firebase & chân relay Waveshare (light_pin=40, pump_pin=38)
nano config.ini

# Khởi động dịch vụ tự chạy nền
sudo systemctl start iot-farm-agent
journalctl -u iot-farm-agent -f
```

Nếu muốn chạy giả lập ngay trên máy Windows để kiểm thử giao diện điều khiển mà chưa cần Jetson Nano:
```powershell
cd "D:\SDH_UIT\Data Processing\Final Project_v2\iot_farm\edge"
copy config.example.ini config.ini
python run_agent.py --simulate --assume-synced
```

### 6. Các lệnh quản lý tiện ích

| Lệnh (chạy tại thư mục gốc) | Mô tả |
| :--- | :--- |
| `npm run dev` | Chạy đồng thời cả Frontend (`8080`) và Backend (`8000`) |
| `npm run dev:frontend` | Chỉ khởi chạy máy chủ phát triển Frontend |
| `npm run dev:backend` | Chỉ khởi chạy máy chủ phát triển Backend FastAPI |
| `npm run build:frontend` | Đóng gói bản phân phối Frontend tối ưu hóa |

---

## ⚡ Điều khiển đèn & máy bơm qua mạch Waveshare 3CH Relay

Trên **Jetson Nano**, mạch mở rộng **Waveshare RPi Relay Board (3CH)** sử dụng logic kích mức thấp (`active_low = true`) với sơ đồ chân jumper mặc định (`P29 / P28 / P25`):
- **Relay 1 (`CH1`, `P29`) – Đèn chiếu sáng (`light`)**: chân vật lý **`BOARD 40`** (`BCM 21`).
- **Relay 2 (`CH2`, `P28`) – Máy bơm nước (`pump`)**: chân vật lý **`BOARD 38`** (`BCM 20`).
- **Relay 3 (`CH3`, `P25`) – Kênh dự phòng (`spare`)**: chân vật lý **`BOARD 37`** (`BCM 26`, giữ trạng thái ngắt an toàn).

Cả hai thiết bị đều hỗ trợ chuyển đổi linh hoạt giữa **3 chế độ** ngay trên trang **Cài đặt → Điều khiển thiết bị**:
1. **Tự động (`auto`)**:
   - **Máy bơm**: tự bật khi độ ẩm đất thấp hơn ngưỡng dưới (`low`) và tắt khi đạt ngưỡng trên (`high`).
   - **Đèn chiếu sáng**: tự động tính quang chu kỳ theo giai đoạn tuổi cây kết hợp bảo vệ nhiệt độ không khí từ cảm biến **DHT20**.
2. **Theo lập lịch (`schedule`)**:
   - **Máy bơm**: hẹn nhiều cữ tưới trong ngày theo định dạng `HH:MM` cùng thời lượng chạy (phút/cữ).
   - **Đèn chiếu sáng**: tùy chọn lập lịch **theo khung giờ bật – tắt** (hỗ trợ cả khung phụ & khung qua đêm) hoặc **theo từng cữ + thời lượng bật** tương tự máy bơm.
3. **Thủ công (`manual`)**: bật / tắt trực tiếp từ giao diện web với chu kỳ phản hồi ~2 giây từ Jetson Nano.

---

## ✨ Các tính năng chính

1. **Tổng quan hệ thống**: thẻ chỉ số cảm biến thời gian thực, trạng thái trực tuyến của Jetson Nano và mạch relay Waveshare.
2. **Thời tiết & khí tượng nông nghiệp**: đồng bộ dữ liệu thời tiết, VPD, ET0 và bức xạ mặt trời từ Open-Meteo.
3. **Phòng thí nghiệm mô hình**: huấn luyện và đối sánh các mô hình dự báo độ ẩm đất / nhiệt độ (XGBoost, LSTM, PatchTST, N-HiTS).
4. **Thông tin cây trồng & khuyến nghị nông học**: theo dõi giai đoạn sinh trưởng và gợi ý dinh dưỡng NPK, lịch tưới bằng AI.
5. **Cảnh báo & cài đặt hệ thống**: quản lý ngưỡng an toàn cảm biến, chu kỳ lấy mẫu và điều khiển thiết bị chấp hành.

---

## 🛠 Công nghệ sử dụng

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Shadcn UI, TanStack Query, Recharts.
- **Backend:** FastAPI (Python 3.12), Scikit-learn, XGBoost, Google GenAI SDK, HTTPX.
- **Edge (Jetson Nano):** Python 3.6, `Jetson.GPIO`, `minimalmodbus` (RS485), `smbus2` (I2C), SQLite store-and-forward.
- **Đám mây:** Firebase Realtime Database & Firebase Authentication.

---

## 📁 Cấu trúc mã nguồn

```text
iot_farm/
├── backend/                # Máy chủ FastAPI, dự báo ML & tư vấn AI Gemini (cổng 8000)
│   ├── app/                # Định tuyến API, dịch vụ thời tiết, nông học & pipeline ML
│   └── requirements.txt    # Danh sách thư viện Python cho Backend
├── edge/                   # Tác tử biên chạy trên Jetson Nano (Python 3.6)
│   ├── farm_agent/         # Đọc cảm biến CWT/DHT20, hàng đợi SQLite & điều khiển relay Waveshare
│   ├── tests/              # Unit test, mock Firebase & kiểm tra tương thích Python 3.6
│   ├── config.example.ini  # Mẫu cấu hình thiết bị & chân GPIO relay
│   └── install.sh          # Script cài đặt tự động systemd service trên Jetson Nano
├── frontend/               # Ứng dụng giao diện người dùng React + Vite (cổng 8080)
│   └── src/                # Trang giao diện, components, hooks & kết nối Firebase
├── firebase/               # Quy tắc bảo mật Firebase Realtime Database
└── package.json            # Script điều phối chạy đồng thời toàn dự án
```

---

## 🔤 Quy chuẩn viết hoa & văn phong tiếng Việt (Sentence case)

> [!IMPORTANT]
> **Quy tắc bắt buộc:** Trong toàn bộ dự án (tiêu đề trang, nhãn biểu đồ, menu điều hướng, nút bấm, thông báo và tài liệu), **chỉ viết hoa chữ cái đầu tiên** của câu/cụm từ, các chữ còn lại **viết thường** (Sentence case).
> - ✅ **Đúng:** *"Thời tiết & khí tượng nông nghiệp"*, *"Tổng quan hệ thống"*, *"Quản lý tưới tiêu thông minh"*, *"Dự báo vs thực tế trên tập test"*.
> - ❌ **Không dùng Title Case:** *"Thời Tiết & Khí Tượng Nông Nghiệp"*, *"Tổng Quan Hệ Thống"*.
> - **Ngoại lệ:** Tên riêng (Việt Nam, UIT, ĐHQG TP.HCM...) và thuật ngữ kỹ thuật / thương hiệu (IoT, AI, NPK, VPD, DHT20, CWT, Waveshare, Jetson Nano, Firebase, FastAPI, React, Vite...).

---

## 🏢 Thông tin đơn vị & dự án

- **Đơn vị:** Trường Đại học Công nghệ Thông tin — ĐHQG TP.HCM (UIT)
- **Khoa:** Kỹ thuật Máy tính / Công nghệ Điện tử
- **Năm thực hiện:** 2025 – 2026
