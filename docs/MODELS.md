# Mô hình dự báo chuỗi thời gian – IoT Farm

> Tài liệu kỹ thuật cho phần ML (`backend/app/ml/`). Mọi con số trong mục **Kết quả** được sinh tự động
> từ `backend/artifacts/metrics.json` bằng `python -m app.ml.report` – không chỉnh tay.

## 1. Bài toán

Dự báo 9 chuỗi cảm biến của một luống rau: nhiệt độ & ẩm không khí (DHT20), nhiệt độ đất, độ ẩm đất,
pH, EC, N, P, K (cảm biến đất CWT 7-in-1). Biến `light` bị loại theo hợp đồng hệ thống.

| Nhóm | Độ phân giải | Horizon | Số bước tối đa H | Cửa sổ đầu vào | Biến ngoại sinh |
|---|---|---|---|---|---|
| Ngắn hạn (`short`) | 5 phút | 5′, 10′, 30′, 1h, 2h, 6h, 12h | 144 | 576 bước (2 ngày) | giờ trong ngày |
| Dài hạn (`long`) | 1 giờ (trung bình) | 1d, 2d, 3d, 4d, 5d | 120 | 336 bước (14 ngày) | thời tiết Open-Meteo + giờ |

Mọi mô hình là **dự báo trực tiếp đa bước** (một lần dự báo cho cả H bước), không đệ quy (trừ phần
"unroll" nội bộ của Chronos-Bolt khi H > 64).

## 2. Dữ liệu và tiền xử lý

Nguồn dữ liệu: Firebase Realtime Database kết hợp bộ dữ liệu quan trắc lịch sử `frontend/public/soil_all.json`.
Bộ dữ liệu hiện tại: 14/12/2025 → 31/08/2026, 261 ngày × 288 = 75 168 bản ghi 5 phút,
giờ địa phương Asia/Ho_Chi_Minh.

Các bước (file `app/ml/data.py`), theo thứ tự:

1. **Quy tắc hợp lệ từng điểm** (nhân quả):
   - Giá trị ngoài miền vật lý → NaN (không clip về biên để tránh tạo giá trị giả): nhiệt độ không khí 5–55 °C,
     ẩm 0–100 %, nhiệt độ đất 5–60 °C, ẩm đất 0–100 %, pH 0–14, EC 0–20 mS/cm, N/P/K 0–1999 mg/kg (dải đo CWT).
   - `temperature == 0` **và** `humidity == 0` cùng lúc → lỗi đọc DHT20 → NaN (744 bản ghi).
   - `EC == N == P == K == 0` cùng lúc → lỗi đọc Modbus → NaN (308 bản ghi).
2. **Resample về lưới 5 phút** (trung bình trong `[t, t+5′)`) – chịu được mọi chu kỳ lấy mẫu 5 s – 24 h của Jetson và key `HH:MM`/`HH:MM:SS`.
3. **Lọc ngoại lai Hampel** (Hampel 1974; Pearson 2002): cửa sổ trượt 7 điểm (±15′),
   điểm bị loại nếu $|x_t - \mathrm{med}_t| > 5 \cdot 1.4826 \cdot \max(\mathrm{MAD}_t, \text{sàn})$.
   Sàn MAD theo độ phân giải cảm biến (pH 0.05; EC 0.02; NPK 5; nhiệt 0.2; ẩm 0.5) để không loại nhầm khi chuỗi gần như hằng.
   Bước nhảy thật (ví dụ tưới làm độ ẩm tăng đột ngột) **không** bị loại vì median theo cửa sổ đi theo bước nhảy.
4. **Nội suy tuyến tính** chỉ cho khoảng trống ≤ 30 phút nằm giữa 2 điểm hợp lệ; khoảng trống dài hơn giữ NaN
   (khoảng trống dài nhất ≈ 3,3 ngày ở nhiệt độ không khí).
   - Mạng neural: giá trị thiếu được điền tạm để tính toán nhưng gắn `available_mask = 0` → **không tính vào loss** và không tham gia chuẩn hoá.
   - XGBoost: NaN được xử lý tự nhiên (hướng rẽ mặc định); hàng có mục tiêu NaN bị bỏ.
   - Chronos: NaN được mô hình mask nội bộ.
5. **Nhóm dài hạn**: trung bình theo giờ (nhãn = đầu giờ), cần ≥ 6/12 điểm hợp lệ.
6. **Thời tiết** (`app.services.weather_service`, ERA5 archive + forecast Open-Meteo, toạ độ 10.8433, 106.8389):
   căn về bucket `[HH, HH+1)` – biến tức thời lấy trung bình giá trị tại HH và HH+1; biến tích luỹ giờ trước
   (mưa, bức xạ, ET0) lấy giá trị nhãn HH+1.

**Chống rò rỉ khi đánh giá**: Hampel (cửa sổ tâm) và nội suy dùng điểm lân cận *sau* thời điểm t. Vì vậy trong đánh giá
rolling-origin, bước 3–5 được **chạy lại cho từng origin chỉ trên lịch sử trước origin** (`windows.make_contexts`), giống hệt
cách suy luận thực tế. Giá trị thực dùng để tính chỉ số chỉ gồm điểm **quan sát thật** (không nội suy, không bị loại ngoại lai).

## 3. Chia dữ liệu & đánh giá

- Chia **theo thời gian, không xáo trộn**, theo ngày nguyên: **Train 70 % → Validation 10 % → Test 20 %**.
- Validation chỉ dùng cho early-stopping (neural: `val_size`, XGBoost: `eval_set`). Test chỉ dùng **một lần** để báo cáo.
- Chuẩn hoá: mạng neural dùng *robust scaler theo từng cửa sổ* (median/IQR của riêng phần đầu vào, phần đầu ra bị mask) – không có thống kê nào
  học từ val/test; XGBoost dự báo $y_{T+h} - y_T$ nên không cần scaler; MASE dùng thang đo tính trên **train**.
- **Rolling-origin** (Tashman 2000; Bergmeir & Benítez 2012): mô hình huấn luyện một lần trên train, sau đó phát dự báo tại nhiều origin trượt dọc
  tập test – mỗi 6 giờ (nhóm ngắn) và mỗi 12 giờ (nhóm dài); đầu vào chỉ gồm dữ liệu trước origin.
  Cặp (origin, biến) có ngữ cảnh < 50 % dữ liệu hoặc không có điểm nào trong 12 bước cuối bị loại **cho mọi mô hình như nhau**.
- Sau khi có chỉ số, các mô hình **được huấn luyện lại trên toàn bộ dữ liệu** (số bước/số cây = giá trị chọn bởi early-stopping) để dự báo thực tế;
  chỉ số báo cáo vẫn là của tập test.

### Chỉ số

Với $e_i = y_i - \hat y_i$ trên tập điểm đánh giá ($n$ điểm, gộp mọi origin):

