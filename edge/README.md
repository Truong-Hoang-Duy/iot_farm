# IoT Farm – tác tử biên (edge agent) cho Jetson Nano

Chương trình chạy nền trên **Jetson Nano (JetPack 4.6 / Ubuntu 18.04 / Python 3.6)**:
đọc cảm biến đất **CWT 7in1 (RS485)** và cảm biến không khí **DHT20 (I2C)** → lưu **SQLite trước** →
gửi lên **Firebase Realtime Database** theo lô khi có mạng và giờ đã đúng. Chương trình đồng thời gửi heartbeat,
nhận cấu hình từ giao diện web và điều khiển trực tiếp mạch **Waveshare 3CH Relay** (Relay 1 = đèn chiếu sáng, Relay 2 = máy bơm nước).

```mermaid
flowchart LR
  S1["CWT 7in1 RS485 → USB"] --> SM["sampler"]
  S2["DHT20 I2C bus 0"] --> SM
  SM --> Q[("SQLite queue.db")]
  Q --> UP["uploader (≤500 bản ghi/lô)"]
  UP -- "PATCH /data.json" --> FB[("Firebase RTDB")]
  HB["heartbeat ≤15 s"] -- "devices/{id}/status" --> FB
  FB -- "streaming/config + control" --> CT["control (2 s)"]
  CT --> RL["Waveshare 3CH Relay (CH1 đèn, CH2 bơm)"]
  TS["timesync: timedatectl + SNTP"] -. "hiệu chỉnh mốc thời gian" .-> Q
```

## 1. Cấu trúc thư mục

| Đường dẫn | Nội dung |
|---|---|
| `run_agent.py` | Điểm vào (`python3 run_agent.py --help`) |
| `farm_agent/config.py` | Đọc `config.ini` (`configparser`) + tham số dòng lệnh |
| `farm_agent/sensors/soil_cwt.py` | CWT 7in1 Modbus RTU |
| `farm_agent/sensors/dht20.py` | DHT20 + CRC-8 |
| `farm_agent/sensors/simulated.py` | Cảm biến giả lập / phát lại `soil_all.json` |
| `farm_agent/queue_store.py` | Hàng đợi offline SQLite (store-and-forward) |
| `farm_agent/timesync.py` | Kiểm tra NTP (`timedatectl` + SNTP), hiệu chỉnh thời gian |
| `farm_agent/netcheck.py` | Kiểm tra mạng (DNS + TCP) trước khi gửi |
| `farm_agent/firebase_client.py` | Firebase RTDB REST + Firebase Auth REST (không dùng `firebase-admin`) |
| `farm_agent/relay.py` | Điều khiển mạch Waveshare 3CH Relay (CH1 đèn, CH2 bơm): thủ công / tự động / lập lịch |
| `farm_agent/agent.py` | Điều phối các luồng (thread) |
| `config.example.ini` | Mẫu cấu hình (sao chép thành `config.ini`) |
| `install.sh` | Cài đặt tự động + `systemd` service + quyền `gpio/i2c/dialout` |
| `systemd/iot-farm-agent.service` | Mẫu unit `systemd` |
| `tests/` | Unit test, mock Firebase, test end-to-end, kiểm tra tương thích Python 3.6 |

Dữ liệu chạy: `data/queue.db` (hàng đợi), `logs/agent.log` (log chính, xoay vòng 5 MB × 5),
`logs/uploads.log` (mỗi lô upload 1 dòng).

## 2. Đấu dây phần cứng

> [!IMPORTANT]
> GPIO của Jetson Nano dùng mức logic **3.3 V**. Không cấp 5 V vào chân tín hiệu GPIO. Đèn chiếu sáng và máy bơm phải dùng **nguồn công suất riêng** đấu qua tiếp điểm thường mở (`NO` – `COM`) của relay, không lấy nguồn tải trực tiếp từ Jetson Nano.

**DHT20 (I2C bus 0 – header 40 chân):**

| DHT20 | Jetson Nano (số chân vật lý BOARD) |
|---|---|
| VDD | Chân 1 hoặc 17 (3.3 V) |
| SDA | Chân **27** (`I2C_1 SDA` → `/dev/i2c-0`) |
| GND | Chân 6, 9, 14... |
| SCL | Chân **28** (`I2C_1 SCL` → `/dev/i2c-0`) |

