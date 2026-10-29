# -*- coding: utf-8 -*-
"""Cảm biến nhiệt độ/độ ẩm không khí DHT20 qua I2C.

Logic lấy nguyên từ script đã chạy thật `read_dht20.py`:
  Jetson Nano chân 27 (SDA) / 28 (SCL) = /dev/i2c-0, địa chỉ 0x38,
  kiểm tra hiệu chuẩn (0x71 & 0x18), lệnh đo 0xAC [0x33, 0x00], chờ 80 ms,
  chờ bit busy, đọc 7 byte, kiểm tra CRC-8 (đa thức 0x31, khởi tạo 0xFF).
"""
import logging
import time

from . import SensorError

log = logging.getLogger("farm_agent.sensors.dht20")


def calc_crc8(data):
    """Tính CRC-8 (đa thức 0x31, khởi tạo 0xFF)."""
    crc = 0xFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x80:
                crc = ((crc << 1) ^ 0x31) & 0xFF
            else:
                crc = (crc << 1) & 0xFF
    return crc


def decode_frame(data):
    """7 byte (6 dữ liệu + CRC) -> (temperature °C, humidity %RH)."""
    if len(data) < 7:
        raise SensorError("Khung DHT20 thiếu byte")
    if calc_crc8(data[:6]) != data[6]:
        raise SensorError("Lỗi CRC: dữ liệu truyền qua I2C bị nhiễu")
    raw_humidity = (data[1] << 12) | (data[2] << 4) | (data[3] >> 4)
    humidity = (raw_humidity / 1048576.0) * 100.0
    raw_temp = ((data[3] & 0x0F) << 16) | (data[4] << 8) | data[5]
    temperature = (raw_temp / 1048576.0) * 200.0 - 50.0
    return round(temperature, 2), round(humidity, 2)


class DHT20Sensor(object):
    name = "dht20"

    def __init__(self, bus=0, address=0x38, retries=1):
        self.bus_no = bus
        self.address = address
        self.retries = retries
        self._bus = None
        self._last_read_mono = 0.0

    def _open(self):
        from smbus2 import SMBus  # import lười

        bus = SMBus(self.bus_no)
        try:
            time.sleep(0.1)  # đợi tối thiểu 100 ms sau khi cấp nguồn
            status = bus.read_byte_data(self.address, 0x71)
            if (status & 0x18) != 0x18:
                log.info("Đang khởi tạo lại thanh ghi cảm biến DHT20...")
                bus.write_i2c_block_data(self.address, 0xBE, [0x08, 0x00])
                time.sleep(0.01)
        except Exception:
            bus.close()
            raise
        return bus

    def close(self):
        bus, self._bus = self._bus, None
        if bus is not None:
            try:
                bus.close()
            except Exception:  # noqa: BLE001
                pass

    def _read_once(self):
        from smbus2 import i2c_msg

        if self._bus is None:
            self._bus = self._open()
        # DHT20 khuyến nghị 2 lần đọc cách nhau >= 1.5-2 s
        wait = 1.5 - (time.monotonic() - self._last_read_mono)
        if 0 < wait <= 1.5:
            time.sleep(wait)
        bus = self._bus
        bus.write_i2c_block_data(self.address, 0xAC, [0x33, 0x00])
        time.sleep(0.08)  # chờ >= 80 ms để hoàn tất chuyển đổi ADC
        retry = 0
        while (bus.read_byte(self.address) & 0x80) != 0:
            time.sleep(0.01)
            retry += 1
            if retry >= 10:
                raise SensorError("DHT20 phản hồi quá thời gian chờ (busy)")
        msg = i2c_msg.read(self.address, 7)
        bus.i2c_rdwr(msg)
        self._last_read_mono = time.monotonic()
        return decode_frame(list(msg))

    def read(self):
        last_exc = None
        for attempt in range(self.retries + 1):
            try:
                temperature, humidity = self._read_once()
                return {"temperature": temperature, "humidity": humidity}
            except Exception as e:  # noqa: BLE001
                last_exc = e
                log.debug("DHT20 lỗi (lần %d): %s", attempt + 1, e)
                if not isinstance(e, SensorError):
                    self.close()  # lỗi I/O -> mở lại bus
                if attempt < self.retries:
                    time.sleep(0.5)
        raise SensorError("DHT20 i2c-%s@0x%02X: %s" % (self.bus_no, self.address, last_exc))
