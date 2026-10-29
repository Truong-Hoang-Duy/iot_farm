# HƯỚNG DẪN HOÀN THIỆN SLIDE VÀ SIÊU PROMPT DÀNH CHO CLAUDE (BẢN CẬP NHẬT CHUẨN XÁC)
> **Môn học:** Kỹ thuật Xử lý Dữ liệu IoT (Trường ĐH Công nghệ Thông tin, ĐHQG-HCM - UIT)  
> **Chủ đề:** Xây dựng pipeline phân tích, tiền xử lý dữ liệu trên dataset IoT-Agriculture thu thập từ cảm biến đất và tiến hành dự đoán / khuyến nghị thông minh  
> **File gốc:** `Kỹ thuật Xử lý dữ liệu.pptx` / `Kỹ thuật Xử lý dữ liệu.pdf`  
> **Thư mục tài nguyên:** `iot_farm/` và `report/images/`

---

## PHẦN 1: BẢNG QUY CHUẨN THIẾT KẾ (DESIGN SYSTEM)

1. **Typography (100% Font Cabin):**
   - Sử dụng **DUY NHẤT** font **`Cabin`** cho toàn bộ bài thuyết trình:
     - **Tiêu đề Slide (Header / Title):** Font **`Cabin`** (Bold, size 26–32pt).
     - **Nội dung thẻ & Thân slide (Body / Cards):** Font **`Cabin`** (Regular / Medium, size 13–16pt).
     - **Số liệu & Metrics nổi bật:** Font **`Cabin`** (Bold, size 36–48pt).
     - **Chú thích & Nguồn:** Font **`Cabin`** (Italic, size 10–12pt).
2. **Bảng màu chuẩn (Slidesgo Palette):**
   - Nền slide (Background): `#F8F8F8` (Off-white trang nhã)
   - Tiêu đề & Văn bản chính: `#000000` và `#1B4332` (Rêu rừng đậm)
   - Màu nhấn chủ đạo (Primary Accent): `#22816F` (Forest Teal)
   - Màu thẻ & Điểm nhấn phụ: `#7BBB91` (Mint) và `#C2DDC8` (Sage Light)
   - Màu đất / Nông nghiệp: `#693307` (Soil Brown)
   - Màu cảnh báo khẩn cấp: `#D9534F` (Red Danger)
3. **Phong cách trực quan & Tối ưu hiển thị:**
   - **Chữ cực kỳ ngắn gọn:** Ưu tiên bullet point 1 dòng, từ khóa in đậm, tránh đoạn văn dài.
   - Thẻ bo tròn góc (`Rounded Rectangle`, radius 12–16px), đổ bóng mờ nhẹ (`Soft Shadow`).
   - Mỗi slide đều đi kèm **Speaker Notes (Lời thoại thuyết trình chi tiết)** để diễn giả dễ dàng trình bày.
4. **Quy tắc quan trọng: KHÔNG in tên file mã nguồn lên mặt slide:**
   - Tuyệt đối không để lộ các tên file lập trình như `soil_all.json`, `sensor_processing_service.py`, đuôi `.py`, `.json`, `.csv` trên bề mặt slide trình chiếu.
   - Thay thế bằng các danh xưng học thuật chuyên nghiệp (ví dụ: *"Tập dữ liệu quan trắc ngoại tuyến"*, *"Module tiền xử lý dữ liệu Backend"*).
   - Tên file ảnh chỉ phục vụ code chèn hình ảnh, không in chữ tên file ảnh lên slide.
5. **Logo chính thức:**
   - Thay thế/chèn lại logo chính thức của trường **UIT** (`report/images/logo_uit.png`) ở góc trên bên phải của Slide 1 (Bìa) và Slide 24 (Cảm ơn). Tuyệt đối không chèn logo phụ.

---

## PHẦN 2: DANH MỤC 9 CHỈ SỐ CẢM BIẾN CHUẨN XÁC TRONG DỰ ÁN
*(Lưu ý kỹ thuật: Cột `light` đã được loại bỏ hoàn toàn khỏi hệ thống, toàn bộ pipeline chỉ quản lý đúng 9 chỉ số)*

| STT | Tên biến | Đơn vị | Nhóm chỉ số | Miền giá trị hợp lệ |
| :---: | :--- | :---: | :--- | :---: |
| 1 | `temperature` | $^\circ C$ | Môi trường không khí vi khí hậu | $[5.0, 48.0]$ |
| 2 | `humidity` | $\%RH$ | Độ ẩm tương đối không khí | $[5.0, 100.0]$ |
| 3 | `soiltemp` | $^\circ C$ | Nhiệt độ tầng đất ngập rễ | $[15.0, 40.0]$ |
| 4 | `moisture` | $\%VWC$ | Độ ẩm thể tích của đất | $[1.0, 70.0]$ |
| 5 | `pH` | pH | Độ chua/kiềm dung dịch đất | $[3.0, 9.5]$ |
| 6 | `EC` | $mS/cm$ | Độ dẫn điện (tổng ion hòa tan) | $[0.0, 4.0]$ |
| 7 | `N` | $mg/kg$ | Hàm lượng Đạm (Nitơ dễ tiêu) | $[0.0, 1500.0]$ |
| 8 | `P` | $mg/kg$ | Hàm lượng Lân (Photpho hữu dụng) | $[0.0, 2500.0]$ |
| 9 | `K` | $mg/kg$ | Hàm lượng Kali (Kali trao đổi) | $[0.0, 3000.0]$ |

