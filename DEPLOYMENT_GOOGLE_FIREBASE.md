# Hướng dẫn Triển khai Toàn diện Thuần Google & Firebase

Dự án IoT Farm được thiết kế với kiến trúc chuẩn **Google Cloud & Firebase**, cho phép chạy toàn bộ ứng dụng trên hạ tầng của Google với độ trễ thấp và tối ưu chi phí:

```
[Người dùng / Trình duyệt]
           │
           ▼
[Firebase Hosting: https://iot-farm-chilli.web.app]
     │                                  │
     │ (Trang web React UI)             │ (Đường dẫn /api/*)
     ▼                                  ▼
[Giao diện người dùng]        [Google Cloud Run: iot-farm-backend]
                                  (FastAPI Engine + AI Gemini)
                                        │
                                        ▼
                        [Firebase Realtime Database]
```

---

## Phần 1: Triển khai Frontend lên Firebase Hosting

Frontend đã được cấu hình sẵn trong `firebase.json` và `.firebaserc`.

### Bước 1: Đăng nhập Firebase CLI
Mở terminal tại thư mục gốc của dự án (`d:\Project\iot_farm`) và chạy:
```bash
npm run firebase:login
```
*(Trình duyệt sẽ mở ra để bạn đăng nhập tài khoản Google sở hữu dự án `iot-farm-chilli`)*

### Bước 2: Build và Deploy Frontend
Chạy lệnh sau:
```bash
npm run deploy:frontend
```
Sau khi hoàn tất, trang web của bạn sẽ hoạt động tại:
👉 **`https://iot-farm-chilli.web.app`** hoặc **`https://iot-farm-chilli.firebaseapp.com`**

---

## Phần 2: Triển khai Backend lên Google Cloud Run

Google Cloud Run là nền tảng container chính thức của Google Cloud (cùng chung dự án với Firebase).

### Cách 1: Triển khai qua Giao diện Web (Khuyên dùng - Không cần cài đặt gì)

1. Truy cập vào **[Google Cloud Run Console](https://console.cloud.google.com/run)** (Đảm bảo đã chọn dự án **`iot-farm-chilli`** ở thanh trên cùng).
2. Nhấn nút **Create Service** (Tạo dịch vụ).
3. Tại mục **Deployment platform**, chọn:
   - **Continuously deploy from a repository** (kết nối với GitHub).
   - Chọn kho lưu trữ: **`Truong-Hoang-Duy/iot_farm`**, nhánh **`main`**.
   - **Build Type**: Chọn **Dockerfile**.
   - **Source location**: Điền `/backend/Dockerfile`.
4. Thiết lập cấu hình dịch vụ:
   - **Service name**: `iot-farm-backend` *(phải đặt đúng tên này để khớp với cấu hình trong `firebase.json`)*.
   - **Region**: `asia-southeast1` (Singapore - chung vùng với Firebase Database của bạn).
   - **Authentication**: Chọn **Allow unauthenticated invocations** (Cho phép gọi API công khai).
   - **Autoscaling**: Tối thiểu `0` instance (để tiết kiệm chi phí, chỉ bật khi có request) hoặc `1` (nếu muốn phản hồi tức thì không có độ trễ khởi động).
5. Thêm biến môi trường (**Variables & Secrets**):
   - `GEMINI_API_KEY`: `<Khóa API Gemini của bạn>`
   - `GEMINI_MODEL`: `gemini-2.5-flash`
6. Nhấn **Create**. Google Cloud sẽ tự động đóng gói container từ Dockerfile và cấp link API cho bạn.

---

## Phần 3: Lợi ích của Cơ chế Rewrite trong `firebase.json`

File `firebase.json` đã được thiết lập quy tắc tự động chuyển hướng:
```json
{
  "source": "/api/**",
  "run": {
    "serviceId": "iot-farm-backend",
    "region": "asia-southeast1"
  }
}
```

* **Không cần cấu hình CORS:** Toàn bộ API `/api/*` được gọi trực tiếp trên cùng tên miền `https://iot-farm-chilli.web.app/api/...`.
* **Bảo mật & Tốc độ:** Được định tuyến qua hạ tầng mạng nội bộ của Google.
