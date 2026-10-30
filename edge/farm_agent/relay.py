# -*- coding: utf-8 -*-
"""Điều khiển mạch Waveshare 3CH Relay trên Jetson Nano: đèn (Relay 1) + máy bơm (Relay 2).

Sơ đồ phần cứng mặc định trên Jetson Nano (header 40 chân, jumper mặc định P29/P28/P25 của Waveshare 3CH Relay):
  - Relay 1 (CH1, P29): Đèn chiếu sáng (light) -> chân vật lý BOARD 40 (tương ứng BCM 21)
  - Relay 2 (CH2, P28): Máy bơm nước (pump)    -> chân vật lý BOARD 38 (tương ứng BCM 20)
  - Relay 3 (CH3, P25): Kênh dự phòng          -> chân vật lý BOARD 37 (tương ứng BCM 26, luôn giữ mức TẮT an toàn)
  - Mức kích hoạt: Active-Low (GPIO.LOW = đóng tiếp điểm BẬT, GPIO.HIGH = ngắt tiếp điểm TẮT)

Chế độ đọc từ Firebase `streaming/config`:
  irrigation_mode (Relay 2 - Máy bơm):
    0 manual   -> bật/tắt trực tiếp theo `streaming/control/pump/status`
    1 auto     -> trễ (hysteresis) theo độ ẩm đất mới nhất:
                  BẬT khi moisture < threshold/soil_moisture/low,
                  TẮT khi moisture > threshold/soil_moisture/high
    2 schedule -> bật tại các cữ irrigation_time/time1, time2, time3... (số giờ 0-23
                  hoặc chuỗi "HH:MM") trong `irrigation_duration_min` phút

  light_mode (Relay 1 - Đèn chiếu sáng):
    0 hoặc ''  -> bật/tắt trực tiếp theo `streaming/control/light/status`
    1 auto     -> tự động bù quang kỳ theo giai đoạn sinh trưởng cây trồng (`plant/age_days`)
                  kết hợp bảo vệ vi khí hậu từ cảm biến DHT20 (ngắt khi quá nóng > max_temp_c,
                  bật bù ấm khi lạnh < min_temp_c)
    2 schedule -> hỗ trợ cả 2 kiểu lập lịch:
                  (a) Theo khoảng giờ bật -> tắt: `light_time/on` .. `light_time/off`
                      (và khung phụ `on2` .. `off2`, định dạng số giờ hoặc "HH:MM")
                  (b) Theo cữ + thời lượng (tương tự máy bơm): `light_time/mode = "slots"`
                      với `time1`, `time2`, `time3`... trong `light_duration_min` phút

An toàn:
  - Mọi kênh relay đều khởi tạo ở trạng thái TẮT ngay khi setup GPIO, khi thoát và khi nhận SIGTERM.
  - Bơm chạy liên tục quá `max_pump_run_min` (hoặc đèn quá `max_light_run_min`) -> ngắt và khoá an toàn
    cho tới khi lệnh mong muốn trở về TẮT.
  - Báo cáo về `streaming/control/{pump|light}`: actual, simulated, last_on_time,
    daily_time (giờ, reset mỗi ngày theo giờ VN), updated_at. KHÔNG BAO GIỜ ghi đè `status`.
"""
import logging
import threading
import time

from .firebase_client import SERVER_TIMESTAMP
from .timeutil import vn_date_str, vn_hour_float, vn_time_str

log = logging.getLogger("farm_agent.relay")

MODE_MANUAL = 0
MODE_AUTO = 1
MODE_SCHEDULE = 2

RELAY_CH_LIGHT = 1
RELAY_CH_PUMP = 2
RELAY_CH_SPARE = 3


def to_bool(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "on", "yes")
    return False


def parse_mode(v, default=MODE_MANUAL):
    if v is None or (isinstance(v, str) and not v.strip()):
        return default
    try:
        m = int(float(v))
    except (TypeError, ValueError):
        return default
    return m if m in (MODE_MANUAL, MODE_AUTO, MODE_SCHEDULE) else default