---

## PHẦN 3: KỊCH BẢN CHI TIẾT TỪNG SLIDE (SLIDE CONTENT & SPEAKER NOTES)

---

### SLIDE 1: TRANG TIÊU ĐỀ (BÌA BÁO CÁO)
- **Tiêu đề chính:**  
  `XÂY DỰNG PIPELINE PHÂN TÍCH, XỬ LÝ DỮ LIỆU TRÊN DATASET IOT-AGRICULTURE THU THẬP TỪ CẢM BIẾN ĐẤT VÀ TIẾN HÀNH DỰ ĐOÁN`
- **Thông tin giảng viên:** `Giảng viên hướng dẫn: TS. Võ Phương Bình`
- **Nhóm học viên thực hiện:**
  - `26848009 - Nguyễn Đình Quốc Bảo`
  - `250201065 - Nguyễn Lâm Y Khang`
  - `250201067 - Trần Minh Khôi`
  - `26848055 - Trương Hoàng Duy`
- **Hình ảnh:** Chèn logo UIT mới (`report/images/logo_uit.png`) góc trên bên phải.
- **Speaker Notes:**  
  *"Kính chào Thầy và các bạn. Hôm nay nhóm chúng em xin đại diện báo cáo đề tài: Xây dựng pipeline phân tích, xử lý dữ liệu trên tập dữ liệu IoT-Agriculture thu thập từ cảm biến đất thực tế và ứng dụng mô hình khuyến nghị canh tác thông minh."*

---

### SLIDE 2: MỤC LỤC BÁO CÁO (AGENDA)
- **Tiêu đề:** `Nội dung báo cáo`
- **Bố cục 6 thẻ gọn:**
  1. `01. Tổng quan` — Bối cảnh, mục tiêu & thách thức dữ liệu IoT nông nghiệp.
  2. `02. Dataset & EDA` — Khảo sát dữ liệu Firebase và phân tích tương quan lý hóa.
  3. `03. Pre-processing` — Lọc nhiễu vật lý, bù khuyết và bảo vệ sự kiện bón phân.
  4. `04. Pipeline` — Phần cứng Jetson Nano, chuẩn RS485 Modbus & Firebase.
  5. `05. Demo` — Thực nghiệm cắm đất canh tác chuẩn vs cắm nước ngập úng.
  6. `06. Tổng kết` — Đóng góp, bài học thực tế và định hướng phát triển.
- **Speaker Notes:**  
  *"Bài báo cáo gồm 6 phần xuyên suốt từ khâu khảo sát dữ liệu thực địa, xây dựng thuật toán tiền xử lý, thiết kế hệ thống phần cứng, cho đến các kịch bản demo và tổng kết."*

---

### SLIDE 3: BÌA PHÂN MỤC 01 — TỔNG QUAN
- **Tiêu đề:** `01 — Tổng quan`
- **Phụ đề:** `Mục đích và phạm vi nghiên cứu nông nghiệp thông minh`
- **Màu nền:** `#22816F` (Forest Teal)

---

### SLIDE 4: ĐẶT VẤN ĐỀ & THÁCH THỨC THỰC TẾ
- **Tiêu đề:** `Đặt vấn đề & Thách thức thực tế`
- **Bố cục 3 cột thẻ nổi:**
  - **1. Bối cảnh nông nghiệp chính xác (`#C2DDC8`):**
    - Quan trắc tự động **9 chỉ số lý hóa đất và môi trường không khí** (5 phút/lần).
    - Canh tác công nghệ cao đòi hỏi kiểm soát chặt chẽ độ ẩm rễ và cân bằng dinh dưỡng NPK.
  - **2. Thách thức dữ liệu thực địa (`#F8F8F8` viền `#D9534F`):**
    - **Lỗi phần cứng & đứt gãy:** Mất kết nối, trôi tín hiệu điện cực khi đất khô hạn.
    - **Nhiễu loạn ngữ cảnh:** Bón phân làm tăng vọt ion $\rightarrow$ dễ bị xóa nhầm là ngoại lai!
  - **3. Mục tiêu giải pháp (`#22816F`, chữ trắng):**
    - Pipeline tự động làm sạch, bảo toàn bản chất nông học của dữ liệu.
    - Tích hợp Web Dashboard giám sát và Gemini AI tư vấn canh tác tức thời.
- **Speaker Notes:**  
  *"Trong thực tế ngoài đồng ruộng, cảm biến liên tục ghi nhận 9 chỉ số lý hóa đất và không khí. Tuy nhiên, dữ liệu thô gặp 3 thách thức lớn: đứt tín hiệu, cảm biến kẹt, và sự cố nhầm lẫn giữa sự kiện bón phân thật với nhiễu ngoại lai. Mục tiêu của nhóm là xây dựng một pipeline tự động hóa chuẩn xác để khắc phục triệt để các vấn đề này."*

---

### SLIDE 5: VIDEO TỔNG QUAN HỆ THỐNG
- **Tiêu đề:** `Video tổng quan hệ thống`
- **Thiết kế khung Video Placeholder 16:9:**
  - Khung chữ nhật 16:9 viền cong màu `#22816F`, nền xám tối sang trọng `#1A2521`.
  - Icon Play ▶ màu `#7BBB91` nổi bật ở chính giữa.
  - Nhãn trung tâm: **"Video tổng quan hệ thống (Thời lượng: ~1 phút)"**.