**CWT 7in1 (RS485 → bộ chuyển USB-RS485 → `/dev/ttyUSB0`):** nối A+ ↔ A, B- ↔ B trên bộ chuyển;
nguồn cảm biến theo nhãn của nhà sản xuất (thường 5–30 V DC, GND chung với bộ chuyển).
Thông số mặc định: **slave 2, 9600 baud, 8N1**. Thanh ghi `0..6` = độ ẩm/10, nhiệt độ/10 (có dấu),
EC (µS/cm → agent đổi sang **mS/cm**), pH (tự nhận 0.01/0.1), N, P, K (mg/kg).

**Mạch Waveshare RPi Relay Board (3CH) gắn trên header 40 chân của Jetson Nano (jumper mặc định `P29 / P28 / P25`):**

| Kênh Waveshare | Thiết bị chấp hành | Chân vật lý (`BOARD`) | Chân `BCM` | Mức kích (`active_low = true`) |
|---|---|---|---|---|
| **Relay 1 (`CH1`, `P29`)** | **Đèn chiếu sáng** (`light`) | **Chân 40** | `BCM 21` | `LOW` = đóng (`BẬT`), `HIGH` = ngắt (`TẮT`) |
| **Relay 2 (`CH2`, `P28`)** | **Máy bơm nước** (`pump`) | **Chân 38** | `BCM 20` | `LOW` = đóng (`BẬT`), `HIGH` = ngắt (`TẮT`) |
| **Relay 3 (`CH3`, `P25`)** | Kênh dự phòng (`spare`) | **Chân 37** | `BCM 26` | Khởi tạo an toàn ở mức `HIGH` (`TẮT`) |

> [!NOTE]
> Mạch Waveshare 3CH Relay cắm chồng trực tiếp lên header 40 chân của Jetson Nano (vẫn dùng chung bus I2C chân 27/28 nếu nối dây ra cho DHT20). Nếu dời jumper phần cứng sang chân khác, chỉ cần chỉnh lại `light_pin`, `pump_pin`, `spare_pin` và `pin_mode` (`BOARD` hoặc `BCM`) trong `config.ini`.

## 3. Cài đặt trên Jetson Nano

```bash
# 1) Lấy mã nguồn (đặt ở đường dẫn KHÔNG có dấu cách)
git clone <repo> ~/iot-farm && cd ~/iot-farm/edge

# 2) Cài đặt: apt, venv (--system-site-packages để nhận Jetson.GPIO), nhóm i2c/dialout/gpio,
#    udev rule 99-gpio.rules, kiểm tra I2C/USB, bật NTP, cài & bật systemd service
chmod +x install.sh
sudo ./install.sh --no-start

# 3) Kiểm tra / chỉnh sửa cấu hình (db_url, api_key, email, password, relay)
nano config.ini

# 4) Kiểm tra phần cứng 1 lần (không gửi Firebase)
.venv/bin/python run_agent.py --once

# 5) Khởi chạy dịch vụ nền
sudo systemctl start iot-farm-agent
journalctl -u iot-farm-agent -f        # hoặc: tail -f logs/agent.log
```

Lệnh hữu ích: `sudo systemctl restart|stop|status iot-farm-agent`, `systemctl is-enabled iot-farm-agent`.

## 4. Tạo tài khoản thiết bị trên Firebase

1. **Firebase Console → Authentication → Sign-in method**: bật *Email/Password*.
2. **Authentication → Users → Add user**: email `jetson-nano-01@smartfarm.com`, đặt mật khẩu mạnh.
3. **Project settings → General → Web API Key** → điền vào `api_key`.
4. **Realtime Database** → sao chép URL (vd: `https://<project>-default-rtdb.asia-southeast1.firebasedatabase.app`) → `db_url`.
5. Triển khai `firebase/database.rules.json` (yêu cầu `auth != null`). Nếu để trống `api_key/email/password`,
   agent gửi request **không xác thực** – chỉ chạy được khi rules đang mở.

## 5. Cấu hình (`config.ini`)