def parse_hour(v):
    """6 -> 6.0; 6.5 -> 6.5; "06:30" -> 6.5; "6" -> 6.0; không hợp lệ -> None."""
    if v is None or isinstance(v, bool):
        return None
    try:
        if isinstance(v, (int, float)):
            h = float(v)
        else:
            s = str(v).strip()
            if not s or s == "-":
                return None
            if ":" in s:
                parts = s.split(":")
                hh = int(parts[0])
                mm = int(parts[1]) if len(parts) > 1 else 0
                ss = int(parts[2]) if len(parts) > 2 else 0
                if hh < 0 or hh >= 24 or mm < 0 or mm >= 60 or ss < 0 or ss >= 60:
                    return None
                h = hh + mm / 60.0 + ss / 3600.0
            else:
                h = float(s)
    except (TypeError, ValueError, IndexError):
        return None
    if h < 0 or h >= 24:
        return None
    return h


def format_hour_hm(h):
    """6.5 -> '06:30'."""
    if h is None:
        return "--:--"
    total_min = int(round((float(h) % 24.0) * 60.0)) % (24 * 60)
    return "%02d:%02d" % (total_min // 60, total_min % 60)


def parse_float(v, default=None):
    try:
        if v is None or isinstance(v, bool):
            return default
        s = str(v).strip() if isinstance(v, str) else v
        if s == "":
            return default
        return float(s)
    except (TypeError, ValueError):
        return default


def extract_schedule_slots(raw_times):
    """Trích danh sách các mốc giờ hợp lệ từ dict {time1, time2, ...} hoặc list."""
    out = []
    if isinstance(raw_times, dict):
        keys = sorted(k for k in raw_times.keys() if str(k).startswith("time"))
        for k in keys:
            h = parse_hour(raw_times.get(k))
            if h is not None:
                out.append(h)
    elif isinstance(raw_times, (list, tuple)):
        for item in raw_times:
            h = parse_hour(item)
            if h is not None:
                out.append(h)
    return out


def in_window(now_h, start_h, duration_h):
    """now_h có nằm trong [start_h, start_h + duration_h) không (cho phép qua nửa đêm)."""
    if duration_h <= 0:
        return False
    return ((now_h - start_h) % 24.0) < duration_h


def auto_photoperiod_windows(age_days):
    """Khung giờ bù quang kỳ tự động theo độ tuổi cây ớt (giờ VN).

    Trả về danh sách tuple (start_h, end_h).
    """
    age = 45
    if age_days is not None:
        try:
            age = max(1, int(round(float(age_days))))
        except (TypeError, ValueError):
            age = 45
    if age <= 25:
        # Giai đoạn 1: Cây con và bén rễ (cần ~16 giờ sáng/ngày)
        return [(5.0, 6.0), (17.5, 21.5)]
    if age <= 55:
        # Giai đoạn 2: Phân cành chảng ba (cần ~15 giờ sáng/ngày)
        return [(5.5, 6.0), (17.5, 21.0)]
    if age <= 135:
        # Giai đoạn 3-4: Ra hoa, đậu quả & nuôi quả non (cần ~14 giờ sáng/ngày)
        return [(17.5, 20.5)]
    if age <= 220:
        # Giai đoạn 5: Thu hoạch rộ nhiều đợt (cần ~13 giờ sáng/ngày)
        return [(17.5, 19.5)]
    # Giai đoạn 6: Cuối vụ và phục hồi đất
    return [(17.5, 18.5)]


def decide_pump(mode, desired, moisture, low, high, current_on, now_h, times, duration_min, clock_ok):
    """Quyết định trạng thái máy bơm (Relay 2). Trả (on: bool, reason: str)."""
    if mode == MODE_MANUAL:
        return bool(desired), "manual"
    if mode == MODE_AUTO:
        if moisture is None:
            return False, "auto: không có số liệu độ ẩm mới -> tắt"
        if low is None or high is None:
            return False, "auto: thiếu ngưỡng"
        if high <= low:
            high = low + 5.0
        if moisture < low:
            return True, "auto: độ ẩm %.1f < low %.1f" % (moisture, low)
        if moisture > high:
            return False, "auto: độ ẩm %.1f > high %.1f" % (moisture, high)
        return bool(current_on), "auto: trong vùng trễ [%.1f, %.1f]" % (low, high)
    if mode == MODE_SCHEDULE:
        if not clock_ok:
            return False, "schedule: chưa đồng bộ giờ -> tắt"
        dur_min = max(0.0, float(duration_min or 0.0))
        dur_h = dur_min / 60.0
        for t in (times or []):
            if t is not None and in_window(now_h, t, dur_h):
                return True, "schedule: khung %s (+%g phút)" % (format_hour_hm(t), dur_min)
        return False, "schedule: ngoài khung giờ"
    return False, "chế độ không hợp lệ"


def decide_light(mode, desired, now_h, on_h, off_h, clock_ok,
                 age_days=None, air_temp=None, max_temp_c=35.0, min_temp_c=18.0,
                 current_on=False, extra_windows=None, slot_times=None,
                 duration_min=None, schedule_style="window"):
    """Quyết định trạng thái đèn chiếu sáng (Relay 1). Trả (on: bool, reason: str)."""
    if mode == MODE_MANUAL:
        return bool(desired), "manual"

    if mode == MODE_AUTO:
        # 1) Bảo vệ quá nhiệt theo cảm biến DHT20
        if air_temp is not None and max_temp_c is not None and air_temp > max_temp_c:
            return False, "auto: nhiệt độ %.1f°C > %.1f°C -> ngắt bảo vệ" % (air_temp, max_temp_c)
        # 2) Bù ấm khi nhiệt độ xuống thấp (kèm vùng trễ +1.5°C chống nhấp nháy relay)
        if air_temp is not None and min_temp_c is not None:
            if air_temp < min_temp_c:
                return True, "auto: nhiệt độ %.1f°C < %.1f°C -> bật bù nhiệt" % (air_temp, min_temp_c)
            if current_on and air_temp < (min_temp_c + 1.5):
                return True, "auto: giữ bù nhiệt trong vùng trễ (%.1f°C)" % air_temp
        # 3) Tự động bù quang kỳ theo giai đoạn sinh trưởng cây trồng
        if not clock_ok:
            return False, "auto: chưa đồng bộ giờ -> tắt"
        windows = auto_photoperiod_windows(age_days)
        for w_on, w_off in windows:
            dur = (w_off - w_on) % 24.0
            if in_window(now_h, w_on, dur):
                return True, "auto: bù quang kỳ %s-%s" % (format_hour_hm(w_on), format_hour_hm(w_off))
        return False, "auto: ngoài khung bù quang kỳ"

    if mode == MODE_SCHEDULE:
        if not clock_ok:
            return False, "schedule: chưa đồng bộ giờ -> tắt"
        # Hỗ trợ kiểu lập lịch theo cữ + thời lượng (tương tự máy bơm)
        use_slots = (schedule_style == "slots") or (
            slot_times and on_h is None and off_h is None
        )
        if use_slots:
            if not slot_times:
                return False, "schedule: thiếu mốc giờ bật đèn"
            dur_min = max(0.0, float(duration_min or 120.0))
            dur_h = dur_min / 60.0
            for t in slot_times:
                if t is not None and in_window(now_h, t, dur_h):
                    return True, "schedule: cữ %s (+%g phút)" % (format_hour_hm(t), dur_min)
            return False, "schedule: ngoài khung giờ"

        # Kiểu lập lịch theo khoảng giờ Bật -> Tắt (hỗ trợ khung chính + khung phụ)
        windows = []
        if on_h is not None and off_h is not None:
            windows.append((on_h, off_h))
        if extra_windows:
            for pair in extra_windows:
                if pair and pair[0] is not None and pair[1] is not None:
                    windows.append((pair[0], pair[1]))
        if not windows:
            return False, "schedule: thiếu light_time"
        for w_on, w_off in windows:
            dur = (w_off - w_on) % 24.0
            if in_window(now_h, w_on, dur):
                return True, "schedule: %s-%s" % (format_hour_hm(w_on), format_hour_hm(w_off))
        return False, "schedule: ngoài khung giờ"

    return False, "chế độ không hợp lệ"


def _get(d, *keys):
    for k in keys:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


def _load_jetson_gpio():
    """Nạp thư viện GPIO trên Jetson Nano (ưu tiên Jetson.GPIO, dự phòng RPi.GPIO)."""
    try:
        import Jetson.GPIO as GPIO  # có sẵn trên JetPack
        return GPIO
    except ImportError:
        import RPi.GPIO as GPIO  # dự phòng nếu cài wrapper của Waveshare
        return GPIO


class RelayOutput(object):
    def __init__(self, name, channel, pin, active_low, gpio=None):
        self.name = name
        self.channel = channel
        self.pin = pin
        self.active_low = active_low
        self.gpio = gpio
        self.state = False
        if gpio is not None and pin and pin > 0:
            gpio.setup(pin, gpio.OUT, initial=self._level(False))

    def _level(self, on):
        g = self.gpio
        if self.active_low:
            return g.LOW if on else g.HIGH
        return g.HIGH if on else g.LOW

    def set(self, on, reason=""):
        on = bool(on)
        if self.gpio is not None and self.pin and self.pin > 0:
            self.gpio.output(self.pin, self._level(on))
        if on != self.state:
            log.info("[%s] Relay %d (%s, chân %s) -> %s (%s)",
                     "Waveshare GPIO" if self.gpio else "GIẢ LẬP",
                     self.channel, self.name, self.pin,
                     "BẬT" if on else "TẮT", reason)
        self.state = on


class RelayController(object):
    def __init__(self, cfg, gpio=None):
        self.cfg = cfg
        self._lock = threading.RLock()
        self._gpio = None
        self.pin_mode = str(getattr(cfg, "pin_mode", "BOARD") or "BOARD").upper()
        if self.pin_mode not in ("BOARD", "BCM"):
            self.pin_mode = "BOARD"
        spare_pin = int(getattr(cfg, "spare_pin", 0) or 0)
        is_sim_flag = bool(getattr(cfg, "simulate", False))

        if gpio is not None:
            self._gpio = gpio
            mode_val = getattr(gpio, self.pin_mode, None)
            if hasattr(gpio, "setwarnings"):
                gpio.setwarnings(False)
            if mode_val is not None and hasattr(gpio, "setmode"):
                gpio.setmode(mode_val)
        elif getattr(cfg, "relay_enabled", False) and not is_sim_flag:
            try:
                g = _load_jetson_gpio()
                g.setwarnings(False)
                g.setmode(g.BCM if self.pin_mode == "BCM" else g.BOARD)
                self._gpio = g
                log.info(
                    "Waveshare 3CH Relay THẬT (%s): Relay 1 (đèn)=chân %d, Relay 2 (máy bơm)=chân %d, "
                    "Relay 3 (dự phòng)=%s, active_low=%s",
                    self.pin_mode, cfg.light_pin, cfg.pump_pin,
                    ("chân %d" % spare_pin) if spare_pin > 0 else "bỏ qua",
                    cfg.active_low,
                )
            except Exception as e:  # noqa: BLE001
                log.error("Không khởi tạo được GPIO cho Waveshare 3CH Relay (%s) -> chuyển sang GIẢ LẬP", e)
                self._gpio = None

        self.simulated = self._gpio is None
        # Relay 1 = Đèn chiếu sáng (CH1), Relay 2 = Máy bơm (CH2), Relay 3 = Dự phòng (CH3)
        self.light = RelayOutput("light", RELAY_CH_LIGHT, cfg.light_pin, cfg.active_low, self._gpio)
        self.pump = RelayOutput("pump", RELAY_CH_PUMP, cfg.pump_pin, cfg.active_low, self._gpio)
        self.spare = (
            RelayOutput("spare_ch3", RELAY_CH_SPARE, spare_pin, cfg.active_low, self._gpio)
            if spare_pin > 0 else None
        )
        self.outputs = {"light": self.light, "pump": self.pump}
        self.remote = {}
        self.last_error = None
        self.reasons = {"pump": "", "light": ""}
        self._lockouts = {"pump": False, "light": False}
        self._stats = {}
        for name in self.outputs:
            self._stats[name] = {
                "on_since": None,
                "last_on_time": "",
                "daily_sec": 0.0,
                "day": None,
                "last_reported": None,
                "last_report_mono": 0.0,
            }
        self._last_eval_mono = None
        self.all_off("khởi động")

    # ------------------------------------------------------------------ input
    def update_remote(self, streaming):
        if isinstance(streaming, dict):
            with self._lock:
                self.remote = streaming

    # ------------------------------------------------------------- evaluation
    def _check_safety_lockout(self, name, want, reason, now_m, max_run_min, label_vi):
        if max_run_min is None or max_run_min <= 0:
            return want, reason
        max_run_sec = float(max_run_min) * 60.0
        out = self.outputs[name]
        on_since = self._stats[name]["on_since"]
        if want and out.state and on_since is not None and now_m - on_since >= max_run_sec:
            self._lockouts[name] = True
            self.last_error = "%s chạy liên tục quá %g phút -> tắt an toàn" % (label_vi, max_run_min)
            log.warning(self.last_error)
        if not want and self._lockouts[name]:
            self._lockouts[name] = False
            log.info("Bỏ khoá an toàn %s (lệnh mong muốn đã về TẮT)", label_vi.lower())
        if self._lockouts[name]:
            return False, "khoá an toàn (quá thời gian chạy tối đa)"
        return want, reason

    def evaluate(self, now_ts, clock_ok, moisture, air_temp=None):
        with self._lock:
            cfgd = self.remote.get("config") or {}
            ctl = self.remote.get("control") or {}
            now_m = time.monotonic()
            self._account(now_ts, now_m, clock_ok)
            now_h = vn_hour_float(now_ts)

            # ---- Relay 2 (CH2): Máy bơm nước ----
            irr_mode = parse_mode(cfgd.get("irrigation_mode"))
            low = parse_float(_get(cfgd, "threshold", "soil_moisture", "low"), 40.0)
            high = parse_float(_get(cfgd, "threshold", "soil_moisture", "high"), 80.0)
            times = extract_schedule_slots(cfgd.get("irrigation_time"))
            default_irr_dur = getattr(self.cfg, "default_irrigation_duration_min", 5.0)
            duration = parse_float(cfgd.get("irrigation_duration_min"), default_irr_dur)
            if duration is None or duration <= 0:
                duration = default_irr_dur

            want_p, reason_p = decide_pump(
                irr_mode, to_bool(_get(ctl, "pump", "status")), moisture, low, high,
                self.pump.state, now_h, times, duration, clock_ok,
            )
            want_p, reason_p = self._check_safety_lockout(
                "pump", want_p, reason_p, now_m,
                getattr(self.cfg, "max_pump_run_min", 30.0), "Máy bơm",
            )
            self._apply("pump", want_p, reason_p, now_ts, now_m)

            # ---- Relay 1 (CH1): Đèn chiếu sáng ----
            light_mode = parse_mode(cfgd.get("light_mode"))
            lt = cfgd.get("light_time") if isinstance(cfgd.get("light_time"), dict) else {}
            on_h = parse_hour(lt.get("on"))
            off_h = parse_hour(lt.get("off"))
            extra_windows = []
            on2_h = parse_hour(lt.get("on2"))
            off2_h = parse_hour(lt.get("off2"))
            if on2_h is not None and off2_h is not None:
                extra_windows.append((on2_h, off2_h))
            light_slots = extract_schedule_slots(lt)
            schedule_style = str(lt.get("mode") or "window").strip().lower()
            default_light_dur = getattr(self.cfg, "default_light_duration_min", 120.0)
            light_dur = parse_float(cfgd.get("light_duration_min"), default_light_dur)
            if light_dur is None or light_dur <= 0:
                light_dur = default_light_dur

            age_days = parse_float(_get(cfgd, "plant", "age_days"), 45.0)
            light_auto_cfg = cfgd.get("light_auto") if isinstance(cfgd.get("light_auto"), dict) else {}
            max_temp_c = parse_float(
                light_auto_cfg.get("max_temp_c"),
                getattr(self.cfg, "light_max_temp_c", 35.0),
            )
            min_temp_c = parse_float(
                light_auto_cfg.get("min_temp_c"),
                parse_float(_get(cfgd, "threshold", "soil_temperature", "low"), 18.0),
            )

            want_l, reason_l = decide_light(
                light_mode, to_bool(_get(ctl, "light", "status")), now_h, on_h, off_h, clock_ok,
                age_days=age_days, air_temp=air_temp, max_temp_c=max_temp_c, min_temp_c=min_temp_c,
                current_on=self.light.state, extra_windows=extra_windows,
                slot_times=light_slots, duration_min=light_dur, schedule_style=schedule_style,
            )
            want_l, reason_l = self._check_safety_lockout(
                "light", want_l, reason_l, now_m,
                getattr(self.cfg, "max_light_run_min", 960.0), "Đèn chiếu sáng",
            )
            self._apply("light", want_l, reason_l, now_ts, now_m)

    def _account(self, now_ts, now_m, clock_ok):
        """Cộng dồn thời gian BẬT trong ngày (giờ VN), reset khi sang ngày mới."""
        dt = 0.0 if self._last_eval_mono is None else max(0.0, now_m - self._last_eval_mono)
        self._last_eval_mono = now_m
        today = vn_date_str(now_ts) if clock_ok else None
        for name, out in self.outputs.items():
            st = self._stats[name]
            if today is not None and st["day"] != today:
                if st["day"] is not None:
                    st["daily_sec"] = 0.0
                st["day"] = today
            if out.state:
                st["daily_sec"] += dt

    def _apply(self, name, on, reason, now_ts, now_m):
        out = self.outputs[name]
        st = self._stats[name]
        if on and not out.state:
            st["on_since"] = now_m
            st["last_on_time"] = vn_time_str(now_ts)
        elif not on:
            st["on_since"] = None
        self.reasons[name] = reason
        out.set(on, reason)

    # -------------------------------------------------------------- reporting
    def report_payload(self, name):
        with self._lock:
            st = self._stats[name]
            return {
                "actual": self.outputs[name].state,
                "simulated": self.simulated,
                "last_on_time": st["last_on_time"],
                "daily_time": round(st["daily_sec"] / 3600.0, 4),
                "updated_at": SERVER_TIMESTAMP,
            }

    def needs_report(self, name):
        with self._lock:
            st = self._stats[name]
            prev = st["last_reported"]
            if prev is None:
                return True
            if prev.get("actual") != self.outputs[name].state or prev.get("last_on_time") != st["last_on_time"]:
                return True
            return time.monotonic() - st["last_report_mono"] >= self.cfg.relay_report_every_sec

    def mark_reported(self, name, payload):
        with self._lock:
            self._stats[name]["last_reported"] = dict(payload)
            self._stats[name]["last_report_mono"] = time.monotonic()

    def summary(self):
        with self._lock:
            return dict(
                (n, {
                    "on": o.state,
                    "channel": o.channel,
                    "pin": o.pin,
                    "pin_mode": self.pin_mode,
                    "simulated": self.simulated,
                    "reason": self.reasons[n],
                })
                for n, o in self.outputs.items()
            )

    # --------------------------------------------------------------- shutdown
    def all_off(self, reason="tắt toàn bộ"):
        with self._lock:
            for name, out in self.outputs.items():
                try:
                    out.set(False, reason)
                    self._stats[name]["on_since"] = None
                except Exception as e:  # noqa: BLE001
                    log.error("Không tắt được relay %s: %s", name, e)
            if self.spare is not None:
                try:
                    self.spare.set(False, reason)
                except Exception as e:  # noqa: BLE001
                    log.debug("Không tắt được kênh dự phòng CH3: %s", e)

    def shutdown(self):
        self.all_off("thoát chương trình")
        if self._gpio is not None:
            pins = [p for p in (self.light.pin, self.pump.pin, self.spare.pin if self.spare else 0) if p and p > 0]
            if pins:
                try:
                    self._gpio.cleanup(pins)
                except Exception as e:  # noqa: BLE001
                    log.debug("GPIO cleanup: %s", e)