- **Cột tóm tắt nhanh (3 gạch đầu dòng):**
  - **Thực địa:** Cảm biến 7-in-1 cắm tại tầng rễ cây ớt và trạm thu thập vi khí hậu.
  - **Truyền dẫn:** Thu thập khung dữ liệu nhị phân chuẩn công nghiệp RS485 Modbus RTU.
  - **Giám sát:** Đồng bộ dữ liệu lên Firebase và trực quan hóa thời gian thực trên Web Dashboard.
- **Speaker Notes:**  
  *"Đây là khung trình chiếu video 1 phút giới thiệu tổng quan toàn bộ quá trình lắp đặt cảm biến tại luống ớt, kết nối với bộ gateway xử lý và hiển thị trực tiếp các chỉ số lên hệ thống web."*

---

### SLIDE 6: BÌA PHÂN MỤC 02 — DATASET & EDA
- **Tiêu đề:** `02 — Dataset & Khám phá Dữ liệu (EDA)`
- **Phụ đề:** `Khảo sát & Đánh giá Chất lượng Dữ liệu Cảm biến Đất`
- **Màu nền:** `#22816F`

---

### SLIDE 7: NGUỒN GỐC DỮ LIỆU & LƯU TRỮ QUAN TRẮC NGOẠI TUYẾN
- **Tiêu đề:** `Nguồn Dữ liệu Quan trắc Thực tế`
- **Bố cục 2 khối đối xứng:**
  - **Khối 1: Thu thập trực tiếp từ Firebase Realtime Database:**
    - Cảm biến ghi dữ liệu định kỳ 5 phút/lần theo thời gian thực.
    - Cấu trúc dữ liệu JSON 3 cấp phân tầng khoa học: `data[YYYY-MM-DD][HH:MM]`.
    - Dữ liệu nguyên bản gồm toàn bộ các mốc đo thực địa ngoài vườn.
  - **Khối 2: Trích xuất & Lưu trữ Dữ liệu Ngoại tuyến:**
    - Đồng bộ thành cơ sở dữ liệu quan trắc ngoại tuyến phục vụ nghiên cứu.
    - Chuỗi thời gian liên tục, làm nền tảng cho EDA, mô phỏng thuật toán và phát lại (Replay).
    - Phục vụ kiểm thử ngoại tuyến và huấn luyện mô hình dự báo không phụ thuộc kết nối mạng.
- **Speaker Notes:**  
  *"Toàn bộ dữ liệu của đề tài được lấy trực tiếp từ Firebase Realtime Database theo cấu trúc ngày và giờ, sau đó được trích xuất và lưu trữ thành tập dữ liệu ngoại tuyến chuẩn để phục vụ phân tích EDA chuyên sâu và kiểm thử thuật toán."*

---

### SLIDE 8: DANH MỤC 9 CHỈ SỐ CẢM BIẾN
- **Tiêu đề:** `Danh mục 9 Chỉ số Cảm biến Đất & Không khí`
- **Bố cục 2 thẻ lớn (loại bỏ hoàn toàn cột light):**
  - **1. Nhóm Môi trường Không khí (2 chỉ số vi khí hậu):**
    - `temperature` ($^\circ C$): Nhiệt độ không khí quanh tán cây $[5.0 - 48.0]$.
    - `humidity` ($\%RH$): Độ ẩm tương đối của không khí $[5.0 - 100.0]$.
  - **2. Nhóm Lý - Hóa & Dinh dưỡng Đất (7 chỉ số ngập rễ):**
    - `soiltemp` ($^\circ C$): Nhiệt độ đất $[15.0 - 40.0]$ | `moisture` ($\%VWC$): Độ ẩm thể tích đất $[1.0 - 70.0\%]$.
    - `pH`: Độ chua/kiềm đất $[3.0 - 9.5]$ | `EC` ($mS/cm$): Độ dẫn điện ion hòa tan $[0.0 - 4.0]$.
    - `N - P - K` ($mg/kg$): Đạm $[0 - 1500]$, Lân $[0 - 2500]$, Kali $[0 - 3000]$.
- **Speaker Notes:**  
  *"Hệ thống tập trung quan trắc chuẩn xác 9 thông số cốt lõi: 2 thông số khí hậu là nhiệt độ và độ ẩm không khí, cùng 7 thông số lý hóa đất gồm nhiệt độ đất, độ ẩm đất, pH, EC và bộ 3 dinh dưỡng N-P-K."*

---

### SLIDE 9: ĐÁNH GIÁ CHẤT LƯỢNG & TỶ LỆ KHUYẾT DỮ LIỆU
- **Tiêu đề:** `Đánh giá Tính Toàn vẹn & Tỷ lệ Khuyết Dữ liệu`
- **Ảnh chèn chính:** `report/images/01_monthly_observations_and_missing_rate.png` (bên trái).
- **Điểm nhấn phân tích (bên phải):**
  - **Tính toàn vẹn chuỗi thời gian:** Khớp chuẩn 100% trên lưới thời gian 5 phút.
  - **Tỷ lệ khuyết dữ liệu rất thấp:** Bình quân toàn chuỗi chỉ từ **$0.88\%$ đến $1.15\%$**.
  - **Nguyên nhân khuyết:** Tập trung vào đợt gián đoạn đường truyền trạm trung chuyển ngoài trời (ngày 26–28/12).
