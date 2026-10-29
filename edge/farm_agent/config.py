# -*- coding: utf-8 -*-
"""Đọc cấu hình INI (configparser) và áp dụng tham số dòng lệnh.

Mọi khoá đều có giá trị mặc định (DEFAULTS) => file config chỉ cần ghi
những gì khác mặc định. Đường dẫn tương đối được tính từ thư mục `edge/`.
"""
import configparser
import os

MIN_INTERVAL_SEC = 5
MAX_INTERVAL_SEC = 86400
DEFAULT_INTERVAL_SEC = 300

DEFAULTS = {
    "device": {
        "device_id": "jetson-nano-01",
    },
    "firebase": {
        "db_url": "",
        "api_key": "",
        "email": "",
        "password": "",
        "timeout_sec": "15",
        "identity_url": "https://identitytoolkit.googleapis.com/v1",
        "securetoken_url": "https://securetoken.googleapis.com/v1",
    },
    "sampling": {
        "sampling_interval_sec": str(DEFAULT_INTERVAL_SEC),
        "align_to_wall_clock": "true",
        "use_remote_interval": "true",
    },
    "soil": {
        "enabled": "true",
        "port": "/dev/ttyUSB0",
        "slave_id": "2",
        "baudrate": "9600",
        "timeout_sec": "0.5",
        "retries": "1",
    },
    "dht20": {
        "enabled": "true",
        "i2c_bus": "0",
        "address": "0x38",
        "retries": "1",
    },
    "timesync": {
        "ntp_servers": "pool.ntp.org, time.google.com",
        "max_offset_sec": "2.0",
        "sntp_timeout_sec": "2.0",
        "use_timedatectl": "true",
        "use_sntp": "true",
        "check_unsynced_sec": "15",
        "check_synced_sec": "600",
        "trust_system_clock": "false",
        # 2024-01-01T00:00:00Z: bản ghi "estimated" có ts nhỏ hơn => cách ly, không upload
        "min_valid_epoch": "1704067200",
    },
    "network": {
        "check_timeout_sec": "3",
        "force_offline_file": "FORCE_OFFLINE",
    },
    "upload": {
        "batch_size": "500",
        "queue_max_rows": "500000",
        "backoff_initial_sec": "5",
        "backoff_max_sec": "300",
        "idle_poll_sec": "2",
        "failed_log_max": "1000",
    },
    "heartbeat": {
        "max_heartbeat_sec": "15",
        "control_poll_sec": "5",
        "live_enabled": "true",
        "live_interval_sec": "15",
    },
    "relay": {
        "relay_enabled": "false",
        "pump_pin": "31",
        "light_pin": "33",
        "active_low": "true",
        "max_pump_run_min": "30",
        "default_irrigation_duration_min": "5",
        "report_every_sec": "60",
    },
    "paths": {
        "data_dir": "data",
        "log_dir": "logs",
    },
    "simulate": {
        "fail_prob": "0.0",
        "moisture_start": "55",
        "seed": "",
    },
    "logging": {
        "level": "INFO",
    },
}


def clamp_interval(value, default=DEFAULT_INTERVAL_SEC):
    """Ép chu kỳ lấy mẫu về khoảng [5, 86400] giây; giá trị rác => default."""
    try:
        v = int(round(float(value)))
    except (TypeError, ValueError):
        return default
    return max(MIN_INTERVAL_SEC, min(MAX_INTERVAL_SEC, v))


def _split_list(text):
    return [x.strip() for x in str(text).split(",") if x.strip()]


def _abs_path(base_dir, p):
    p = os.path.expanduser(p)
    if os.path.isabs(p):
        return p
    return os.path.normpath(os.path.join(base_dir, p))


class AgentConfig(object):
    """Đối tượng cấu hình phẳng (thuộc tính = khoá cấu hình)."""

    def public_dict(self):
        hidden = ("password", "api_key")
        return dict((k, ("***" if (k in hidden and v) else v)) for k, v in self.__dict__.items())


