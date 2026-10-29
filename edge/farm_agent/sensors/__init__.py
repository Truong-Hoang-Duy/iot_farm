# -*- coding: utf-8 -*-
"""Cảm biến: CWT 7in1 (RS485/Modbus), DHT20 (I2C) và bộ giả lập.

Thư viện phần cứng (minimalmodbus, serial, smbus2) chỉ được import khi mở
thiết bị thật => chế độ --simulate chạy được trên PC không cài các thư viện đó.
"""
import logging

log = logging.getLogger("farm_agent.sensors")


class SensorError(Exception):
    pass


class SensorSuite(object):
    """Gom 2 cảm biến; đọc từng cái độc lập (cho phép đọc thiếu 1 cảm biến)."""

    def __init__(self, soil, dht, simulated=False):
        self.soil = soil
        self.dht = dht
        self.simulated = simulated

    def _ok_label(self):
        return "simulated" if self.simulated else "ok"

    def read_all(self):
        """Trả (fields, status, errors).

        fields: dict các trường đo được (đúng tên trường Firebase)
        status: {"soil": "ok|error|simulated|disabled", "dht20": ...}
        errors: {"soil": "thông báo lỗi", ...}
        """
        fields, status, errors = {}, {}, {}
        for name, sensor in (("soil", self.soil), ("dht20", self.dht)):
            if sensor is None:
                status[name] = "disabled"
                continue
            try:
                fields.update(sensor.read())
                status[name] = self._ok_label()
            except Exception as e:  # noqa: BLE001 - mọi lỗi phần cứng đều không được làm sập vòng lặp
                status[name] = "error"
                errors[name] = "%s: %s" % (type(e).__name__, e)
        return fields, status, errors

    def read_soil(self):
        """Chỉ đọc cảm biến đất (dùng cho điều khiển bơm auto). Lỗi => None."""
        if self.soil is None:
            return None
        try:
            return self.soil.read()
        except Exception as e:  # noqa: BLE001
            log.debug("Đọc nhanh cảm biến đất lỗi: %s", e)
            return None

    def close(self):
        for s in (self.soil, self.dht):
            try:
                if s is not None and hasattr(s, "close"):
                    s.close()
            except Exception:  # noqa: BLE001
                pass


def build_sensors(cfg, pump_state_fn=None):
    """Tạo SensorSuite theo cấu hình (thật hoặc giả lập)."""
    if cfg.simulate:
        from .simulated import SimulatedEnvironment, ReplaySource

        if cfg.replay_path:
            src = ReplaySource(cfg.replay_path, fail_prob=cfg.sim_fail_prob, seed=cfg.sim_seed)
            soil, dht = src.soil_sensor(), src.dht_sensor()
        else:
            env = SimulatedEnvironment(
                moisture_start=cfg.sim_moisture_start,
                fail_prob=cfg.sim_fail_prob,
                seed=cfg.sim_seed,
                pump_state_fn=pump_state_fn,
            )
            soil, dht = env.soil_sensor(), env.dht_sensor()
        if not cfg.soil_enabled:
            soil = None
        if not cfg.dht_enabled:
            dht = None
        return SensorSuite(soil, dht, simulated=True)

    from .soil_cwt import SoilSensorCWT
    from .dht20 import DHT20Sensor

    soil = None
    dht = None
    if cfg.soil_enabled:
        soil = SoilSensorCWT(
            port=cfg.soil_port,
            slave_id=cfg.soil_slave_id,
            baudrate=cfg.soil_baudrate,
            timeout=cfg.soil_timeout,
            retries=cfg.soil_retries,
        )
    if cfg.dht_enabled:
        dht = DHT20Sensor(bus=cfg.dht_bus, address=cfg.dht_address, retries=cfg.dht_retries)
    return SensorSuite(soil, dht, simulated=False)
