# -*- coding: utf-8 -*-
"""Relay demo: bơm (pump) + đèn (light).

Chế độ đọc từ Firebase `streaming/config`:
  irrigation_mode: 0 manual  -> theo `streaming/control/pump/status` (UI ghi)
                   1 auto    -> trễ (hysteresis) theo độ ẩm đất mới nhất:
                                BẬT khi moisture < threshold/soil_moisture/low,
                                TẮT khi moisture > threshold/soil_moisture/high
                   2 schedule-> bật tại giờ irrigation_time/time1, time2 (giờ 0-23,
                                có thể là số hoặc "HH:MM") trong irrigation_duration_min phút
  light_mode:      0 hoặc ''  -> manual theo `streaming/control/light/status`
                   2 schedule -> bật trong khoảng light_time/on .. light_time/off (giờ)
                   1 auto     -> chưa có cảm biến ánh sáng => xử lý như schedule
An toàn: bơm chạy liên tục quá max_pump_run_min -> tắt và khoá cho tới khi lệnh
mong muốn trở về TẮT; mọi relay TẮT khi khởi động / thoát / SIGTERM.
Báo cáo về `streaming/control/{pump|light}`: actual, simulated, last_on_time,
daily_time (giờ, reset mỗi ngày theo giờ VN), updated_at. KHÔNG BAO GIỜ ghi `status`.
Mặc định relay_enabled=false => chỉ giả lập (ghi log), không đụng GPIO.
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
            if not s:
                return None
            if ":" in s:
                parts = s.split(":")
                h = int(parts[0]) + int(parts[1]) / 60.0
            else:
                h = float(s)
    except (TypeError, ValueError, IndexError):
        return None
    if h < 0 or h >= 24:
        return None
    return h


def parse_float(v, default=None):
    try:
        if v is None or isinstance(v, bool):
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def in_window(now_h, start_h, duration_h):
    """now_h có nằm trong [start_h, start_h + duration_h) không (cho phép qua nửa đêm)."""
    if duration_h <= 0:
        return False
    return ((now_h - start_h) % 24.0) < duration_h


def decide_pump(mode, desired, moisture, low, high, current_on, now_h, times, duration_min, clock_ok):
    """Quyết định trạng thái bơm. Trả (on: bool, reason: str)."""
    if mode == MODE_MANUAL:
        return bool(desired), "manual"
    if mode == MODE_AUTO:
        if moisture is None:
            return False, "auto: không có số liệu độ ẩm mới -> tắt"
        if low is None or high is None:
            return False, "auto: thiếu ngưỡng"
        if moisture < low:
            return True, "auto: độ ẩm %.1f < low %.1f" % (moisture, low)
        if moisture > high:
            return False, "auto: độ ẩm %.1f > high %.1f" % (moisture, high)
        return bool(current_on), "auto: trong vùng trễ [%.1f, %.1f]" % (low, high)
    if mode == MODE_SCHEDULE:
        if not clock_ok:
            return False, "schedule: chưa đồng bộ giờ -> tắt"
        dur_h = max(0.0, float(duration_min)) / 60.0
        for t in times:
            if t is not None and in_window(now_h, t, dur_h):
                return True, "schedule: khung %.2fh (+%g phút)" % (t, duration_min)
        return False, "schedule: ngoài khung giờ"
    return False, "chế độ không hợp lệ"


def decide_light(mode, desired, now_h, on_h, off_h, clock_ok):
    if mode in (MODE_SCHEDULE, MODE_AUTO):
        if not clock_ok:
            return False, "schedule: chưa đồng bộ giờ -> tắt"
        if on_h is None or off_h is None:
            return False, "schedule: thiếu light_time"
        dur = (off_h - on_h) % 24.0
        if in_window(now_h, on_h, dur):
            return True, "schedule: %.2fh-%.2fh" % (on_h, off_h)
        return False, "schedule: ngoài khung giờ"
    return bool(desired), "manual"


def _get(d, *keys):
    for k in keys:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


class RelayOutput(object):
    def __init__(self, name, pin, active_low, gpio=None):
        self.name = name
        self.pin = pin
        self.active_low = active_low
        self.gpio = gpio
        self.state = False
        if gpio is not None:
            gpio.setup(pin, gpio.OUT, initial=self._level(False))

    def _level(self, on):
        g = self.gpio
        if self.active_low:
            return g.LOW if on else g.HIGH
        return g.HIGH if on else g.LOW

    def set(self, on, reason=""):
        on = bool(on)
        if self.gpio is not None:
            self.gpio.output(self.pin, self._level(on))
        if on != self.state:
            log.info("[%s] relay %s -> %s (%s)", "GPIO" if self.gpio else "GIẢ LẬP", self.name,
                     "BẬT" if on else "TẮT", reason)
        self.state = on


class RelayController(object):
    def __init__(self, cfg):
        self.cfg = cfg
        self._lock = threading.RLock()
        self._gpio = None
        if cfg.relay_enabled:
            try:
                import Jetson.GPIO as GPIO  # import lười: có sẵn trên JetPack

                GPIO.setwarnings(False)
                GPIO.setmode(GPIO.BOARD)
                self._gpio = GPIO
                log.info("Relay THẬT: bơm=chân %d, đèn=chân %d (BOARD), active_low=%s",
                         cfg.pump_pin, cfg.light_pin, cfg.active_low)
            except Exception as e:  # noqa: BLE001
                log.error("Không khởi tạo được Jetson.GPIO (%s) -> chuyển sang relay GIẢ LẬP", e)
                self._gpio = None
        self.simulated = self._gpio is None
        self.pump = RelayOutput("pump", cfg.pump_pin, cfg.active_low, self._gpio)
        self.light = RelayOutput("light", cfg.light_pin, cfg.active_low, self._gpio)
        self.outputs = {"pump": self.pump, "light": self.light}
        self.remote = {}
        self.last_error = None
        self.reasons = {"pump": "", "light": ""}
        self._pump_lockout = False
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
    def evaluate(self, now_ts, clock_ok, moisture):
        with self._lock:
            cfgd = self.remote.get("config") or {}
            ctl = self.remote.get("control") or {}
            now_m = time.monotonic()
            self._account(now_ts, now_m, clock_ok)
            now_h = vn_hour_float(now_ts)

            # ---- Bơm
            irr_mode = parse_mode(cfgd.get("irrigation_mode"))
            low = parse_float(_get(cfgd, "threshold", "soil_moisture", "low"), 40.0)
            high = parse_float(_get(cfgd, "threshold", "soil_moisture", "high"), 80.0)
            itimes = cfgd.get("irrigation_time")
            if not isinstance(itimes, dict):
                itimes = {}
            times = [parse_hour(itimes.get("time1")), parse_hour(itimes.get("time2"))]
            duration = parse_float(cfgd.get("irrigation_duration_min"), self.cfg.default_irrigation_duration_min)
            if duration is None or duration <= 0:
                duration = self.cfg.default_irrigation_duration_min
            want, reason = decide_pump(
                irr_mode, to_bool(_get(ctl, "pump", "status")), moisture, low, high,
                self.pump.state, now_h, times, duration, clock_ok,
            )
            max_run = self.cfg.max_pump_run_min * 60.0
            on_since = self._stats["pump"]["on_since"]
            if want and self.pump.state and on_since is not None and now_m - on_since >= max_run:
                self._pump_lockout = True
                self.last_error = "Bơm chạy liên tục quá %g phút -> tắt an toàn" % self.cfg.max_pump_run_min
                log.warning(self.last_error)
            if not want and self._pump_lockout:
                self._pump_lockout = False
                log.info("Bỏ khoá an toàn bơm (lệnh mong muốn đã về TẮT)")
            if self._pump_lockout:
                want, reason = False, "khoá an toàn (quá thời gian chạy tối đa)"
            self._apply("pump", want, reason, now_ts, now_m)

            # ---- Đèn
            light_mode = parse_mode(cfgd.get("light_mode"))
            lt = cfgd.get("light_time") or {}
            on_h = parse_hour(lt.get("on")) if isinstance(lt, dict) else None
            off_h = parse_hour(lt.get("off")) if isinstance(lt, dict) else None
            want_l, reason_l = decide_light(
                light_mode, to_bool(_get(ctl, "light", "status")), now_h, on_h, off_h, clock_ok
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
            return dict((n, {"on": o.state, "reason": self.reasons[n]}) for n, o in self.outputs.items())

    # --------------------------------------------------------------- shutdown
    def all_off(self, reason="tắt toàn bộ"):
        with self._lock:
            for name, out in self.outputs.items():
                try:
                    out.set(False, reason)
                    self._stats[name]["on_since"] = None
                except Exception as e:  # noqa: BLE001
                    log.error("Không tắt được relay %s: %s", name, e)

    def shutdown(self):
        self.all_off("thoát chương trình")
        if self._gpio is not None:
            try:
                self._gpio.cleanup([self.cfg.pump_pin, self.cfg.light_pin])
            except Exception as e:  # noqa: BLE001
                log.debug("GPIO cleanup: %s", e)
