# -*- coding: utf-8 -*-
"""Cảm biến giả lập cho chế độ --simulate / --replay (chạy trên PC).

- SimulatedEnvironment: số liệu tổng hợp có chu kỳ ngày-đêm (giờ VN), độ ẩm
  đất giảm dần do bốc hơi và TĂNG khi bơm (relay demo) đang bật => có thể
  quan sát chế độ tưới auto hoạt động khép kín.
- ReplaySource: phát lại tuần tự các bản ghi trong `frontend/public/soil_all.json`
  (bỏ trường `light`), mốc thời gian là thời điểm hiện tại.
"""
import json
import math
import random
import threading
import time

from . import SensorError
from ..timeutil import vn_hour_float

SOIL_FIELDS = ("soiltemp", "moisture", "pH", "EC", "N", "P", "K")
DHT_FIELDS = ("temperature", "humidity")


class _FnSensor(object):
    def __init__(self, name, fn):
        self.name = name
        self._fn = fn

    def read(self):
        return self._fn()


class SimulatedEnvironment(object):
    def __init__(self, moisture_start=55.0, fail_prob=0.0, seed=None, pump_state_fn=None):
        self._rnd = random.Random(seed)
        self._fail_prob = fail_prob
        self._pump_state_fn = pump_state_fn
        self._lock = threading.Lock()
        self._moisture = float(moisture_start)
        self._last_mono = time.monotonic()
        self._n = 280.0
        self._p = 800.0
        self._k = 850.0

    def _maybe_fail(self, name):
        if self._fail_prob > 0 and self._rnd.random() < self._fail_prob:
            raise SensorError("lỗi giả lập (%s)" % name)

    def _sun(self, ts):
        """Cường độ nắng tương đối 0..1 (6h-18h)."""
        h = vn_hour_float(ts)
        return max(0.0, math.sin(math.pi * (h - 6.0) / 12.0))

    def _step_moisture(self, ts):
        now = time.monotonic()
        dt = max(0.0, min(3600.0, now - self._last_mono))
        self._last_mono = now
        pump_on = False
        try:
            pump_on = bool(self._pump_state_fn()) if self._pump_state_fn else False
        except Exception:  # noqa: BLE001
            pump_on = False
        # bốc hơi: ~2 %/giờ ban đêm, ~6 %/giờ buổi trưa
        evap = (0.0006 + 0.0011 * self._sun(ts)) * dt
        gain = 0.25 * dt if pump_on else 0.0  # bơm: +15 %/phút (demo nhanh)
        self._moisture = max(15.0, min(92.0, self._moisture - evap + gain))
        return self._moisture

    def read_dht(self):
        self._maybe_fail("dht20")
        ts = time.time()
        h = vn_hour_float(ts)
        diurnal = math.sin(2 * math.pi * (h - 9.0) / 24.0)
        temp = 28.0 + 5.0 * diurnal + self._rnd.gauss(0, 0.25)
        hum = 72.0 - 14.0 * diurnal + self._rnd.gauss(0, 0.8)
        return {"temperature": round(temp, 2), "humidity": round(max(5.0, min(100.0, hum)), 2)}

    def read_soil(self):
        self._maybe_fail("soil")
        ts = time.time()
        with self._lock:
            m = self._step_moisture(ts)
            self._n = max(0.0, self._n + self._rnd.gauss(0, 0.5))
            self._p = max(0.0, self._p + self._rnd.gauss(0, 0.8))
            self._k = max(0.0, self._k + self._rnd.gauss(0, 0.8))
            n, p, k = self._n, self._p, self._k
        h = vn_hour_float(ts)
        soiltemp = 26.5 + 2.5 * math.sin(2 * math.pi * (h - 11.0) / 24.0) + self._rnd.gauss(0, 0.1)
        ec = 1.0 + 0.006 * (m - 40.0) + self._rnd.gauss(0, 0.01)
        ph = 6.2 + self._rnd.gauss(0, 0.03)
        return {
            "moisture": round(m + self._rnd.gauss(0, 0.2), 1),
            "soiltemp": round(soiltemp, 1),
            "EC": round(max(0.0, ec), 3),
            "pH": round(ph, 2),
            "N": float(round(n)),
            "P": float(round(p)),
            "K": float(round(k)),
        }

    def soil_sensor(self):
        return _FnSensor("soil", self.read_soil)

    def dht_sensor(self):
        return _FnSensor("dht20", self.read_dht)


class ReplaySource(object):
    """Phát lại dữ liệu lịch sử từ file JSON dạng {"data": {date: {time: record}}}."""

    def __init__(self, path, fail_prob=0.0, seed=None):
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        data = doc.get("data", doc) if isinstance(doc, dict) else {}
        records = []
        for day in sorted(data):
            items = data[day]
            if not isinstance(items, dict):
                continue
            for t in sorted(items):
                rec = items[t]
                if isinstance(rec, dict):
                    records.append(rec)
        if not records:
            raise ValueError("File replay không có bản ghi: %s" % path)
        self._records = records
        self._idx = -1
        self._lock = threading.Lock()
        self._rnd = random.Random(seed)
        self._fail_prob = fail_prob

    def __len__(self):
        return len(self._records)

    def _pick(self, fields, advance):
        if self._fail_prob > 0 and self._rnd.random() < self._fail_prob:
            raise SensorError("lỗi giả lập (replay)")
        with self._lock:
            if advance or self._idx < 0:
                self._idx = (self._idx + 1) % len(self._records)
            rec = self._records[self._idx]
        out = {}
        for k in fields:
            v = rec.get(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                out[k] = float(v)
        if not out:
            raise SensorError("bản ghi replay thiếu trường %s" % (fields,))
        return out

    def soil_sensor(self):
        # Cảm biến đất được đọc trước => nó là bên "tiến" con trỏ bản ghi
        return _FnSensor("soil", lambda: self._pick(SOIL_FIELDS, True))

    def dht_sensor(self):
        return _FnSensor("dht20", lambda: self._pick(DHT_FIELDS, False))