- **Speaker Notes:**  
  *"Qua đánh giá trên dữ liệu, lưới thời gian 5 phút đạt tính toàn vẹn rất cao. Tỷ lệ khuyết trung bình chỉ khoảng 1%, nguyên nhân chủ yếu đến từ sự cố đứt kết nối mạng ngoài đồng ruộng trong một số ngày cuối tháng 12."*

---

### SLIDE 10: PHÂN TÍCH ĐỘNG THÁI CHUỖI THỜI GIAN
- **Tiêu đề:** `Động thái Chuỗi Thời gian theo Nhóm Cảm biến`
- **Ảnh chèn chính:** Bố trí 2 biểu đồ:
  - `report/images/03_timeseries_air_environment.png` (Nhiệt - Ẩm khí)
  - `report/images/04_timeseries_soil_physical.png` (Nhiệt - Ẩm đất)
- **Quy luật rút ra:**
  - **Độ ẩm đất:** Biến thiên mượt, giữ quán tính ổn định; tăng dốc khi có sự kiện tưới nước.
  - **Nhiệt độ đất:** Biên độ dao động hẹp hơn nhiệt độ không khí tán lá nhờ tính đệm nhiệt của đất ẩm.
- **Speaker Notes:**  
  *"Quan sát biểu đồ chuỗi thời gian, độ ẩm đất có tính ổn định cao và chỉ tăng vọt khi hệ thống tưới hoạt động. Nhiệt độ tầng rễ cũng biến thiên êm dịu hơn nhiều so với nhiệt độ không khí bên ngoài nhờ khả năng đệm nhiệt tự nhiên của đất."*

---

### SLIDE 11: MA TRẬN TƯƠNG QUAN ĐA BIẾN
- **Tiêu đề:** `Ma trận Tương quan Đa biến & Quy luật Vật lý`
- **Ảnh chèn chính:** `report/images/14_correlation_matrix_heatmap.png` (chiếm 60% diện tích bên trái).
- **Phát hiện nông học nổi bật (bên phải):**
  - **Cộng hưởng NPK & EC ($r \ge 0.96$):** EC phản ánh trực tiếp nồng độ ion muối dinh dưỡng hòa tan từ phân bón.
  - **Nghịch biến mạnh giữa ẩm độ và pH ($r = -0.878$):** Đất ẩm hòa tan và pha loãng nồng độ ion làm biến thiên chỉ số pH.
  - **Tự tương quan cao:** Tự tương quan bậc 1 của độ ẩm đạt $0.9938$, khẳng định tính chuỗi thời gian rõ rệt.
- **Speaker Notes:**  
  *"Ma trận tương quan nhiệt làm sáng tỏ hai quy luật vật lý quan trọng: EC và bộ ba N-P-K có tương quan thuận gần như tuyệt đối trên 0.96, và độ ẩm đất tỷ lệ nghịch mạnh mẽ với pH ở mức âm 0.88."*

---

### SLIDE 12: PHÂN CỤM CHẾ ĐỘ CẢM BIẾN (K-MEANS REGIMES)
- **Tiêu đề:** `Phân cụm Trạng thái Hoạt động của Đất`
- **Ảnh chèn chính:** `report/images/12_kmeans_sensor_regimes_daily.png`.
- **4 Chế độ đất đặc trưng:**
  - **Regime 0:** Trạng thái bình thường, độ ẩm vừa, dinh dưỡng duy trì.
  - **Regime 1:** Sau đợt bón phân dinh dưỡng cao (EC & NPK tăng vọt).
  - **Regime 2:** Đất khô hạn nắng gắt (Độ ẩm $<27\%$, dinh dưỡng khó hấp thu).
  - **Regime 3:** Đất ẩm bão hòa sau khi tưới đẫm nước.
- **Speaker Notes:**  
  *"Bằng thuật toán K-Means, nhóm đã bóc tách được 4 chế độ vận hành điển hình của đất: trạng thái bình thường, giai đoạn sau bón phân, thời điểm khô hạn và trạng thái bão hòa sau tưới."*

---

### SLIDE 13: BÌA PHÂN MỤC 03 — TIỀN XỬ LÝ DỮ LIỆU
- **Tiêu đề:** `03 — Tiền xử lý Dữ liệu Chuỗi Thời gian`
- **Phụ đề:** `Phương pháp lọc nhiễu vật lý, bù khuyết và bảo toàn bản chất nông học`
- **Màu nền:** `#22816F`

---

### SLIDE 14: PHÁT HIỆN LỖI THEO ĐẶC TÍNH VẬT LÝ CẢM BIẾN
- **Tiêu đề:** `Quy tắc Phát hiện Lỗi Dựa trên Vật lý Cảm biến`
- **3 Chiến lược xử lý cốt lõi:**
  - **1. Hiện tượng Zero ở NPK & EC (`moisture < 12%`):**
    - Khi đất khô kiệt, cực kim loại mất môi trường dẫn điện ion $\rightarrow$ Cảm biến đọc về $0$.
    - *Quy tắc:* **Không xóa mù quáng các giá trị 0 này!** Chỉ coi là lỗi nếu độ ẩm $\ge 12\%$ mà NPK $= 0$.
  - **2. Bộ lọc Hampel thích ứng (Lọc Spike cục bộ):**
    - Cửa sổ trượt 9 bước (45 phút), ngưỡng $6 \times \text{MAD}$ động để loại bỏ xung nhiễu điện.
  - **3. Nhận diện cảm biến kẹt (Stuck Sensor):**
    - Gán cờ lỗi khi một chỉ số bị đứng yên không đổi liên tiếp $\ge 12$ bước đo (tối thiểu 60 phút).