| Mục / khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `device.device_id` | `jetson-nano-01` | Định danh → `devices/{device_id}` |
| `firebase.db_url` | `https://iot-farm-chilli-default-rtdb...` | URL Realtime Database |
| `firebase.api_key`, `email`, `password` | trống | Tài khoản thiết bị (để trống = không xác thực) |
| `sampling.sampling_interval_sec` | `300` | Chu kỳ đo (5..86400 s); bị ghi đè bởi `streaming/config/sampling_interval_sec` |
| `soil.port / slave_id / baudrate` | `/dev/ttyUSB0` / `2` / `9600` | CWT 7in1 RS485 |
| `dht20.i2c_bus / address` | `0` / `0x38` | DHT20 trên `/dev/i2c-0` |
| `heartbeat.max_heartbeat_sec` | `15` | `heartbeat = min(interval, 15 s)` |
| `heartbeat.control_poll_sec` | `2` | Chu kỳ đọc lệnh điều khiển & lịch trình từ `streaming` |
| `relay.relay_enabled` | `true` | `true` = xuất GPIO thật ra mạch Waveshare (tự chuyển giả lập nếu chạy trên PC không có `Jetson.GPIO`) |
| `relay.pin_mode` | `BOARD` | Hệ đánh số chân (`BOARD` vật lý 1..40 hoặc `BCM`) |
| `relay.light_pin` | `40` | Chân điều khiển **Relay 1 (`CH1`, `P29`) – đèn chiếu sáng** (`BCM 21`) |
| `relay.pump_pin` | `38` | Chân điều khiển **Relay 2 (`CH2`, `P28`) – máy bơm nước** (`BCM 20`) |
| `relay.spare_pin` | `37` | Chân **Relay 3 (`CH3`, `P25`)** giữ mức an toàn `TẮT` (`BCM 26`, `0` = bỏ qua) |
| `relay.active_low` | `true` | Mạch Waveshare kích mức thấp (`LOW` = BẬT, `HIGH` = TẮT) |
| `relay.max_pump_run_min` | `30` | Giới hạn thời gian bơm chạy liên tục tối đa (phút) |
| `relay.max_light_run_min` | `960` | Giới hạn thời gian bật đèn liên tục tối đa (phút, `0` = tắt giới hạn) |
| `relay.default_irrigation_duration_min` | `5` | Thời lượng mỗi cữ tưới theo lịch (phút) nếu Firebase chưa cấu hình |
| `relay.default_light_duration_min` | `120` | Thời lượng mỗi cữ bật đèn (phút) khi dùng lịch theo cữ |
| `relay.light_max_temp_c` | `35.0` | Ngưỡng nhiệt độ không khí tối đa (°C) để tự ngắt đèn bảo vệ cây |

## 6. Dữ liệu ghi lên Firebase (theo hợp đồng hệ thống)

```text
data/{YYYY-MM-DD}/{HH:MM:SS}      # giờ VN = UTC+7 cố định
    temperature, humidity, soiltemp, moisture, pH, EC (mS/cm), N, P, K, ts (epoch s UTC), tq
devices/{id}/status               # heartbeat + trạng thái trực tiếp relays.{light,pump}
devices/{id}/last_reading         # bản ghi lịch sử mới nhất + key
devices/{id}/live                 # thông số trực tiếp (~15 s hoặc khi bấm "Đọc ngay")
devices/{id}/command/read_now     # lệnh đọc ngay từ giao diện -> phản hồi read_now_ack
streaming/control/{pump|light}    # agent chỉ ghi actual, simulated, last_on_time, daily_time, updated_at
```

## 7. Bộ đệm offline & hiệu chỉnh thời gian (Jetson Nano không có RTC có pin)

Mỗi lần đo, agent lưu vào SQLite: `wall_ts` (giờ hệ thống), `monotonic` (đồng hồ đơn điệu từ lúc boot),
`boot_id`, cờ `ntp_synced` và dữ liệu JSON. Khi mất mạng hoặc chưa đồng bộ NTP, dữ liệu được xếp hàng an toàn trong `data/queue.db` và tự động hiệu chỉnh mốc thời gian (`corrected`) ngay khi NTP đồng bộ thành công.

## 8. Điều khiển mạch Waveshare 3CH Relay (đèn & máy bơm)

Cả **đèn chiếu sáng (Relay 1 – CH1)** và **máy bơm nước (Relay 2 – CH2)** đều hỗ trợ đầy đủ **3 chế độ vận hành** đồng bộ thời gian thực với Firebase (`streaming/config` & `streaming/control`):

