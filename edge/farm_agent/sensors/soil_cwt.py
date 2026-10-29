# -*- coding: utf-8 -*-
"""Cảm biến đất CWT 7in1 qua RS485 (USB-RS485) – Modbus RTU.

Logic lấy nguyên từ script đã chạy thật `read_soil.py`:
  /dev/ttyUSB0, slave 2, 9600 8N1, timeout 0.5 s, FC=3, đọc thanh ghi 0..7
  [0] độ ẩm /10 (%), [1] nhiệt độ có dấu /10 (°C), [2] EC (µS/cm),
  [3] pH (tự nhận độ phân giải 0.01 hoặc 0.1), [4..6] N, P, K (mg/kg)
Khác biệt duy nhất: EC được đổi µS/cm -> mS/cm (/1000) cho trường `EC` của Firebase.
"""
import logging
import time

from . import SensorError

log = logging.getLogger("farm_agent.sensors.soil")


def to_signed_16(val):
    """Chuyển số nguyên 16-bit không dấu sang có dấu (dành cho nhiệt độ âm)."""
    return val - 65536 if val >= 32768 else val


def decode_registers(raw):
    """Giải mã mảng thanh ghi thô -> dict trường Firebase."""
    if raw is None or len(raw) < 7:
        raise SensorError("Thiếu thanh ghi: %r" % (raw,))
    moisture = raw[0] / 10.0                    # độ phân giải 0.1 %
    soiltemp = to_signed_16(raw[1]) / 10.0      # độ phân giải 0.1 °C
    ec_us = raw[2]                              # µS/cm
    ph = raw[3] / 100.0 if raw[3] > 140 else raw[3] / 10.0   # tự nhận độ phân giải pH
    return {
        "moisture": round(moisture, 1),
        "soiltemp": round(soiltemp, 1),
        "EC": round(ec_us / 1000.0, 3),         # µS/cm -> mS/cm
        "pH": round(ph, 2),
        "N": float(raw[4]),
        "P": float(raw[5]),
        "K": float(raw[6]),
    }


class SoilSensorCWT(object):
    name = "soil"

    def __init__(self, port="/dev/ttyUSB0", slave_id=2, baudrate=9600, timeout=0.5, retries=1):
        self.port = port
        self.slave_id = slave_id
        self.baudrate = baudrate
        self.timeout = timeout
        self.retries = retries
        self._inst = None

    def _open(self):
        import minimalmodbus  # import lười: chỉ cần trên Jetson
        import serial

        inst = minimalmodbus.Instrument(self.port, self.slave_id)
        inst.serial.baudrate = self.baudrate
        inst.serial.bytesize = 8
        inst.serial.parity = serial.PARITY_NONE
        inst.serial.stopbits = 1
        inst.serial.timeout = self.timeout
        inst.mode = minimalmodbus.MODE_RTU
        inst.clear_buffers_before_each_transaction = True
        return inst

    def close(self):
        inst, self._inst = self._inst, None
        if inst is None:
            return
        try:
            inst.serial.close()
        except Exception:  # noqa: BLE001
            pass
        # minimalmodbus giữ cache cổng serial theo tên cổng -> xoá để lần sau mở lại sạch
        try:
            import minimalmodbus

            getattr(minimalmodbus, "_serialports", {}).pop(self.port, None)
        except Exception:  # noqa: BLE001
            pass

    def read_raw(self):
        if self._inst is None:
            self._inst = self._open()
        return self._inst.read_registers(registeraddress=0, number_of_registers=8, functioncode=3)

    def read(self):
        """Đọc 1 lần; lỗi thì đóng cổng và thử lại `retries` lần (mặc định 1)."""
        last_exc = None
        for attempt in range(self.retries + 1):
            try:
                return decode_registers(self.read_raw())
            except Exception as e:  # noqa: BLE001
                last_exc = e
                log.debug("Modbus lỗi (lần %d): %s", attempt + 1, e)
                self.close()
                if attempt < self.retries:
                    time.sleep(0.3)
        raise SensorError("CWT %s slave %s: %s" % (self.port, self.slave_id, last_exc))