- **Speaker Notes:**  
  *"Điểm đặc biệt trong khâu tiền xử lý là chúng em không lọc outlier một cách mù quáng. Khi đất quá khô dưới 12%, cảm biến NPK tự động về 0 do mất môi trường điện ly, đây là hiện tượng vật lý thật. Ngoài ra, thuật toán lọc Hampel và cơ chế nhận diện kẹt cảm biến giúp loại bỏ xung nhiễu rất hiệu quả."*

---

### SLIDE 15: CƠ CHẾ BẢO VỆ SỰ KIỆN NÔNG HỌC (AGRONOMIC CONSENSUS PROTECTION)
- **Tiêu đề:** `Cơ chế Bảo vệ Biến động Bón phân Thực tế`
- **Bài toán thực tiễn:** Khi bón phân hòa tan, EC và NPK cùng vọt cao. Các thuật toán thống kê thông thường (IQR, Z-score) sẽ xóa nhầm vì tưởng là ngoại lai!
- **Giải pháp đề xuất — Đồng thuận đa biến:**
  $$\text{Nếu } \ge 3/4 \text{ chỉ số trong } \{EC, N, P, K\} \text{ cùng tăng vọt } \longrightarrow \text{Sự kiện bón phân thật (Giữ nguyên)!}$$
- **Hiệu quả:** Bảo toàn 100% dữ liệu của các đợt bón phân quan trọng trong suốt chu kỳ nuôi cây.
- **Speaker Notes:**  
  *"Khi bón phân, nồng độ ion tăng vọt. Nếu dùng thuật toán lọc outlier cổ điển, các đỉnh phân bón này sẽ bị cắt gọt sai lệch. Nhóm đề xuất cơ chế bảo vệ đồng thuận: nếu cả EC và các chất N-P-K cùng tăng đồng thời thì xác nhận đó là sự kiện bón phân thật và giữ nguyên vẹn dữ liệu."*

---

### SLIDE 16: BENCHMARK BÙ KHUYẾT & TRIỂN KHAI BACKEND
- **Tiêu đề:** `Thực nghiệm Bù khuyết & Triển khai trong Backend`
- **Bảng so sánh kết quả thực nghiệm:**
  - **Forward Fill (ffill):** MAE Test = **`0.3429`** | Test $R^2$ = **`0.9394`** $\rightarrow$ **Tối ưu nhất nhờ giữ tính nhân quả của chuỗi thời gian**.
  - **KNN Imputation:** MAE Test = `0.3540` | Phù hợp khi phân tích ngoại tuyến.
  - **Median Imputation:** MAE Test = `0.3479` | Baseline cơ sở.
- **Triển khai thực tế tại Backend (Module Tiền Xử Lý Dữ Liệu):**
  - Tự động thực thi pipeline làm sạch: ffill bù khuyết theo tính nhân quả, Z-score/IQR capping tùy chọn, làm trơn rolling 1 giờ và chia nhóm 6 giai đoạn phát triển cây ớt.
- **Speaker Notes:**  
  *"Kết quả benchmark chứng minh phương pháp Forward-fill cho sai số MAE thấp nhất trên tập kiểm thử, chỉ 0.3429. Toàn bộ logic làm sạch và phân nhóm giai đoạn sinh trưởng này đã được lập trình đóng gói hoàn chỉnh trong module tiền xử lý dữ liệu của backend FastAPI."*

---

### SLIDE 17: BÌA PHÂN MỤC 04 — KIẾN TRÚC PIPELINE
- **Tiêu đề:** `04 — Kiến trúc Pipeline & Phần cứng`
- **Phụ đề:** `Từ cảm biến thực địa đến lưu trữ đám mây và khuyến nghị AI`
- **Màu nền:** `#22816F`

---

### SLIDE 18: BÀI HỌC SỰ CỐ PHẦN CỨNG & NÂNG CẤP JETSON NANO
- **Tiêu đề:** `Bài học Sự cố Thực tế & Nâng cấp Phần cứng`
- **Bố cục so sánh 2 giai đoạn:**
  - **Giai đoạn đầu — Thử nghiệm với ESP32 (`#F8F8F8` viền xám):**
    - Sử dụng vi điều khiển ESP32 và module chuyển đổi MAX485.
    - *Sự cố thực tế:* Khi gặp mưa lớn ngập úng ngoài trời, nước rò rỉ làm chập cháy bo mạch ESP32, gây gián đoạn toàn bộ hệ thống thu thập.
  - **Giai đoạn cải tiến — Nâng cấp lên Jetson Nano (`#C2DDC8` viền `#22816F`):**
    - Chuyển sang **NVIDIA Jetson Nano** làm Edge Gateway kiên cố trong hộp bảo vệ IP67 kháng nước.
    - Kết nối USB-to-RS485 công nghiệp cách ly chống xung điện sét.
    - Đọc trực tiếp khung truyền nhị phân **Modbus RTU** tin cậy cao từ đầu dò 7-in-1.