| Chỉ số | Công thức | Ghi chú |
|---|---|---|
| MAE | $\frac1n\sum \lvert e_i\rvert$ | đơn vị gốc |
| RMSE | $\sqrt{\frac1n\sum e_i^2}$ | phạt nặng sai số lớn |
| MAPE | $\frac{100}{n'}\sum \frac{\lvert e_i\rvert}{\lvert y_i\rvert}$ | bỏ điểm $\lvert y_i\rvert <$ 5 % trung vị $\lvert y\rvert$ của train |
| sMAPE | $\frac{100}{n}\sum \frac{2\lvert e_i\rvert}{\lvert y_i\rvert + \lvert \hat y_i\rvert}$ | |
| MASE | $\dfrac{\mathrm{MAE}}{\frac{1}{T-m}\sum_{t=m+1}^{T}\lvert y_t - y_{t-m}\rvert}$ | mẫu số = seasonal-naive trong mẫu trên **train**, $m$ = 288 (5′) / 24 (giờ) – Hyndman & Koehler (2006) |
| R² | $1 - \frac{\sum e_i^2}{\sum (y_i - \bar y)^2}$ | |
| Coverage 80 % | $\frac1n\sum \mathbb 1[q_{0.1,i} \le y_i \le q_{0.9,i}]$ | lý tưởng ≈ 0,80; chỉ mô hình xác suất |

Mỗi chỉ số được tính theo **mô hình × biến × horizon** với 2 kiểu: `cum` – gộp các bước 1..k (sai số trung bình khi dự báo tới horizon k) và
`point` – chỉ bước thứ k. **Mô hình "best"** cho mỗi (biến, horizon) = MASE (`cum`) thấp nhất trên test; API `model=best` dùng bảng này.

Lưu ý diễn giải MASE: mẫu số là sai số seasonal-naive **1 ngày** trong mẫu. Với horizon rất ngắn (5–30 phút) MASE ≪ 1 là đương nhiên
vì dữ liệu 5 phút rất trơn; vì vậy cần so với cả baseline **Naive** (giá trị cuối) – baseline mạnh nhất ở horizon ngắn.

## 4. Các mô hình

### 4.1 XGBoost – Gradient Boosting (Chen & Guestrin, 2016)

XGBoost cộng dồn $K$ cây hồi quy $\hat y = \sum_{k=1}^K f_k(\mathbf x)$, mỗi cây khớp gradient/hessian bậc hai của hàm mất mát
với điều chuẩn $\Omega(f) = \gamma T + \frac12\lambda\lVert w\rVert^2$; thuật toán tìm điểm chia xấp xỉ theo histogram và xử lý giá trị thiếu
bằng hướng rẽ mặc định học được. Họ GBDT thống trị cuộc thi M5 (Makridakis et al., 2022).

Cài đặt: chiến lược **direct multi-horizon "horizon-as-feature"** (Taieb et al., 2012) – một mô hình cho mỗi biến × nhóm, mỗi hàng là
(origin, h). Đặc trưng: giá trị cuối, các độ trễ (so với giá trị cuối), trung bình/độ lệch chuẩn trượt, giá trị **cùng giờ ngày trước/2 ngày trước
(căn theo thời điểm mục tiêu)** và trung bình 7 ngày (nhóm dài), giá trị hiện tại + thay đổi của 8 biến còn lại, sin/cos giờ của thời điểm mục tiêu
và origin, h; nhóm dài thêm thời tiết tại thời điểm mục tiêu, lượng mưa/ET0/bức xạ tích luỹ từ origin tới mục tiêu và 24 h trước.
Mục tiêu: $y_{T+h} - y_T$. Hàm mất mát **hồi quy phân vị** (`reg:quantileerror`, q = 0,1/0,5/0,9) → dự báo điểm = trung vị, khoảng 80 % = [q10, q90].
Early-stopping 100 vòng trên validation; GPU `device="cuda"`.
Kiểm tra rò rỉ tự động: thay toàn bộ giá trị sau origin bằng nhiễu → đặc trưng phải không đổi (`metrics.json → sanity`).

### 4.2 LSTM (Hochreiter & Schmidhuber, 1997)

Ô nhớ với cổng quên/nhập/xuất:
$f_t=\sigma(W_f[h_{t-1},x_t]+b_f)$, $i_t=\sigma(W_i[\cdot]+b_i)$, $\tilde c_t=\tanh(W_c[\cdot]+b_c)$,
$c_t=f_t\odot c_{t-1}+i_t\odot\tilde c_t$, $o_t=\sigma(W_o[\cdot]+b_o)$, $h_t=o_t\odot\tanh(c_t)$ –
dòng trạng thái $c_t$ cộng tuyến tính giúp gradient không biến mất qua chuỗi dài.
Cài đặt (`app/ml/lstm_direct.py`, PyTorch thuần): LSTM 2 lớp × 128 mã hoá toàn bộ cửa sổ đầu vào (giá trị đã chuẩn hoá robust theo cửa sổ,
mask điểm thiếu, sin/cos giờ, thời tiết cho nhóm dài) → **hidden state cuối** $h_L$ ghép với mã hoá MLP của biến ngoại sinh tương lai và giá trị cuối
→ MLP xuất trực tiếp $H \times 3$ phân vị; loss pinball; early-stopping khôi phục trọng số tốt nhất trên validation.

> Vì sao không dùng `neuralforecast.LSTM`? Ở chế độ non-recurrent (mặc định của neuralforecast 3.x), bước dự báo thứ k được giải mã từ hidden state
> tại vị trí $L-H+k$ của cửa sổ, nên bước 1 **không thấy** $H-1$ quan sát gần nhất (12 giờ với nhóm ngắn). Lần chạy đầu cho thấy hệ quả:
> MASE@5′ ≈ 0,76 so với Naive 0,12. Kiến trúc seq2vec ở trên là cách dùng LSTM kinh điển cho dự báo trực tiếp nhiều bước.

### 4.3 N-HiTS (Challu et al., 2023)

Mở rộng N-BEATS: xếp chồng các khối MLP, mỗi khối (i) **max-pooling đa tốc độ** đầu vào để chỉ nhìn một dải tần,
(ii) dự đoán một số ít "knot" rồi **nội suy phân cấp** lên H bước (khối đầu tần số thấp – xu hướng, khối sau tần số cao),
(iii) trừ backcast khỏi đầu vào cho khối sau (dư lượng kép). Nhanh hơn Transformer hàng chục lần cho dự báo dài.
Cài đặt (`neuralforecast.NHITS`): 3 stack, pooling [16, 8, 1] (ngắn) / [8, 4, 1] (dài), downsample [24, 12, 1], MLP 512×2, MQLoss (khoảng 80 %),
biến ngoại sinh tương lai (giờ; thời tiết cho nhóm dài), cửa sổ huấn luyện trượt 30′ ở nhóm ngắn.

### 4.4 PatchTST (Nie et al., 2023)

Chia chuỗi đầu vào thành **patch** (độ dài 24, bước 12) làm token cho Transformer encoder → giảm độ dài chuỗi attention $O((L/S)^2)$
và giữ ngữ nghĩa cục bộ; **channel-independence**: mỗi biến là một chuỗi đơn biến dùng chung trọng số; chuẩn hoá theo từng cửa sổ
(như RevIN của bài báo gốc – bật `revin=True`, trừ giá trị cuối). Cài đặt (`neuralforecast.PatchTST`): 3 lớp encoder, 8 head, d=128, dropout 0,2, MQLoss (khoảng 80 %).

### 4.5 Chronos-Bolt (Ansari et al., 2024)

Mô hình nền tảng (foundation model) T5 encoder–decoder huấn luyện trước trên ~100 tỷ quan sát chuỗi thời gian thật + tổng hợp.
Chronos gốc chuẩn hoá theo trung bình tuyệt đối rồi lượng tử hoá giá trị thành token; biến thể **Bolt** chia chuỗi thành patch,
decoder xuất trực tiếp 9 phân vị cho 64 bước (nhanh hơn ~250×). Dùng **zero-shot** (không tinh chỉnh) với tối đa 2048 bước ngữ cảnh;
H > 64 được "unroll" theo phân vị. Đây là mô hình duy nhất không học từ dữ liệu của luống rau.

### 4.6 Baseline

- **Naive**: $\hat y_{T+k} = y_T$.
- **Seasonal Naive** (chu kỳ 1 ngày): $\hat y_{T+k} = y_{T+k-m\lceil k/m\rceil}$.

Mô hình học máy chỉ có giá trị khi thắng được cả hai baseline.

## 5. GPU

`torch.cuda.is_available()` → LSTM / N-HiTS / PatchTST huấn luyện bằng PyTorch Lightning trên `cuda`, XGBoost `device="cuda"`,
Chronos suy luận trên `cuda`; không có GPU thì tự chuyển CPU. Tên GPU, phiên bản CUDA, bộ nhớ tối đa và mẫu `nvidia-smi`
(mức sử dụng theo từng giai đoạn) được ghi vào `metrics.json → device`.

## 6. Kết quả (tập test, rolling-origin)

<!-- RESULTS:BEGIN -->
*Sinh tự động lúc 2026-10-29T13:45:32+07:00 từ `backend/artifacts/metrics.json`.*

| Mục | Giá trị |
|---|---|
| Nguồn dữ liệu | json (2025-12-14T00:00:00+07:00 → 2026-08-31T23:55:00+07:00, 75168 bản ghi thô, 75168 điểm lưới 5') |
| Train | 2025-12-14 → 2026-06-14 |
| Validation | 2026-06-14 → 2026-07-10 |
| Test | 2026-07-10 → 2026-08-31T23:55 |
| Nhóm short | 211 origin (mỗi 360′), điểm train/val/test = 52416/7488/15264, thời tiết: không |
| Nhóm long | 97 origin (mỗi 720′), điểm train/val/test = 4368/624/1272, thời tiết: có |
| Thiết bị | cuda – NVIDIA GeForce RTX 3070 Laptop GPU (torch 2.14.1+cu130, CUDA 13.0) |
| nvidia-smi | max util 100.0 %, max VRAM 7989.0 MB, 681 mẫu |
| Tổng thời gian | 1411.4 s |
| Thời tiết | app.services.weather_service (Open-Meteo ERA5 archive + forecast) |

**Thời gian huấn luyện (giây, fit trên train / refit toàn bộ)**

| Mô hình | short | long |
|---|---|---|
| XGBoost | 171.8 / 180.2 (cuda) | 101.0 / 85.4 (cuda) |
| LSTM | 226.7 / 168.6 (cuda) | 96.7 / 40.7 (cuda) |
| N-HiTS | 58.9 / 37.9 (cuda) | 19.3 / 3.6 (cuda) |
| PatchTST | 49.1 / 25.7 (cuda) | 24.0 / 10.6 (cuda) |
| Chronos-Bolt (small) | 0.0 / – (cuda) | 0.0 / – (cuda) |
| Seasonal Naive (1 ngày) | 0.0 / – () | 0.0 / – () |
| Naive | 0.0 / – () | 0.0 / – () |

### Nhóm short – MASE (kiểu cum: gộp bước 1..k) trung bình 9 biến

| Mô hình | 5m | 10m | 30m | 1h | 2h | 6h | 12h |
|---|---|---|---|---|---|---|---|
| XGBoost | 0.106 | 0.113 | 0.138 | 0.172 | 0.214 | 0.302 | 0.419 |
| LSTM | 0.157 | 0.160 | 0.183 | 0.221 | 0.284 | 0.493 | 0.702 |
| N-HiTS | 0.138 | 0.141 | 0.159 | 0.195 | 0.240 | 0.339 | 0.458 |
| PatchTST | 0.143 | 0.155 | 0.169 | 0.200 | 0.250 | 0.364 | 0.507 |
| Chronos-Bolt (small) | 0.113 | 0.121 | 0.150 | 0.188 | 0.236 | 0.337 | 0.462 |
| Seasonal Naive (1 ngày) | 0.925 | 0.928 | 0.925 | 0.928 | 0.936 | 0.938 | 0.941 |
| Naive | 0.120 | 0.131 | 0.171 | 0.225 | 0.309 | 0.595 | 0.931 |

### Nhóm short – mô hình tốt nhất theo (biến, horizon) (MASE cum thấp nhất; trong ngoặc: MASE / MAE)

| Biến | 5m | 10m | 30m | 1h | 2h | 6h | 12h |
|---|---|---|---|---|---|---|---|
| temperature | **Naive** (0.11 / 0.121) | **Naive** (0.14 / 0.157) | **XGBoost** (0.23 / 0.254) | **XGBoost** (0.33 / 0.376) | **XGBoost** (0.46 / 0.516) | **Chronos-Bolt** (0.64 / 0.725) | **Chronos-Bolt** (0.76 / 0.858) |
| humidity | **Naive** (0.07 / 0.397) | **XGBoost** (0.08 / 0.466) | **XGBoost** (0.16 / 0.929) | **XGBoost** (0.30 / 1.724) | **XGBoost** (0.46 / 2.684) | **XGBoost** (0.70 / 4.050) | **XGBoost** (0.87 / 5.058) |
| soiltemp | **XGBoost** (0.16 / 0.080) | **XGBoost** (0.17 / 0.087) | **XGBoost** (0.20 / 0.104) | **XGBoost** (0.23 / 0.117) | **XGBoost** (0.26 / 0.132) | **XGBoost** (0.36 / 0.187) | **XGBoost** (0.53 / 0.274) |
| moisture | **XGBoost** (0.08 / 0.245) | **XGBoost** (0.09 / 0.270) | **XGBoost** (0.11 / 0.318) | **XGBoost** (0.12 / 0.366) | **XGBoost** (0.15 / 0.439) | **XGBoost** (0.24 / 0.722) | **XGBoost** (0.35 / 1.035) |
| pH | **XGBoost** (0.12 / 0.014) | **XGBoost** (0.13 / 0.015) | **XGBoost** (0.15 / 0.017) | **XGBoost** (0.16 / 0.019) | **XGBoost** (0.18 / 0.021) | **XGBoost** (0.25 / 0.029) | **XGBoost** (0.34 / 0.039) |
| EC | **XGBoost** (0.08 / 0.011) | **XGBoost** (0.07 / 0.011) | **XGBoost** (0.07 / 0.011) | **XGBoost** (0.08 / 0.011) | **XGBoost** (0.08 / 0.012) | **XGBoost** (0.10 / 0.016) | **XGBoost** (0.21 / 0.031) |
| N | **XGBoost** (0.13 / 5.024) | **XGBoost** (0.14 / 5.202) | **XGBoost** (0.14 / 5.213) | **XGBoost** (0.14 / 5.343) | **XGBoost** (0.14 / 5.438) | **XGBoost** (0.16 / 6.002) | **XGBoost** (0.24 / 9.053) |
| P | **XGBoost** (0.09 / 9.742) | **XGBoost** (0.09 / 9.820) | **XGBoost** (0.09 / 9.916) | **XGBoost** (0.09 / 10.114) | **XGBoost** (0.10 / 10.432) | **XGBoost** (0.12 / 13.007) | **XGBoost** (0.22 / 23.410) |
| K | **Chronos-Bolt** (0.10 / 11.658) | **Chronos-Bolt** (0.09 / 11.338) | **XGBoost** (0.10 / 11.844) | **XGBoost** (0.10 / 12.188) | **XGBoost** (0.10 / 12.534) | **XGBoost** (0.13 / 15.424) | **XGBoost** (0.23 / 27.844) |

### Nhóm short – chi tiết tại horizon 1h (cum)

| Biến | Mô hình | MAE | RMSE | sMAPE % | MASE | R² | Cov80 |
|---|---|---|---|---|---|---|---|
| temperature | XGBoost | 0.376 | 0.585 | 1.30 | 0.333 | 0.958 | 0.79 |
| temperature | LSTM | 0.494 | 0.703 | 1.72 | 0.437 | 0.939 | 0.90 |
| temperature | N-HiTS | 0.416 | 0.620 | 1.46 | 0.369 | 0.952 | 0.70 |
| temperature | PatchTST | 0.437 | 0.637 | 1.52 | 0.387 | 0.950 | 0.80 |
| temperature | Chronos-Bolt (small) | 0.395 | 0.608 | 1.38 | 0.350 | 0.954 | 0.72 |
| temperature | Seasonal Naive (1 ngày) | 1.029 | 1.464 | 3.51 | 0.912 | 0.735 | – |
| temperature | Naive | 0.514 | 0.742 | 1.81 | 0.455 | 0.932 | – |
| humidity | XGBoost | 1.724 | 2.828 | 2.29 | 0.297 | 0.957 | 0.80 |
| humidity | LSTM | 2.486 | 3.688 | 3.38 | 0.428 | 0.927 | 0.86 |
| humidity | N-HiTS | 1.813 | 2.870 | 2.37 | 0.312 | 0.956 | 0.72 |
| humidity | PatchTST | 2.079 | 3.088 | 2.75 | 0.358 | 0.949 | 0.84 |
| humidity | Chronos-Bolt (small) | 1.964 | 3.211 | 2.60 | 0.338 | 0.945 | 0.72 |
| humidity | Seasonal Naive (1 ngày) | 6.209 | 8.650 | 8.24 | 1.068 | 0.598 | – |
| humidity | Naive | 2.251 | 3.371 | 2.93 | 0.387 | 0.939 | – |
| soiltemp | XGBoost | 0.117 | 0.147 | 0.43 | 0.227 | 0.979 | 0.81 |
| soiltemp | LSTM | 0.142 | 0.182 | 0.53 | 0.277 | 0.968 | 0.81 |
| soiltemp | N-HiTS | 0.137 | 0.173 | 0.50 | 0.266 | 0.971 | 0.71 |
| soiltemp | PatchTST | 0.127 | 0.162 | 0.47 | 0.247 | 0.975 | 0.74 |
| soiltemp | Chronos-Bolt (small) | 0.123 | 0.158 | 0.45 | 0.240 | 0.976 | 0.78 |
| soiltemp | Seasonal Naive (1 ngày) | 0.648 | 0.803 | 2.39 | 1.260 | 0.378 | – |
| soiltemp | Naive | 0.151 | 0.193 | 0.56 | 0.293 | 0.964 | – |
| moisture | XGBoost | 0.366 | 0.577 | 0.69 | 0.123 | 0.960 | 0.77 |
| moisture | LSTM | 0.472 | 0.701 | 0.89 | 0.158 | 0.941 | 0.75 |
| moisture | N-HiTS | 0.427 | 0.655 | 0.81 | 0.143 | 0.948 | 0.72 |
| moisture | PatchTST | 0.421 | 0.649 | 0.80 | 0.141 | 0.949 | 0.78 |
| moisture | Chronos-Bolt (small) | 0.418 | 0.667 | 0.79 | 0.140 | 0.946 | 0.81 |
| moisture | Seasonal Naive (1 ngày) | 2.086 | 2.874 | 3.98 | 0.699 | 0.002 | – |
| moisture | Naive | 0.436 | 0.649 | 0.82 | 0.146 | 0.949 | – |
| pH | XGBoost | 0.019 | 0.025 | 0.35 | 0.162 | 0.935 | 0.86 |
| pH | LSTM | 0.022 | 0.029 | 0.41 | 0.189 | 0.914 | 0.61 |
| pH | N-HiTS | 0.022 | 0.029 | 0.42 | 0.194 | 0.910 | 0.70 |
| pH | PatchTST | 0.020 | 0.027 | 0.38 | 0.177 | 0.923 | 0.72 |
| pH | Chronos-Bolt (small) | 0.021 | 0.027 | 0.38 | 0.178 | 0.922 | 0.80 |
| pH | Seasonal Naive (1 ngày) | 0.074 | 0.099 | 1.38 | 0.642 | -0.022 | – |
| pH | Naive | 0.023 | 0.031 | 0.43 | 0.202 | 0.903 | – |
| EC | XGBoost | 0.011 | 0.015 | 3.26 | 0.075 | 0.993 | 0.80 |
| EC | LSTM | 0.015 | 0.020 | 3.89 | 0.097 | 0.988 | 0.86 |
| EC | N-HiTS | 0.014 | 0.017 | 3.86 | 0.090 | 0.990 | 0.81 |
| EC | PatchTST | 0.014 | 0.018 | 4.13 | 0.094 | 0.989 | 0.76 |
| EC | Chronos-Bolt (small) | 0.013 | 0.018 | 3.65 | 0.087 | 0.990 | 0.76 |
| EC | Seasonal Naive (1 ngày) | 0.143 | 0.197 | 35.64 | 0.952 | -0.253 | – |
| EC | Naive | 0.015 | 0.020 | 4.19 | 0.101 | 0.987 | – |
| N | XGBoost | 5.343 | 6.849 | 29.77 | 0.141 | 0.977 | 0.78 |
| N | LSTM | 6.314 | 8.208 | 30.31 | 0.166 | 0.967 | 0.68 |
| N | N-HiTS | 6.166 | 7.889 | 33.11 | 0.162 | 0.970 | 0.74 |
| N | PatchTST | 6.486 | 8.434 | 33.20 | 0.171 | 0.965 | 0.71 |
| N | Chronos-Bolt (small) | 5.583 | 7.267 | 32.11 | 0.147 | 0.974 | 0.76 |
| N | Seasonal Naive (1 ngày) | 33.844 | 46.952 | 74.86 | 0.890 | -0.078 | – |
| N | Naive | 7.003 | 8.990 | 32.36 | 0.184 | 0.960 | – |
| P | XGBoost | 10.114 | 13.130 | 5.82 | 0.095 | 0.989 | 0.79 |
| P | LSTM | 12.655 | 16.860 | 6.44 | 0.118 | 0.982 | 0.81 |
| P | N-HiTS | 11.533 | 14.747 | 6.38 | 0.108 | 0.986 | 0.80 |
| P | PatchTST | 11.817 | 15.350 | 6.71 | 0.111 | 0.985 | 0.76 |
| P | Chronos-Bolt (small) | 10.914 | 14.328 | 6.05 | 0.102 | 0.987 | 0.75 |
| P | Seasonal Naive (1 ngày) | 101.686 | 140.255 | 44.85 | 0.951 | -0.245 | – |
| P | Naive | 13.874 | 17.503 | 7.59 | 0.130 | 0.981 | – |
| K | XGBoost | 12.188 | 15.950 | 5.93 | 0.100 | 0.988 | 0.77 |
| K | LSTM | 14.238 | 18.760 | 6.28 | 0.117 | 0.983 | 0.82 |
| K | N-HiTS | 13.236 | 16.950 | 6.35 | 0.109 | 0.986 | 0.80 |
| K | PatchTST | 13.371 | 17.166 | 6.73 | 0.110 | 0.986 | 0.74 |
| K | Chronos-Bolt (small) | 12.994 | 17.923 | 6.06 | 0.107 | 0.984 | 0.75 |
| K | Seasonal Naive (1 ngày) | 119.207 | 165.361 | 44.10 | 0.979 | -0.330 | – |
| K | Naive | 15.296 | 19.562 | 7.41 | 0.126 | 0.981 | – |

### Nhóm short – chi tiết tại horizon 12h (cum)

| Biến | Mô hình | MAE | RMSE | sMAPE % | MASE | R² | Cov80 |
|---|---|---|---|---|---|---|---|
| temperature | XGBoost | 0.886 | 1.297 | 2.99 | 0.785 | 0.775 | 0.74 |
| temperature | LSTM | 1.636 | 2.311 | 5.59 | 1.450 | 0.285 | 0.83 |
| temperature | N-HiTS | 0.900 | 1.272 | 3.06 | 0.798 | 0.784 | 0.64 |
| temperature | PatchTST | 1.066 | 1.449 | 3.65 | 0.945 | 0.719 | 0.77 |
| temperature | Chronos-Bolt (small) | 0.858 | 1.226 | 2.92 | 0.760 | 0.799 | 0.68 |
| temperature | Seasonal Naive (1 ngày) | 1.102 | 1.542 | 3.74 | 0.976 | 0.682 | – |
| temperature | Naive | 3.087 | 3.971 | 10.56 | 2.735 | -1.109 | – |
| humidity | XGBoost | 5.058 | 7.373 | 6.82 | 0.870 | 0.696 | 0.72 |
| humidity | LSTM | 9.436 | 12.645 | 12.26 | 1.623 | 0.107 | 0.74 |
| humidity | N-HiTS | 5.316 | 7.623 | 7.07 | 0.915 | 0.675 | 0.64 |
| humidity | PatchTST | 5.948 | 8.148 | 7.87 | 1.023 | 0.629 | 0.71 |
| humidity | Chronos-Bolt (small) | 5.733 | 7.969 | 7.60 | 0.986 | 0.645 | 0.64 |
| humidity | Seasonal Naive (1 ngày) | 6.611 | 9.193 | 8.83 | 1.137 | 0.528 | – |
| humidity | Naive | 13.483 | 17.723 | 17.51 | 2.319 | -0.755 | – |
| soiltemp | XGBoost | 0.274 | 0.380 | 1.01 | 0.533 | 0.860 | 0.72 |
| soiltemp | LSTM | 0.610 | 0.809 | 2.25 | 1.186 | 0.365 | 0.68 |
| soiltemp | N-HiTS | 0.343 | 0.468 | 1.26 | 0.668 | 0.787 | 0.63 |
| soiltemp | PatchTST | 0.357 | 0.491 | 1.32 | 0.695 | 0.766 | 0.68 |
| soiltemp | Chronos-Bolt (small) | 0.319 | 0.441 | 1.17 | 0.621 | 0.811 | 0.65 |
| soiltemp | Seasonal Naive (1 ngày) | 0.634 | 0.785 | 2.34 | 1.233 | 0.402 | – |
| soiltemp | Naive | 0.675 | 0.875 | 2.48 | 1.312 | 0.258 | – |
| moisture | XGBoost | 1.035 | 1.615 | 1.97 | 0.347 | 0.705 | 0.68 |
| moisture | LSTM | 1.455 | 2.053 | 2.77 | 0.488 | 0.524 | 0.71 |
| moisture | N-HiTS | 1.221 | 1.814 | 2.32 | 0.409 | 0.628 | 0.63 |
| moisture | PatchTST | 1.200 | 1.829 | 2.29 | 0.402 | 0.622 | 0.66 |
| moisture | Chronos-Bolt (small) | 1.317 | 1.991 | 2.51 | 0.441 | 0.552 | 0.68 |
| moisture | Seasonal Naive (1 ngày) | 2.176 | 2.995 | 4.16 | 0.729 | -0.014 | – |
| moisture | Naive | 1.407 | 1.955 | 2.68 | 0.472 | 0.568 | – |
| pH | XGBoost | 0.039 | 0.056 | 0.74 | 0.342 | 0.679 | 0.75 |
| pH | LSTM | 0.054 | 0.074 | 1.01 | 0.469 | 0.449 | 0.66 |
| pH | N-HiTS | 0.045 | 0.063 | 0.85 | 0.395 | 0.591 | 0.64 |
| pH | PatchTST | 0.044 | 0.062 | 0.82 | 0.381 | 0.614 | 0.71 |
| pH | Chronos-Bolt (small) | 0.044 | 0.062 | 0.83 | 0.385 | 0.604 | 0.73 |
| pH | Seasonal Naive (1 ngày) | 0.075 | 0.100 | 1.40 | 0.653 | -0.027 | – |
| pH | Naive | 0.048 | 0.065 | 0.91 | 0.421 | 0.565 | – |
| EC | XGBoost | 0.031 | 0.078 | 8.41 | 0.207 | 0.796 | 0.73 |
| EC | LSTM | 0.039 | 0.087 | 10.45 | 0.259 | 0.750 | 0.86 |
| EC | N-HiTS | 0.032 | 0.084 | 9.07 | 0.214 | 0.767 | 0.76 |
| EC | PatchTST | 0.038 | 0.087 | 10.50 | 0.252 | 0.751 | 0.78 |
| EC | Chronos-Bolt (small) | 0.033 | 0.086 | 8.79 | 0.223 | 0.756 | 0.68 |
| EC | Seasonal Naive (1 ngày) | 0.141 | 0.195 | 35.37 | 0.939 | -0.258 | – |
| EC | Naive | 0.039 | 0.086 | 10.44 | 0.257 | 0.756 | – |
| N | XGBoost | 9.053 | 18.970 | 37.38 | 0.238 | 0.818 | 0.73 |
| N | LSTM | 11.171 | 21.027 | 41.58 | 0.294 | 0.777 | 0.80 |
| N | N-HiTS | 9.852 | 19.795 | 41.54 | 0.259 | 0.802 | 0.77 |
| N | PatchTST | 11.950 | 21.640 | 43.08 | 0.314 | 0.763 | 0.77 |
| N | Chronos-Bolt (small) | 9.760 | 20.559 | 41.04 | 0.257 | 0.787 | 0.70 |
| N | Seasonal Naive (1 ngày) | 33.505 | 46.471 | 76.60 | 0.881 | -0.091 | – |
| N | Naive | 11.298 | 20.807 | 40.17 | 0.297 | 0.781 | – |
| P | XGBoost | 23.410 | 54.450 | 11.88 | 0.219 | 0.808 | 0.71 |
| P | LSTM | 29.033 | 62.616 | 14.23 | 0.272 | 0.746 | 0.84 |
| P | N-HiTS | 24.261 | 60.313 | 12.83 | 0.227 | 0.764 | 0.77 |
| P | PatchTST | 29.814 | 64.265 | 15.30 | 0.279 | 0.733 | 0.77 |
| P | Chronos-Bolt (small) | 25.025 | 61.068 | 12.30 | 0.234 | 0.759 | 0.68 |
| P | Seasonal Naive (1 ngày) | 100.976 | 139.284 | 45.17 | 0.944 | -0.256 | – |
| P | Naive | 29.911 | 61.150 | 15.16 | 0.280 | 0.758 | – |
| K | XGBoost | 27.844 | 65.534 | 11.90 | 0.229 | 0.785 | 0.69 |
| K | LSTM | 33.966 | 73.795 | 13.62 | 0.279 | 0.728 | 0.84 |
| K | N-HiTS | 28.973 | 71.441 | 12.36 | 0.238 | 0.745 | 0.76 |
| K | PatchTST | 33.262 | 73.912 | 14.19 | 0.273 | 0.727 | 0.76 |
| K | Chronos-Bolt (small) | 30.153 | 73.247 | 12.49 | 0.248 | 0.732 | 0.67 |
| K | Seasonal Naive (1 ngày) | 118.868 | 164.670 | 45.16 | 0.976 | -0.356 | – |
| K | Naive | 34.411 | 72.770 | 14.10 | 0.283 | 0.735 | – |

### Nhóm long – MASE (kiểu cum: gộp bước 1..k) trung bình 9 biến

| Mô hình | 1d | 2d | 3d | 4d | 5d |
|---|---|---|---|---|---|
| XGBoost | 0.470 | 0.593 | 0.696 | 0.752 | 0.776 |
| LSTM | 0.811 | 0.995 | 1.077 | 1.111 | 1.132 |
| N-HiTS | 0.785 | 0.992 | 1.154 | 1.278 | 1.373 |
| PatchTST | 0.605 | 0.754 | 0.840 | 0.894 | 0.933 |
| Chronos-Bolt (small) | 0.564 | 0.727 | 0.825 | 0.879 | 0.907 |
| Seasonal Naive (1 ngày) | 0.945 | 1.132 | 1.234 | 1.291 | 1.284 |
| Naive | 1.170 | 1.389 | 1.535 | 1.618 | 1.646 |

### Nhóm long – mô hình tốt nhất theo (biến, horizon) (MASE cum thấp nhất; trong ngoặc: MASE / MAE)

| Biến | 1d | 2d | 3d | 4d | 5d |
|---|---|---|---|---|---|
| temperature | **XGBoost** (0.45 / 0.487) | **XGBoost** (0.44 / 0.486) | **XGBoost** (0.44 / 0.483) | **XGBoost** (0.44 / 0.483) | **XGBoost** (0.44 / 0.483) |
| humidity | **XGBoost** (0.40 / 2.314) | **XGBoost** (0.41 / 2.369) | **XGBoost** (0.41 / 2.359) | **XGBoost** (0.41 / 2.352) | **XGBoost** (0.41 / 2.333) |
| soiltemp | **XGBoost** (0.69 / 0.339) | **XGBoost** (0.92 / 0.450) | **XGBoost** (1.05 / 0.516) | **XGBoost** (1.12 / 0.552) | **XGBoost** (1.16 / 0.571) |
| moisture | **XGBoost** (0.48 / 1.417) | **XGBoost** (0.61 / 1.778) | **XGBoost** (0.70 / 2.052) | **Chronos-Bolt** (0.75 / 2.206) | **Chronos-Bolt** (0.79 / 2.299) |
| pH | **PatchTST** (0.48 / 0.053) | **PatchTST** (0.55 / 0.062) | **PatchTST** (0.61 / 0.068) | **PatchTST** (0.65 / 0.073) | **PatchTST** (0.68 / 0.076) |
| EC | **Chronos-Bolt** (0.37 / 0.055) | **PatchTST** (0.56 / 0.083) | **PatchTST** (0.65 / 0.097) | **PatchTST** (0.71 / 0.106) | **PatchTST** (0.76 / 0.114) |
| N | **Chronos-Bolt** (0.38 / 14.222) | **PatchTST** (0.57 / 21.290) | **PatchTST** (0.66 / 24.689) | **PatchTST** (0.72 / 26.841) | **PatchTST** (0.77 / 28.799) |
| P | **Chronos-Bolt** (0.37 / 39.555) | **PatchTST** (0.56 / 59.516) | **PatchTST** (0.65 / 69.025) | **PatchTST** (0.71 / 75.708) | **PatchTST** (0.77 / 81.695) |
| K | **Chronos-Bolt** (0.39 / 46.651) | **PatchTST** (0.58 / 70.024) | **PatchTST** (0.67 / 80.993) | **PatchTST** (0.73 / 88.189) | **PatchTST** (0.78 / 94.836) |

### Nhóm long – chi tiết tại horizon 3d (cum)

| Biến | Mô hình | MAE | RMSE | sMAPE % | MASE | R² | Cov80 |
|---|---|---|---|---|---|---|---|
| temperature | XGBoost | 0.483 | 0.656 | 1.66 | 0.441 | 0.943 | 0.69 |
| temperature | LSTM | 1.323 | 1.682 | 4.56 | 1.209 | 0.624 | 0.78 |
| temperature | N-HiTS | 1.421 | 1.856 | 4.90 | 1.299 | 0.542 | 0.70 |
| temperature | PatchTST | 1.117 | 1.498 | 3.79 | 1.021 | 0.702 | 0.73 |
| temperature | Chronos-Bolt (small) | 0.978 | 1.335 | 3.30 | 0.894 | 0.763 | 0.81 |
| temperature | Seasonal Naive (1 ngày) | 1.226 | 1.741 | 4.13 | 1.120 | 0.597 | – |
| temperature | Naive | 3.331 | 4.206 | 11.15 | 3.043 | -1.353 | – |
| humidity | XGBoost | 2.359 | 3.191 | 3.12 | 0.410 | 0.944 | 0.76 |
| humidity | LSTM | 8.400 | 10.618 | 11.10 | 1.461 | 0.375 | 0.86 |
| humidity | N-HiTS | 9.611 | 12.420 | 12.49 | 1.672 | 0.144 | 0.59 |
| humidity | PatchTST | 6.426 | 8.616 | 8.62 | 1.118 | 0.588 | 0.73 |
| humidity | Chronos-Bolt (small) | 5.934 | 8.070 | 7.99 | 1.032 | 0.639 | 0.84 |
| humidity | Seasonal Naive (1 ngày) | 7.572 | 10.449 | 10.23 | 1.317 | 0.394 | – |
| humidity | Naive | 15.444 | 19.578 | 20.67 | 2.686 | -1.126 | – |
| soiltemp | XGBoost | 0.516 | 0.669 | 1.90 | 1.053 | 0.555 | 0.53 |
| soiltemp | LSTM | 0.714 | 0.914 | 2.63 | 1.455 | 0.168 | 0.70 |
| soiltemp | N-HiTS | 0.773 | 0.986 | 2.85 | 1.576 | 0.032 | 0.53 |
| soiltemp | PatchTST | 0.674 | 0.849 | 2.48 | 1.375 | 0.283 | 0.63 |
| soiltemp | Chronos-Bolt (small) | 0.618 | 0.797 | 2.27 | 1.259 | 0.367 | 0.81 |
| soiltemp | Seasonal Naive (1 ngày) | 0.833 | 1.049 | 3.06 | 1.699 | -0.095 | – |
| soiltemp | Naive | 0.989 | 1.230 | 3.63 | 2.017 | -0.505 | – |
| moisture | XGBoost | 2.052 | 2.734 | 3.94 | 0.702 | 0.157 | 0.79 |
| moisture | LSTM | 2.477 | 3.235 | 4.76 | 0.847 | -0.180 | 0.63 |
| moisture | N-HiTS | 2.745 | 3.574 | 5.25 | 0.939 | -0.440 | 0.36 |
| moisture | PatchTST | 2.386 | 3.150 | 4.57 | 0.816 | -0.119 | 0.62 |
| moisture | Chronos-Bolt (small) | 2.077 | 2.801 | 3.97 | 0.710 | 0.115 | 0.74 |
| moisture | Seasonal Naive (1 ngày) | 2.502 | 3.451 | 4.79 | 0.856 | -0.343 | – |
| moisture | Naive | 2.360 | 3.146 | 4.53 | 0.807 | -0.116 | – |
| pH | XGBoost | 0.073 | 0.094 | 1.36 | 0.654 | 0.088 | 0.89 |
| pH | LSTM | 0.078 | 0.104 | 1.46 | 0.699 | -0.118 | 0.55 |
| pH | N-HiTS | 0.076 | 0.099 | 1.41 | 0.679 | -0.019 | 0.42 |
| pH | PatchTST | 0.068 | 0.092 | 1.26 | 0.607 | 0.131 | 0.74 |
| pH | Chronos-Bolt (small) | 0.071 | 0.093 | 1.33 | 0.640 | 0.102 | 0.81 |
| pH | Seasonal Naive (1 ngày) | 0.083 | 0.114 | 1.56 | 0.748 | -0.344 | – |
| pH | Naive | 0.077 | 0.103 | 1.45 | 0.695 | -0.107 | – |
| EC | XGBoost | 0.113 | 0.156 | 29.29 | 0.756 | 0.122 | 0.58 |
| EC | LSTM | 0.149 | 0.229 | 42.95 | 0.999 | -0.904 | 0.67 |
| EC | N-HiTS | 0.157 | 0.217 | 39.00 | 1.054 | -0.709 | 0.47 |
| EC | PatchTST | 0.097 | 0.158 | 24.36 | 0.646 | 0.096 | 0.73 |
| EC | Chronos-Bolt (small) | 0.108 | 0.164 | 27.68 | 0.721 | 0.025 | 0.70 |
| EC | Seasonal Naive (1 ngày) | 0.201 | 0.231 | 51.02 | 1.345 | -0.931 | – |
| EC | Naive | 0.171 | 0.212 | 42.97 | 1.143 | -0.630 | – |
| N | XGBoost | 27.683 | 38.118 | 60.81 | 0.738 | 0.181 | 0.67 |
| N | LSTM | 37.051 | 57.306 | 85.66 | 0.988 | -0.850 | 0.68 |
| N | N-HiTS | 38.828 | 54.161 | 77.32 | 1.036 | -0.652 | 0.48 |
| N | PatchTST | 24.689 | 40.385 | 58.05 | 0.659 | 0.081 | 0.70 |
| N | Chronos-Bolt (small) | 26.439 | 40.048 | 61.75 | 0.705 | 0.097 | 0.72 |
| N | Seasonal Naive (1 ngày) | 47.859 | 55.348 | 98.55 | 1.277 | -0.726 | – |
| N | Naive | 40.835 | 50.810 | 83.68 | 1.089 | -0.454 | – |
| P | XGBoost | 77.547 | 106.882 | 36.51 | 0.729 | 0.193 | 0.55 |
| P | LSTM | 107.349 | 165.015 | 54.51 | 1.010 | -0.925 | 0.67 |
| P | N-HiTS | 112.365 | 155.209 | 48.84 | 1.057 | -0.703 | 0.47 |
| P | PatchTST | 69.025 | 112.883 | 32.19 | 0.649 | 0.099 | 0.73 |
| P | Chronos-Bolt (small) | 76.794 | 117.200 | 35.36 | 0.722 | 0.029 | 0.69 |
| P | Seasonal Naive (1 ngày) | 143.820 | 165.299 | 64.81 | 1.353 | -0.931 | – |
| P | Naive | 122.215 | 152.129 | 54.61 | 1.150 | -0.636 | – |
| K | XGBoost | 93.938 | 128.641 | 37.54 | 0.776 | 0.106 | 0.52 |
| K | LSTM | 124.134 | 189.573 | 54.23 | 1.025 | -0.941 | 0.66 |
| K | N-HiTS | 130.680 | 179.661 | 49.09 | 1.079 | -0.744 | 0.47 |
| K | PatchTST | 80.993 | 131.060 | 33.54 | 0.669 | 0.072 | 0.72 |
| K | Chronos-Bolt (small) | 89.079 | 136.278 | 35.24 | 0.736 | -0.003 | 0.69 |
| K | Seasonal Naive (1 ngày) | 168.412 | 194.048 | 65.09 | 1.391 | -1.034 | – |
| K | Naive | 143.089 | 178.570 | 54.76 | 1.182 | -0.723 | – |

### Nhóm long – chi tiết tại horizon 5d (cum)

| Biến | Mô hình | MAE | RMSE | sMAPE % | MASE | R² | Cov80 |
|---|---|---|---|---|---|---|---|
| temperature | XGBoost | 0.483 | 0.648 | 1.66 | 0.442 | 0.944 | 0.70 |
| temperature | LSTM | 1.309 | 1.663 | 4.50 | 1.196 | 0.633 | 0.82 |
| temperature | N-HiTS | 1.566 | 2.027 | 5.44 | 1.431 | 0.454 | 0.66 |
| temperature | PatchTST | 1.152 | 1.555 | 3.89 | 1.052 | 0.679 | 0.74 |
| temperature | Chronos-Bolt (small) | 1.023 | 1.378 | 3.45 | 0.935 | 0.748 | 0.77 |
| temperature | Seasonal Naive (1 ngày) | 1.299 | 1.830 | 4.37 | 1.187 | 0.555 | – |
| temperature | Naive | 3.358 | 4.236 | 11.23 | 3.069 | -1.384 | – |
| humidity | XGBoost | 2.333 | 3.153 | 3.08 | 0.406 | 0.945 | 0.77 |
| humidity | LSTM | 8.562 | 10.730 | 11.18 | 1.489 | 0.361 | 0.85 |
| humidity | N-HiTS | 10.915 | 14.342 | 14.26 | 1.899 | -0.142 | 0.56 |
| humidity | PatchTST | 6.660 | 8.883 | 8.93 | 1.158 | 0.562 | 0.76 |
| humidity | Chronos-Bolt (small) | 6.135 | 8.286 | 8.25 | 1.067 | 0.619 | 0.79 |
| humidity | Seasonal Naive (1 ngày) | 7.965 | 10.927 | 10.76 | 1.386 | 0.337 | – |
| humidity | Naive | 15.688 | 19.824 | 20.98 | 2.729 | -1.182 | – |
| soiltemp | XGBoost | 0.571 | 0.726 | 2.10 | 1.164 | 0.469 | 0.53 |
| soiltemp | LSTM | 0.742 | 0.936 | 2.74 | 1.512 | 0.118 | 0.73 |
| soiltemp | N-HiTS | 0.870 | 1.122 | 3.21 | 1.773 | -0.267 | 0.52 |
| soiltemp | PatchTST | 0.741 | 0.922 | 2.73 | 1.511 | 0.143 | 0.66 |
| soiltemp | Chronos-Bolt (small) | 0.687 | 0.867 | 2.53 | 1.400 | 0.243 | 0.78 |
| soiltemp | Seasonal Naive (1 ngày) | 0.923 | 1.149 | 3.39 | 1.882 | -0.329 | – |
| soiltemp | Naive | 1.077 | 1.345 | 3.96 | 2.196 | -0.822 | – |
| moisture | XGBoost | 2.379 | 3.141 | 4.57 | 0.813 | -0.101 | 0.75 |
| moisture | LSTM | 2.690 | 3.523 | 5.16 | 0.920 | -0.385 | 0.63 |
| moisture | N-HiTS | 3.157 | 4.101 | 6.04 | 1.080 | -0.877 | 0.34 |
| moisture | PatchTST | 2.654 | 3.477 | 5.07 | 0.908 | -0.349 | 0.65 |
| moisture | Chronos-Bolt (small) | 2.299 | 3.035 | 4.39 | 0.786 | -0.028 | 0.68 |
| moisture | Seasonal Naive (1 ngày) | 2.792 | 3.806 | 5.34 | 0.955 | -0.616 | – |
| moisture | Naive | 2.690 | 3.592 | 5.16 | 0.920 | -0.439 | – |
| pH | XGBoost | 0.084 | 0.109 | 1.57 | 0.758 | -0.232 | 0.87 |
| pH | LSTM | 0.085 | 0.112 | 1.60 | 0.768 | -0.300 | 0.57 |
| pH | N-HiTS | 0.086 | 0.112 | 1.61 | 0.771 | -0.296 | 0.41 |
| pH | PatchTST | 0.076 | 0.102 | 1.42 | 0.682 | -0.067 | 0.73 |
| pH | Chronos-Bolt (small) | 0.080 | 0.102 | 1.49 | 0.715 | -0.067 | 0.77 |
| pH | Seasonal Naive (1 ngày) | 0.093 | 0.125 | 1.73 | 0.832 | -0.618 | – |
| pH | Naive | 0.089 | 0.119 | 1.65 | 0.796 | -0.443 | – |
| EC | XGBoost | 0.129 | 0.165 | 34.22 | 0.861 | -0.061 | 0.52 |
| EC | LSTM | 0.160 | 0.222 | 46.49 | 1.073 | -0.915 | 0.65 |
| EC | N-HiTS | 0.201 | 0.288 | 50.49 | 1.349 | -2.213 | 0.40 |
| EC | PatchTST | 0.114 | 0.171 | 29.10 | 0.764 | -0.139 | 0.71 |
| EC | Chronos-Bolt (small) | 0.122 | 0.170 | 32.23 | 0.815 | -0.128 | 0.61 |
| EC | Seasonal Naive (1 ngày) | 0.199 | 0.235 | 50.93 | 1.334 | -1.139 | – |
| EC | Naive | 0.191 | 0.230 | 48.63 | 1.280 | -1.058 | – |
| N | XGBoost | 31.634 | 40.818 | 72.34 | 0.844 | -0.039 | 0.64 |
| N | LSTM | 39.123 | 55.185 | 91.66 | 1.044 | -0.900 | 0.67 |
| N | N-HiTS | 49.614 | 72.972 | 93.53 | 1.324 | -2.322 | 0.42 |
| N | PatchTST | 28.799 | 43.411 | 65.07 | 0.768 | -0.176 | 0.70 |
| N | Chronos-Bolt (small) | 29.243 | 40.956 | 69.66 | 0.780 | -0.046 | 0.64 |
| N | Seasonal Naive (1 ngày) | 47.272 | 56.454 | 98.01 | 1.261 | -0.988 | – |
| N | Naive | 45.535 | 55.354 | 93.13 | 1.215 | -0.911 | – |
| P | XGBoost | 89.606 | 114.717 | 43.50 | 0.843 | 0.001 | 0.48 |
| P | LSTM | 114.883 | 159.286 | 59.18 | 1.081 | -0.926 | 0.65 |
| P | N-HiTS | 143.683 | 204.971 | 62.84 | 1.352 | -2.190 | 0.40 |
| P | PatchTST | 81.695 | 122.405 | 37.86 | 0.768 | -0.138 | 0.71 |
| P | Chronos-Bolt (small) | 86.962 | 121.780 | 41.46 | 0.818 | -0.126 | 0.61 |
| P | Seasonal Naive (1 ngày) | 142.488 | 167.869 | 64.72 | 1.340 | -1.140 | – |
| P | Naive | 136.992 | 164.911 | 61.79 | 1.289 | -1.065 | – |
| K | XGBoost | 103.075 | 132.943 | 42.11 | 0.851 | -0.009 | 0.47 |
| K | LSTM | 133.795 | 183.757 | 59.13 | 1.105 | -0.927 | 0.64 |
| K | N-HiTS | 166.767 | 234.921 | 62.87 | 1.377 | -2.150 | 0.40 |
| K | PatchTST | 94.836 | 141.308 | 38.62 | 0.783 | -0.140 | 0.71 |
| K | Chronos-Bolt (small) | 102.080 | 142.750 | 41.70 | 0.843 | -0.163 | 0.60 |
| K | Seasonal Naive (1 ngày) | 167.134 | 196.670 | 65.10 | 1.380 | -1.208 | – |
| K | Naive | 160.588 | 193.290 | 62.01 | 1.326 | -1.132 | – |

<!-- RESULTS:END -->

## 7. Nhận xét

*(dựa trên lần chạy đầy đủ 29/10/2026, 1411 s trên RTX 3070 Laptop; số liệu chi tiết ở mục 6)*

**Nhóm ngắn hạn (5 phút).**
- **XGBoost** tốt nhất xét trung bình 9 biến ở mọi horizon (MASE 0,106 @5′ → 0,419 @12h) và là "best" ở phần lớn các ô (biến × horizon).
  Chronos-Bolt zero-shot (0,113 → 0,462) và N-HiTS (0,138 → 0,458) bám sát phía sau.
- Mọi mô hình đều thắng **Seasonal Naive** (≈ 0,93) ở mọi horizon ngắn. Tuy nhiên **Naive** (giá trị cuối) rất mạnh ở 5–10′
  (0,120 / 0,131): LSTM (0,157), N-HiTS (0,138), PatchTST (0,143) **kém hơn Naive ở 5–10′** và chỉ vượt Naive từ khoảng 30′–1 h trở đi;
  với temperature/humidity ở 5′, Naive vẫn là tốt nhất. Đây là hành vi thường gặp với chuỗi cảm biến lấy mẫu dày và trơn.
- Các biến đất (moisture, pH, EC, N, P, K) dự báo rất tốt (MASE ≤ 0,35 tới 12 h); khó nhất là nhiệt độ/ẩm không khí ở 6–12 h (MASE 0,64–0,87).

**Nhóm dài hạn (1 giờ, 1–5 ngày).**
- **XGBoost** tốt nhất trung bình (0,47 @1d → 0,78 @5d) **nhưng được lợi từ giả định thời tiết hoàn hảo**: nó dùng thời tiết ERA5 *thực tế* tại thời điểm mục tiêu.
  Bằng chứng: với temperature/humidity MASE gần như không đổi theo horizon (≈ 0,44 / 0,41 từ 1d đến 5d) – mô hình "đọc" nhiệt độ/ẩm từ thời tiết
  chứ không ngoại suy. Khi chạy thật với **dự báo** Open-Meteo, sai số sẽ cao hơn (chưa đo được vì chưa có lịch sử dự báo đã lưu).
- **Chronos-Bolt** (zero-shot, không thời tiết) 0,56 → 0,91 và **PatchTST** (không thời tiết) 0,61 → 0,93 thắng Seasonal Naive (0,95 → 1,28) ở mọi horizon;
  hai mô hình này là "best" cho pH/EC/N/P/K – các biến không phụ thuộc trực tiếp vào thời tiết.
- **LSTM** (0,81 → 1,13) thắng Seasonal Naive ở mọi horizon nhưng kém Chronos/PatchTST.
- **N-HiTS** (0,79 → 1,37) **kém Seasonal Naive ở horizon 5 ngày** (1,373 > 1,284) và không ổn định: early-stopping dừng ở bước 100
  (quá khớp rất nhanh – chỉ ~4,4 nghìn điểm giờ/chuỗi, validation tháng 6–7 khác mùa so với train); lần chạy trước cùng cấu hình cho 1,76 @5d.
  Đã thử (chỉ trên **validation**, không nhìn test) bỏ thời tiết / chỉ giữ biến thời tiết "đặc" / giảm learning rate: MASE validation chỉ đổi ±0,05,
  nên giữ cấu hình gốc và báo cáo trung thực.
- `soiltemp` dài hạn: mọi mô hình có MASE > 1 (tốt nhất XGBoost 1,16 @5d; Seasonal Naive 1,88) – tập test (mùa mưa) biến động khác hẳn tập train.

**Khoảng dự báo 80 %.** Coverage thực tế thấp hơn danh nghĩa và giảm theo horizon: nhóm ngắn @1h 0,74–0,80, @12h 0,68–0,77;
nhóm dài @1d 0,63–0,81, @5d 0,46–0,71 (N-HiTS thấp nhất). Cần hiệu chỉnh (conformal) nếu dùng khoảng để ra quyết định.

**GPU.** Huấn luyện LSTM/N-HiTS/PatchTST/XGBoost và suy luận Chronos đều chạy trên `cuda` (RTX 3070 Laptop 8 GB);
`nvidia-smi` ghi nhận mức sử dụng tối đa 100 %, VRAM tối đa ≈ 7,8 GB (chi tiết theo giai đoạn: `metrics.json → device.nvidia_smi.by_stage`).

**Kiểm tra rò rỉ.** (1) mọi ngữ cảnh được assert có timestamp < origin và được làm sạch lại chỉ bằng dữ liệu quá khứ; (2) test nhiễu: thay mọi giá trị sau origin
bằng nhiễu → đặc trưng XGBoost không đổi (`max_feature_diff = 0`); (3) chuẩn hoá theo cửa sổ đầu vào hoặc thống kê train; (4) chọn cấu hình chỉ dựa trên validation.
Ghi chú trung thực: lần chạy đầu dùng `neuralforecast.LSTM` và PatchTST tắt RevIN cho kết quả kém ở horizon ngắn (LSTM MASE@5′ 0,76; PatchTST 0,46);
việc thay LSTM bằng kiến trúc seq2vec và bật RevIN dựa trên **lỗi thiết kế/thiết lập đã xác định** (mục 4.2, 4.4), không phải dò tham số trên test.


## 8. Hạn chế

- Chỉ 261 ngày của **một** luống / một bộ cảm biến; tập test (~52 ngày, mùa mưa tháng 7–8) khác mùa với phần lớn tập train
  (tháng 12–6) → kết quả có thể không đại diện cho mùa khô.
- Nhóm dài hạn: số origin trên test nhỏ (~100) nên chỉ số dao động; thời tiết dùng giá trị **archive (hoàn hảo)** khi train/đánh giá
  nhưng khi chạy thật dùng **dự báo** Open-Meteo → sai số thực tế có thể lớn hơn.
- N, P, K của cảm biến CWT là giá trị **suy ra từ EC** (không đo trực tiếp ion) nên tương quan rất mạnh với EC; độ tin cậy vật lý hạn chế.
- Lỗi thời gian (Jetson không có RTC) đã được edge agent hiệu chỉnh nhưng bản ghi `tq="estimated"` vẫn có thể lệch vài phút.
- Siêu tham số chọn theo kinh nghiệm + early-stopping, chưa tối ưu tự động (Optuna) vì giới hạn thời gian; Chronos chưa fine-tune.
- Khoảng 80 % của mạng neural/XGBoost học bằng quantile loss, chưa hiệu chỉnh (conformal) → coverage có thể lệch khỏi 0,80.

## 9. Tài liệu tham khảo

1. Chen, T., & Guestrin, C. (2016). XGBoost: A Scalable Tree Boosting System. *KDD '16*, 785–794. https://doi.org/10.1145/2939672.2939785
2. Hochreiter, S., & Schmidhuber, J. (1997). Long Short-Term Memory. *Neural Computation*, 9(8), 1735–1780. https://doi.org/10.1162/neco.1997.9.8.1735
3. Challu, C., Olivares, K. G., Oreshkin, B. N., Garza Ramírez, F., Mergenthaler Canseco, M., & Dubrawski, A. (2023). N-HiTS: Neural Hierarchical Interpolation for Time Series Forecasting. *AAAI*, 37(6), 6989–6997. https://doi.org/10.1609/aaai.v37i6.25854
4. Nie, Y., Nguyen, N. H., Sinthong, P., & Kalagnanam, J. (2023). A Time Series is Worth 64 Words: Long-term Forecasting with Transformers. *ICLR 2023*. https://doi.org/10.48550/arXiv.2211.14730
5. Ansari, A. F., Stella, L., Turkmen, C., et al. (2024). Chronos: Learning the Language of Time Series. *TMLR*. https://doi.org/10.48550/arXiv.2403.07815
6. Hyndman, R. J., & Koehler, A. B. (2006). Another look at measures of forecast accuracy. *International Journal of Forecasting*, 22(4), 679–688. https://doi.org/10.1016/j.ijforecast.2006.03.001
7. Tashman, L. J. (2000). Out-of-sample tests of forecasting accuracy: an analysis and review. *International Journal of Forecasting*, 16(4), 437–450. https://doi.org/10.1016/S0169-2070(00)00065-0
8. Bergmeir, C., & Benítez, J. M. (2012). On the use of cross-validation for time series predictor evaluation. *Information Sciences*, 191, 192–213. https://doi.org/10.1016/j.ins.2011.12.028
9. Makridakis, S., Spiliotis, E., & Assimakopoulos, V. (2022). M5 accuracy competition: Results, findings, and conclusions. *International Journal of Forecasting*, 38(4), 1346–1364. https://doi.org/10.1016/j.ijforecast.2021.11.013
10. Ben Taieb, S., Bontempi, G., Atiya, A. F., & Sorjamaa, A. (2012). A review and comparison of strategies for multi-step ahead time series forecasting based on the NN5 forecasting competition. *Expert Systems with Applications*, 39(8), 7067–7083. https://doi.org/10.1016/j.eswa.2012.01.039
11. Hyndman, R. J., & Athanasopoulos, G. (2021). *Forecasting: Principles and Practice* (3rd ed.). OTexts. https://otexts.com/fpp3/
12. Pearson, R. K. (2002). Outliers in process modeling and identification. *IEEE Transactions on Control Systems Technology*, 10(1), 55–63. https://doi.org/10.1109/87.974338