def load_config(path=None, base_dir=None, args=None):
    """Đọc file INI (nếu có) rồi ghi đè bằng tham số CLI (`args` từ argparse)."""
    if base_dir is None:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cp = configparser.ConfigParser(interpolation=None)
    cp.read_dict(DEFAULTS)
    if path:
        if not os.path.exists(path):
            raise IOError("Không tìm thấy file cấu hình: %s" % path)
        with open(path, encoding="utf-8") as f:
            cp.read_file(f)

    c = AgentConfig()
    c.config_path = os.path.abspath(path) if path else None
    c.base_dir = base_dir

    c.device_id = cp.get("device", "device_id").strip() or "jetson-nano-01"

    c.db_url = cp.get("firebase", "db_url").strip().rstrip("/")
    c.api_key = cp.get("firebase", "api_key").strip()
    c.email = cp.get("firebase", "email").strip()
    c.password = cp.get("firebase", "password")
    c.http_timeout = cp.getfloat("firebase", "timeout_sec")
    c.identity_url = cp.get("firebase", "identity_url").strip().rstrip("/")
    c.securetoken_url = cp.get("firebase", "securetoken_url").strip().rstrip("/")

    c.sampling_interval_sec = clamp_interval(cp.get("sampling", "sampling_interval_sec"))
    c.align_to_wall_clock = cp.getboolean("sampling", "align_to_wall_clock")
    c.use_remote_interval = cp.getboolean("sampling", "use_remote_interval")

    c.soil_enabled = cp.getboolean("soil", "enabled")
    c.soil_port = cp.get("soil", "port").strip()
    c.soil_slave_id = cp.getint("soil", "slave_id")
    c.soil_baudrate = cp.getint("soil", "baudrate")
    c.soil_timeout = cp.getfloat("soil", "timeout_sec")
    c.soil_retries = max(0, cp.getint("soil", "retries"))

    c.dht_enabled = cp.getboolean("dht20", "enabled")
    c.dht_bus = cp.getint("dht20", "i2c_bus")
    c.dht_address = int(cp.get("dht20", "address").strip(), 0)
    c.dht_retries = max(0, cp.getint("dht20", "retries"))

    c.ntp_servers = _split_list(cp.get("timesync", "ntp_servers"))
    c.max_offset_sec = cp.getfloat("timesync", "max_offset_sec")
    c.sntp_timeout = cp.getfloat("timesync", "sntp_timeout_sec")
    c.use_timedatectl = cp.getboolean("timesync", "use_timedatectl")
    c.use_sntp = cp.getboolean("timesync", "use_sntp")
    c.check_unsynced_sec = max(5.0, cp.getfloat("timesync", "check_unsynced_sec"))
    c.check_synced_sec = max(30.0, cp.getfloat("timesync", "check_synced_sec"))
    c.trust_system_clock = cp.getboolean("timesync", "trust_system_clock")
    c.min_valid_epoch = cp.getfloat("timesync", "min_valid_epoch")
    c.fake_sync_delay = None

    c.net_timeout = cp.getfloat("network", "check_timeout_sec")
    c.force_offline = False
    flag = cp.get("network", "force_offline_file").strip()

    c.batch_size = max(1, min(500, cp.getint("upload", "batch_size")))
    c.queue_max_rows = max(100, cp.getint("upload", "queue_max_rows"))
    c.backoff_initial_sec = max(1.0, cp.getfloat("upload", "backoff_initial_sec"))
    c.backoff_max_sec = max(c.backoff_initial_sec, cp.getfloat("upload", "backoff_max_sec"))
    c.idle_poll_sec = max(0.5, cp.getfloat("upload", "idle_poll_sec"))
    c.failed_log_max = max(10, cp.getint("upload", "failed_log_max"))

    c.max_heartbeat_sec = max(5, cp.getint("heartbeat", "max_heartbeat_sec"))
    c.control_poll_sec = max(1.0, cp.getfloat("heartbeat", "control_poll_sec"))
    c.live_enabled = cp.getboolean("heartbeat", "live_enabled")
    c.live_interval_sec = max(5.0, cp.getfloat("heartbeat", "live_interval_sec"))

    c.relay_enabled = cp.getboolean("relay", "relay_enabled")
    c.pump_pin = cp.getint("relay", "pump_pin")
    c.light_pin = cp.getint("relay", "light_pin")
    c.active_low = cp.getboolean("relay", "active_low")
    c.max_pump_run_min = max(1.0, cp.getfloat("relay", "max_pump_run_min"))
    c.default_irrigation_duration_min = max(1.0, cp.getfloat("relay", "default_irrigation_duration_min"))
    c.relay_report_every_sec = max(5.0, cp.getfloat("relay", "report_every_sec"))

    c.data_dir = _abs_path(base_dir, cp.get("paths", "data_dir"))
    c.log_dir = _abs_path(base_dir, cp.get("paths", "log_dir"))

    c.sim_fail_prob = max(0.0, min(1.0, cp.getfloat("simulate", "fail_prob")))
    c.sim_moisture_start = cp.getfloat("simulate", "moisture_start")
    seed = cp.get("simulate", "seed").strip()
    c.sim_seed = int(seed) if seed else None

    c.log_level = cp.get("logging", "level").strip().upper() or "INFO"

    c.simulate = False
    c.replay_path = None

    # ---- Ghi đè bằng tham số dòng lệnh ----
    if args is not None:
        if getattr(args, "simulate", False):
            c.simulate = True
        if getattr(args, "replay", None):
            c.simulate = True
            c.replay_path = os.path.abspath(args.replay)
        if getattr(args, "offline", False):
            c.force_offline = True
        if getattr(args, "assume_synced", False):
            c.trust_system_clock = True
        if getattr(args, "fake_sync_delay", None) is not None:
            c.fake_sync_delay = max(0.0, float(args.fake_sync_delay))
        if getattr(args, "interval", None):
            c.sampling_interval_sec = clamp_interval(args.interval)
        if getattr(args, "device_id", None):
            c.device_id = args.device_id
        if getattr(args, "data_dir", None):
            c.data_dir = os.path.abspath(args.data_dir)
        if getattr(args, "log_dir", None):
            c.log_dir = os.path.abspath(args.log_dir)
        if getattr(args, "log_level", None):
            c.log_level = args.log_level.upper()
        mock = getattr(args, "mock_url", None)
        if mock:
            mock = mock.rstrip("/")
            c.db_url = mock
            # Mock server cũng giả lập Identity Toolkit / Secure Token
            c.identity_url = mock + "/__auth/v1"
            c.securetoken_url = mock + "/__auth/v1"

    c.force_offline_file = _abs_path(c.data_dir, flag) if flag else None
    return c