- **Speaker Notes:**  
  *"Một bài học thực tế rất đắt giá: ban đầu nhóm dùng mạch ESP32, nhưng khi gặp mưa ngập ngoài vườn, bo mạch đã bị chập cháy do ẩm ướt. Nhóm đã quyết định nâng cấp lên máy tính nhúng Jetson Nano đặt trong hộp IP67 chuẩn công nghiệp, đọc trực tiếp dữ liệu nhị phân Modbus RTU, đảm bảo hệ thống vận hành bền bỉ 24/7."*

---

### SLIDE 19: SƠ ĐỒ DÒNG DỮ LIỆU ĐẦU CUỐI (SYSTEM ARCHITECTURE)
- **Tiêu đề:** `Kiến trúc Hệ thống Đầu cuối (End-to-End Pipeline)`
- **Ảnh chèn chính:** `report/images/system_architecture.png` (chiếm 65% bên trái).
- **Luồng dữ liệu 4 tầng (bên phải):**
  1. **Tầng cảm biến:** Đầu dò 7-in-1 truyền tín hiệu nhị phân Modbus RTU về Jetson Nano.
  2. **Tầng Cloud:** Jetson Nano đồng bộ dữ liệu JSON thời gian thực lên Firebase Database.
  3. **Tầng Backend:** FastAPI tiền xử lý làm sạch, đánh giá ngưỡng nguy hiểm và gọi Gemini AI sinh phác đồ.
  4. **Tầng Ứng dụng:** Web Dashboard trực quan hóa biểu đồ và kích hoạt Relay bật/tắt bơm tưới.
- **Speaker Notes:**  
  *"Sơ đồ kiến trúc thể hiện trọn vẹn luồng dữ liệu 4 tầng: từ cảm biến truyền nhị phân qua Jetson Nano, đồng bộ lên Firebase, backend FastAPI làm sạch và gọi AI, đến giao diện Web Dashboard cho người nông dân giám sát."*

---

### SLIDE 20: BÌA PHÂN MỤC 05 — DEMO VẬN HÀNH
- **Tiêu đề:** `05 — Demo Kịch bản Vận hành Thực tế`
- **Phụ đề:** `Kiểm chứng phản hồi của Dashboard & Trợ lý Khuyến nghị Nông học AI`
- **Màu nền:** `#22816F`

---

### SLIDE 21: DEMO KỊCH BẢN 1: CẮM ĐẤT CANH TÁC TIÊU CHUẨN
- **Tiêu đề:** `Kịch bản 1: Môi trường Đất Canh tác Tiêu chuẩn`
- **Quy trình vận hành 4 bước:**
  - **1. Thao tác:** Cảm biến cắm ổn định tại tầng rễ cây ớt đang nuôi quả.
  - **2. Dữ liệu ghi nhận:** Độ ẩm đất $\approx 48\%$, pH $\approx 5.8$, EC $\approx 0.55\ mS/cm$, NPK cân đối.
  - **3. Dashboard phản hồi:** Trạng thái hệ thống hiển thị màu xanh an toàn (`Healthy`), biểu đồ xu hướng ổn định.
  - **4. Khuyến nghị AI (Gemini):**  
    `"Cây đang ở giai đoạn Ra hoa và đậu quả (ngày thứ 65). Ẩm độ và dinh dưỡng đạt chuẩn. Duy trì tưới nhỏ giọt 2 lần/ngày, bổ sung Kali nhẹ để tăng chất lượng quả."`
- **Speaker Notes:**  
  *"Ở kịch bản 1 khi cắm cảm biến vào đất trồng bình thường, các chỉ số đều trong ngưỡng tối ưu. Dashboard báo xanh an toàn và Gemini AI tự động đưa ra phác đồ tưới tiêu chuẩn cho giai đoạn đậu quả."*

---

### SLIDE 22: DEMO KỊCH BẢN 2: CẮM NƯỚC (MÔ PHỎNG MƯA BÃO / NGẬP ÚNG)
- **Tiêu đề:** `Kịch bản 2: Mô phỏng Mưa bão & Ngập úng Cực đoan`
- **Quy trình kích hoạt khẩn cấp 4 bước:**
  - **1. Thao tác:** Nhúng đầu dò trực tiếp vào nước ngập để mô phỏng bão lũ rễ cây ngâm nước.
  - **2. Dữ liệu vọt đỉnh:** Độ ẩm đất vọt kịch trần **`100%`**, EC loãng nhanh, nhiệt độ đất giảm đột ngột.
  - **3. Dashboard Báo động Đỏ:**  
    - Kích hoạt cảnh báo đỏ nguy cấp: **`CẢNH BÁO: Ngập úng rễ nghiêm trọng!`**.
    - Hệ thống tự động kích hoạt bảo vệ: **Ngắt ngay Relay bơm nước**.
  - **4. Khuyến nghị Khẩn cấp từ AI:**  
    `"NGUY CƠ THỐI RỄ CẤP TÍNH! Độ ẩm đạt 100%. Khẩn trương xẻ rãnh tiêu thoát nước, tạm ngừng mọi hoạt động bón phân và xử lý thuốc phòng nấm rễ sau khi nước rút."`