| Thiết bị & kênh | Chế độ trên Firebase | Quy tắc điều khiển trên Jetson Nano |
|---|---|---|
| **Máy bơm (`pump`)**<br>Relay 2 (`CH2`, chân `BOARD 38`) | `irrigation_mode = 0` (**Thủ công**) | Bật / tắt tức thời theo `streaming/control/pump/status` |
| | `irrigation_mode = 1` (**Tự động**) | BẬT khi `moisture < threshold/soil_moisture/low`, TẮT khi `moisture > high` (giữ trễ trong vùng `[low, high]`). Khi bơm đang chạy, tự đọc nhanh độ ẩm mỗi ~10 s |
| | `irrigation_mode = 2` (**Theo lập lịch**) | BẬT tại các mốc cữ tưới `irrigation_time/{time1, time2, time3...}` (`"HH:MM"` hoặc số giờ `0..23`) trong `irrigation_duration_min` phút |
| **Đèn chiếu sáng (`light`)**<br>Relay 1 (`CH1`, chân `BOARD 40`) | `light_mode = 0` (**Thủ công**) | Bật / tắt tức thời theo `streaming/control/light/status` |
| | `light_mode = 1` (**Tự động**) | Tự động tính quang chu kỳ theo giai đoạn sinh trưởng (`plant/age_days`: ươm mầm 16 giờ, sinh trưởng 14 giờ, ra hoa 13 giờ, đậu quả/thu hoạch 12 giờ) kết hợp bảo vệ nhiệt độ từ cảm biến **DHT20** (tự tắt khi `air_temp > max_temp_c`, bật sưởi nhẹ khi `< min_temp_c` với trễ `1.5 °C`) |
| | `light_mode = 2` (**Theo lập lịch**) | Hỗ trợ **2 kiểu lập lịch**:<br>• **Theo khung giờ (`mode = "window"`)**: BẬT trong khoảng `light_time/on` → `off` (và khung phụ `on2` → `off2`, hỗ trợ cả khung qua đêm vd `22:00` → `02:00`).<br>• **Theo cữ tương tự máy bơm (`mode = "slots"`)**: BẬT tại các cữ `light_time/{time1, time2, time3}` trong `light_duration_min` phút |

**Cơ chế an toàn phần cứng:**
- Tất cả các kênh `CH1`, `CH2`, `CH3` đều được đưa về mức `TẮT` (`GPIO.HIGH` với `active_low = true`) ngay khi khởi tạo, khi thoát chương trình hoặc nhận tín hiệu `SIGTERM` / `SIGINT`.
- Tự động ngắt và khóa an toàn nếu máy bơm chạy liên tục quá `max_pump_run_min` (mặc định 30 phút) hoặc đèn bật liên tục quá `max_light_run_min` (mặc định 960 phút), chỉ mở khóa khi lệnh mong muốn trở về `TẮT`.
- Chế độ lập lịch chỉ kích hoạt khi đồng hồ hệ thống đã đồng bộ giờ chuẩn NTP (`clock_ok = true`).
- Agent **không bao giờ ghi đè** trường `status` của giao diện người dùng mà phản hồi trạng thái phần cứng thực tế qua `actual`, `simulated`, `last_on_time`, `daily_time` và `devices/{id}/status/relays`.

## 9. Chạy thử trên PC (không cần phần cứng)

```bash
cd edge
python run_agent.py --once --simulate                            # đọc giả lập 1 lần
python run_agent.py --once --replay ../frontend/public/soil_all.json

# Mock Firebase cục bộ + agent giả lập (mở 2 cửa sổ terminal)
python tests/mock_firebase.py --port 9000 --seed
python run_agent.py --simulate --assume-synced --mock-url http://127.0.0.1:9000 --interval 5

# Kiểm thử tự động
python -m unittest discover -s tests -v     # unit test (cảm biến, hàng đợi, NTP, relay 3 chế độ, GPIO...)
python tests/check_py36.py                  # kiểm tra tĩnh tương thích Python 3.6
```

## 10. Xử lý sự cố

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| `soil: error`, không mở được `/dev/ttyUSB0` | Chưa cắm USB-RS485, sai cổng (`ls /dev/ttyUSB*`), user chưa thuộc nhóm `dialout`, hoặc `brltty` chiếm cổng (`sudo apt-get remove brltty`) |
| `dht20: error` / không thấy `0x38` | Kiểm tra dây chân 27/28, nguồn 3.3 V; chạy `i2cdetect -y -r 0` phải thấy `38` |
| Relay thật không đóng tiếp điểm | Kiểm tra `relay_enabled = true` trong `config.ini`, quyền nhóm `gpio` + `/etc/udev/rules.d/99-gpio.rules`, jumper trên mạch Waveshare đúng mặc định (`CH1 = BOARD 40`, `CH2 = BOARD 38`, `CH3 = BOARD 37`), và `active_low = true` |
| Lịch tưới / lịch đèn chưa kích hoạt | Kiểm tra đồng hồ Jetson Nano đã đồng bộ NTP (`timedatectl status`); chế độ lập lịch yêu cầu giờ chuẩn để tránh kích sai giờ |

## 11. Giới hạn đã biết

- `daily_time` của relay đếm lại từ `0` khi tiến trình agent khởi động lại.
- Heartbeat chỉ gửi được khi có mạng, nên giao diện dựa vào `last_seen` so với giờ server Firebase để phát hiện trạng thái ngoại tuyến.
