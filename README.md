# 🌱 IoT Farm - Hệ thống giám sát & điều khiển tưới tiêu thông minh

> **Dự án IoT nông nghiệp thông minh** — Trường Đại học Công nghệ Thông tin - ĐHQG TP.HCM (UIT)  
> Hệ thống IoT giám sát các thông số đất (NPK, pH, EC, độ ẩm, nhiệt độ) và điều khiển tưới tiêu thông minh theo thời gian thực kết nối Firebase.

---

## 📌 Mục lục
1. [Giới thiệu](#-giới-thiệu)
2. [Thông tin tài khoản đăng nhập](#-thông-tin-tài-khoản-đăng-nhập)
3. [Hướng dẫn cài đặt & Chạy dự án](#-hướng-dẫn-cài-đặt--chạy-dự-án)
4. [Các tính năng chính](#-các-tính-năng-chính)
5. [Công nghệ sử dụng](#-công-nghệ-sử-dụng)
6. [Cấu trúc mã nguồn](#-cấu-trúc-mã-nguồn)

---

## 📖 Giới thiệu

**IoT Farm** là ứng dụng web điều khiển và giám sát nông nghiệp thông minh, kết nối trực tiếp với trạm cảm biến IoT thông qua **Firebase Realtime Database** và hệ thống xác thực người dùng **Firebase Authentication**.

Hệ thống cho phép:
- Giám sát các chỉ số hóa lý của đất theo thời gian thực (Độ ẩm đất, Nhiệt độ đất, pH, EC, Nitơ - N, Photpho - P, Kali - K).
- Giám sát các chỉ số môi trường khí quyển (Nhiệt độ không khí, Độ ẩm không khí, Ánh sáng).
- Điều khiển thiết bị tưới tiêu thủ công hoặc tự động theo ngưỡng cài đặt.
- Cảnh báo bất thường nông học và đưa ra khuyến nghị phân bón, tưới nước phù hợp theo chu kỳ phát triển của cây trồng.

---

## 🔐 Cơ chế truy cập

Hệ thống đã **tắt màn hình đăng nhập**. Người dùng truy cập trực tiếp vào hệ thống giám sát và điều khiển tại [http://localhost:8080/](http://localhost:8080/) mà không cần tài khoản hay mật khẩu.

---

## 🚀 Hướng dẫn cài đặt & Chạy dự án (Fullstack Monorepo)

### 1. Yêu cầu môi trường
- **Node.js**: Phiên bản 18 trở lên (Khuyến nghị Node.js LTS hoặc v20+).
- **Python**: Phiên bản 3.10 trở lên (Khuyến nghị Python 3.12).
- **Trình quản lý gói**: `npm` và `pip`.

### 2. Cấu hình Gemini AI API Key (tùy chọn)
Để kích hoạt tính năng đề xuất chuyên sâu từ Google Gemini AI, bạn mở file `backend/.env` và dán API Key của bạn vào:
```bash
GEMINI_API_KEY="AIzaSy..."
```
*(Nếu chưa có API Key, hệ thống sẽ tự động sử dụng bộ suy diễn nông học dự phòng theo tiêu chuẩn Haifa Group mà không gây lỗi).*

### 3. Các bước khởi chạy

#### Cách 1: Chạy song song cả Frontend & Backend từ thư mục gốc (khuyến nghị)
```bash
cd /Users/truonghoangduy/Documents/Project/IOT/iot_farm

# Chạy cả 2 môi trường bằng 1 lệnh duy nhất:
npm run dev
```

#### Cách 2: Khởi chạy thủ công từng phần
- **Khởi động Backend (FastAPI)**:
  ```bash
  cd /Users/truonghoangduy/Documents/Project/IOT/iot_farm/backend
  pip install -r requirements.txt
  python3 -m uvicorn app.main:app --reload --port 8000
  ```
  *(Tài liệu API Swagger trực quan: [http://localhost:8000/docs](http://localhost:8000/docs))*

- **Khởi động Frontend (React + Vite)**:
  ```bash
  cd /Users/truonghoangduy/Documents/Project/IOT/iot_farm/frontend
  npm install
  npm run dev
  ```

Sau khi chạy, truy cập ứng dụng tại:
- **Giao diện Web:** [http://localhost:8080/](http://localhost:8080/)
- **Backend API Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)

---

### 4. Các lệnh quản lý tiện ích

| Lệnh (chạy tại thư mục gốc) | Mô tả |
| :--- | :--- |
| `npm run dev` | Khởi chạy đồng thời cả Frontend (cổng 8080) và Backend (cổng 8000) |
| `npm run dev:frontend` | Chỉ khởi chạy máy chủ phát triển Frontend |
| `npm run dev:backend` | Chỉ khởi chạy máy chủ phát triển Backend FastAPI |
| `npm run build:frontend` | Đóng gói sản phẩm Frontend tối ưu hóa |


---

## ✨ Các tính năng chính

1. **Dashboard quan trắc thời gian thực:**
   - Hiển thị trực quan các thẻ chỉ số cảm biến NPK, pH, EC, nhiệt độ, độ ẩm.
   - Đồ thị tương tác thể hiện biến động dữ liệu theo mốc thời gian.
2. **Thông tin cây trồng (Plant Info):**
   - Theo dõi từng giai đoạn sinh trưởng của cây trồng (Ươm mầm, Sinh trưởng, Ra hoa, Đậu quả, Thu hoạch).
   - Đếm số ngày trồng thực tế và căn chỉnh ngưỡng thích hợp.
3. **Cảnh báo bất thường (Alerts):**
   - Ghi nhận lịch sử cảnh báo mức Độ rủi ro (Thấp, Trung bình, Nguy hiểm).
   - Phát hiện các dấu hiệu: đất khô hạn, thừa ẩm, thiếu dinh dưỡng, lệch chuẩn pH.
4. **Điều khiển tưới tiêu (Controls):**
   - Chuyển đổi linh hoạt giữa chế độ **Thủ công (Manual)** và **Tự động (Auto)**.
   - Bật/tắt máy bơm, van tưới trực tiếp từ xa với phản hồi trạng thái tức thời lên Firebase.
5. **Khuyến nghị nông học (Recommendations):**
   - Đưa ra đề xuất bổ sung phân bón N-P-K, điều chỉnh lượng nước tưới dựa trên dữ liệu cảm biến đo được.
6. **Cài đặt hệ thống (Settings):**
   - Cấu hình ngưỡng cảnh báo cận trên / cận dưới cho từng cảm biến.
   - Quản lý tài khoản và đổi mật khẩu an toàn.

---

## 🛠 Công nghệ sử dụng

- **Frontend Core:** [React 18](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
- **Build Tool:** [Vite](https://vitejs.dev/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/), Lucide Icons
- **Quản lý dữ liệu & State:** [TanStack React Query](https://tanstack.com/query/latest)
- **Biểu đồ:** [Recharts](https://recharts.org/)
- **Hạ tầng đám mây / IoT Cloud:** [Google Firebase](https://firebase.google.com/)
  - **Firebase Authentication:** Xác thực đăng nhập email/mật khẩu an toàn
  - **Firebase Realtime Database:** Đồng bộ dữ liệu telemetry từ trạm ESP32 lên giao diện Web mili-giây

---

## 📁 Cấu trúc mã nguồn

```text
iot_farm/
├── public/                 # Hình ảnh logo, tài nguyên tĩnh
├── src/
│   ├── components/         # Các UI component tái sử dụng (Button, Dialog, Cards, Layout...)
│   │   ├── dashboard/      # SensorCard, SensorChart, StatusBadge...
│   │   ├── layout/         # Sidebar, Header, Page Layout
│   │   └── ui/             # Bộ thành phần shadcn UI
│   ├── config/
│   │   └── firebaseConfig.tsx # Thông số kết nối Firebase App, Auth, Database
│   ├── contexts/
│   │   └── AuthContext.tsx    # Xử lý đăng nhập, phiên người dùng, đổi mật khẩu
│   ├── data/               # Dữ liệu tĩnh nông học (chu kỳ phát triển cây trồng)
│   ├── hooks/              # Custom React hooks (useToast, ...)
│   ├── pages/              # Các màn hình chính của ứng dụng
│   │   ├── Login.tsx          # Màn hình đăng nhập
│   │   ├── Dashboard.tsx      # Bảng điều khiển quan trắc chính
│   │   ├── PlantInfo.tsx      # Quản lý thông tin cây trồng
│   │   ├── Alerts.tsx         # Lịch sử cảnh báo
│   │   ├── Controls.tsx       # Điều khiển thiết bị & máy bơm
│   │   ├── Recommendations.tsx# Khuyến nghị kỹ thuật nông học
│   │   ├── Settings.tsx       # Cài đặt ngưỡng và thông số
│   │   └── ChangePassword.tsx # Đổi mật khẩu tài khoản
│   ├── services/
│   │   ├── firebaseAPI.tsx    # Lắng nghe & cập nhật Realtime Database
│   │   └── sensorAPI.tsx      # Đọc dữ liệu lịch sử cảm biến
│   ├── App.tsx             # Định tuyến đường dẫn (React Router) & Protected Route
│   └── main.tsx            # Điểm khởi tạo ứng dụng React
├── package.json            # Cấu hình dự án và danh sách thư viện
├── tailwind.config.ts      # Cấu hình giao diện Tailwind CSS
└── vite.config.ts          # Cấu hình Vite server (cổng 8080)
```

---

## 🔤 Quy chuẩn viết hoa & văn phong tiếng Việt (Sentence Case)

> [!IMPORTANT]
> **Quy tắc bắt buộc:** Trong toàn bộ dự án (tiêu đề trang, nhãn biểu đồ, menu điều hướng, nút bấm, thông báo và tài liệu), **chỉ viết hoa chữ cái đầu tiên** của câu/cụm từ, các chữ còn lại **viết thường** (Sentence case).
> - ✅ **Đúng:** *"Thời tiết & khí tượng nông nghiệp"*, *"Tổng quan hệ thống"*, *"Quản lý tưới tiêu thông minh"*, *"Dự báo vs thực tế trên tập test"*.
> - ❌ **Không dùng Title Case:** *"Thời Tiết & Khí Tượng Nông Nghiệp"*, *"Tổng Quan Hệ Thống"*.
> - **Ngoại lệ:** Tên riêng (Việt Nam, UIT, ĐHQG TP.HCM...) và thuật ngữ kỹ thuật viết tắt (IoT, AI, NPK, GPS, VPD, XGBoost, Jetson Nano...).

---

## 🏢 Thông tin đơn vị & Dự án

- **Đơn vị:** Trường Đại học Công nghệ Thông tin — ĐHQG-HCM (UIT)
- **Khoa:** Công Nghệ Điện Tử
- **Năm thực hiện:** 2025 – 2026