- **Speaker Notes:**  
  *"Ở kịch bản 2 khi cắm vào nước để mô phỏng ngập úng mùa mưa, độ ẩm nhảy vọt lên 100%. Ngay lập tức Dashboard báo động đỏ, tự động ngắt relay bơm tưới để ngăn ngập thêm và Gemini AI đưa ra các biện pháp khẩn cấp để chống thối rễ."*

---

### SLIDE 23: TỔNG KẾT & ĐỊNH HƯỚNG PHÁT TRIỂN
- **Tiêu đề:** `Tổng kết Đóng góp & Hướng Phát triển`
- **Bố cục 2 khối:**
  - **1. Đóng góp chính của Đề tài (`#22816F`):**
    - Hoàn thiện pipeline đầu cuối từ phần cứng thực địa đến Web Dashboard tương tác.
    - Xử lý triệt để bài toán nhiễu cảm biến nông nghiệp (độ ẩm $<12\%$ và cơ chế bảo vệ bón phân).
    - Thích nghi môi trường thành công từ sự cố thực tế (nâng cấp Gateway Jetson Nano IP67).
  - **2. Hướng phát triển tương lai (`#7BBB91`):**
    - Thử nghiệm mô hình học sâu chuỗi thời gian tiên tiến (**PatchTST / TimesNet**).
    - Triển khai mạng cảm biến không dây tầm xa diện rộng **LoRaWAN / Mesh**.
    - Tự động hóa hệ thống châm phân thông minh vòng kín (Closed-loop Smart Fertigation).
- **Speaker Notes:**  
  *"Tóm lại, đề tài đã xây dựng thành công pipeline đầu cuối hoàn chỉnh, giải quyết bài toán tiền xử lý dữ liệu và khắc phục sự cố phần cứng trong môi trường tự nhiên. Trong tương lai, nhóm hướng đến việc tích hợp mô hình PatchTST và mạng không dây LoRaWAN trên diện rộng."*

---

### SLIDE 24: LỜI CẢM ƠN & HỎI ĐÁP (Q&A)
- **Tiêu đề:** `Cảm ơn & Hỏi đáp (Q&A)`
- **Nội dung:**  
  - Chân thành cảm ơn sự hướng dẫn tận tình của **TS. Võ Phương Bình** cùng toàn thể Quý Thầy Cô và các bạn học viên.
  - Nhóm tác giả: Nguyễn Đình Quốc Bảo, Nguyễn Lâm Y Khang, Trần Minh Khôi, Trương Hoàng Duy (UIT).
  - Trân trọng kính mời Quý Thầy Cô và các bạn đặt câu hỏi trao đổi!
- **Hình ảnh:** Chèn logo UIT mới (`report/images/logo_uit.png`).
- **Speaker Notes:**  
  *"Em xin chân thành cảm ơn Thầy Võ Phương Bình và các bạn đã chú ý lắng nghe. Nhóm chúng em rất mong nhận được những câu hỏi và ý kiến đóng góp quý báu!"*

---

## PHẦN 4: SIÊU PROMPT (SUPER-PROMPT) MỚI DÀNH CHO CLAUDE WEB

> **HƯỚNG DẪN DÀNH CHO BẠN:**  
> Hãy sao chép toàn bộ khối lệnh dưới đây và dán thẳng vào ô chat của Claude trên Web để yêu cầu Claude cập nhật chính xác bài thuyết trình!

```markdown
Chào Claude, hãy giúp tôi cập nhật và hoàn thiện toàn bộ file thuyết trình "Kỹ thuật Xử lý dữ liệu.pptx" dựa trên các sửa đổi quan trọng sau đây:

A. QUY CHUẨN THIẾT KẾ & HÌNH THỨC:
1. TYPOGRAPHY: Bắt buộc sử dụng DUY NHẤT font "Cabin" cho 100% văn bản trong slide (tiêu đề dùng Cabin Bold, nội dung thẻ dùng Cabin Regular/Medium, số liệu dùng Cabin Bold).
2. MÃ MÀU GỐC: Nền slide #F8F8F8, chữ chính #000000 và #1B4332, màu nhấn chính #22816F (Forest Teal), màu thẻ #7BBB91 và #C2DDC8, màu đất #693307, màu cảnh báo đỏ #D9534F.
3. BỐ CỤC CHỮ: Cực kỳ ngắn gọn, dùng bullet point 1 dòng, từ khóa in đậm, khoảng cách thoáng đãng, tuyệt đối không để chữ dài dòng trên slide.
4. SPEAKER NOTES: TẤT CẢ các slide từ Slide 1 đến Slide 24 BẮT BUỘC phải ghi chú lời thoại thuyết trình (Speaker Notes) chi tiết để diễn giả đọc và thuyết trình.
5. TUYỆT ĐỐI KHÔNG HIỂN THỊ TÊN FILE MÃ NGUỒN TRÊN MẶT SLIDE:
   - Nghiêm cấm in các tên file kỹ thuật như "soil_all.json", "sensor_processing_service.py", ".py", ".json", ".csv" lên bề mặt slide.
   - Thay thế bằng các danh từ kỹ thuật học thuật trang trọng (ví dụ: "Tập dữ liệu quan trắc ngoại tuyến", "Module tiền xử lý dữ liệu Backend", v.v.).
   - Tên file ảnh (ví dụ 01_monthly_observations_and_missing_rate.png) CHỈ dùng trong code để chỉ định ảnh cần chèn, TUYỆT ĐỐI không in tên file ảnh dưới dạng chữ/caption lên mặt slide!
6. LOGO UIT: Chèn lại logo UIT mới từ file "report/images/logo_uit.png" ở góc trên bên phải Slide 1 (Bìa) và Slide 24 (Cảm ơn). Tuyệt đối không chèn logo phụ nào khác.
7. THÔNG TIN GIẢNG VIÊN: "Giảng viên hướng dẫn: TS. Võ Phương Bình".

B. NỘI DUNG ĐIỀU CHỈNH CHÍNH XÁC THEO MÃ NGUỒN IOT_FARM:
1. Slide 4: Sửa lại câu từ cho đúng: "Quan trắc 9 chỉ số lý hóa đất và môi trường không khí" (không dùng 10 chỉ số, không dùng vi khí hậu tán lá rườm rà).
2. Slide 5: Tạo khung Video Placeholder tỉ lệ 16:9 với icon Play ▶ và ghi nội dung chuẩn xác: "Video tổng quan hệ thống" (thời lượng ~1 phút), bên cạnh có 3 gạch đầu dòng ngắn về Thực địa, RS485 Modbus và Dashboard.
3. Slide 7: Tập trung nói về nguồn dữ liệu thu thập trực tiếp từ Firebase Realtime Database và được trích xuất lưu trữ thành "Tập dữ liệu quan trắc ngoại tuyến" (tuyệt đối không in tên file soil_all.json hay đuôi file .json, .csv lên mặt slide).
4. Slide 8: Chỉ trình bày đúng 9 chỉ số cảm biến (cột light đã bị xóa hoàn toàn khỏi hệ thống):
   - Môi trường không khí (2 chỉ số): temperature, humidity.
   - Đặc tính lý hóa & dinh dưỡng đất (7 chỉ số): soiltemp, moisture, pH, EC, N, P, K.
5. Slide 9 - 12 (EDA): Chèn đúng các ảnh tương ứng từ thư mục "report/images/":
   - Slide 9: Chèn 01_monthly_observations_and_missing_rate.png (Đánh giá tính toàn vẹn và khuyết dữ liệu).
   - Slide 10: Chèn 03_timeseries_air_environment.png và 04_timeseries_soil_physical.png (Động thái chuỗi thời gian).
   - Slide 11: Chèn 14_correlation_matrix_heatmap.png (Ma trận tương quan nhiệt, nhấn mạnh EC tương quan >0.96 với NPK, ẩm độ nghịch biến -0.88 với pH).
   - Slide 12: Chèn 12_kmeans_sensor_regimes_daily.png (Phân cụm 4 chế độ đất).
6. Slide 13 - 16 (Pre-processing):
   - Nguyên lý vật lý: Khi độ ẩm <12%, NPK/EC đọc về 0 là hiện tượng mất dẫn điện ion tự nhiên -> Không xóa mù quáng.
   - Bộ lọc Hampel thích ứng (cửa sổ 9 bước, k=6.0*MAD) lọc xung nhiễu spike.
   - Cơ chế bảo vệ bón phân (Consensus Protection): Khi EC và NPK cùng tăng vọt -> Giữ nguyên sự kiện bón phân thật.
   - Benchmark tiền xử lý: Forward-fill (ffill) đạt MAE test 0.3429 (tốt nhất).
   - Triển khai thực tế trong backend FastAPI: Module tiền xử lý dữ liệu Backend (tuyệt đối không in tên file sensor_processing_service.py lên slide).
7. Slide 17 - 19 (Pipeline):
   - Giới thiệu cảm biến 7-in-1 Modbus RTU.
   - Nêu sự cố thực tế: Ban đầu dùng ESP32 nhưng gặp mưa ngập ngoài trời bị chập hỏng bo mạch -> Nhóm đã nâng cấp lên NVIDIA Jetson Nano đặt trong hộp IP67 kiên cố.
   - Chèn ảnh system_architecture.png minh họa luồng 4 tầng: Modbus nhị phân -> Jetson Nano -> Firebase -> FastAPI -> Web Dashboard & Gemini AI.
8. Slide 20 - 22 (Demo 2 kịch bản):
   - Kịch bản 1 (Cắm đất bình thường): Ẩm độ 48%, pH 5.8, EC ổn định -> Dashboard Healthy -> Gemini AI tưới nhỏ giọt tiêu chuẩn.
   - Kịch bản 2 (Cắm vào nước mô phỏng mưa ngập úng): Ẩm độ vọt 100%, EC loãng -> Dashboard CẢNH BÁO ĐỎ khẩn cấp và tự ngắt relay bơm -> Gemini AI hướng dẫn thoát nước luống và chống thối rễ.
9. Slide 23 - 24 (Tổng kết & Q&A):
   - Đóng góp: hoàn thiện pipeline đầu cuối, giải quyết bài toán tiền xử lý, vượt qua sự cố ngập mưa thực tế.
   - Hướng tương lai: PatchTST Transformer, mạng LoRaWAN diện rộng.
   - Slide 24: Cảm ơn TS. Võ Phương Bình và hội đồng kèm logo UIT.

Hãy viết script Python (sử dụng python-pptx) hoặc cập nhật trực tiếp file "Kỹ thuật Xử lý dữ liệu.pptx" và xuất ra file hoàn chỉnh "Ky_thuat_Xu_ly_du_lieu_Final.pptx" có link tải về trực tiếp!
```
