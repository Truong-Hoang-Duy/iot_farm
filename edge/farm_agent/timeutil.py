# -*- coding: utf-8 -*-
"""Tiện ích thời gian.

- Giờ Việt Nam được tính bằng độ lệch CỐ ĐỊNH UTC+7 (không phụ thuộc múi giờ
  của hệ điều hành, vì Jetson có thể đang để TZ=UTC).
- boot_id: định danh lần khởi động hiện tại (Linux); dùng để biết bản ghi nào
  thuộc lần boot nào => chỉ hiệu chỉnh được mốc thời gian của lần boot hiện tại.
"""
import datetime
import time
import uuid

VN_OFFSET_SEC = 7 * 3600
_EPOCH = datetime.datetime(1970, 1, 1)
_PROCESS_BOOT_ID = None
_PROCESS_START_MONO = time.monotonic()


def vn_datetime(ts):
    """epoch UTC (giây) -> datetime 'naive' theo giờ VN (UTC+7).

    Dùng phép cộng timedelta thuần tuý => không bao giờ phụ thuộc TZ hệ thống
    và không lỗi với timestamp nhỏ trên Windows.
    """
    return _EPOCH + datetime.timedelta(seconds=float(ts) + VN_OFFSET_SEC)


def record_key(ts):
    """Key Firebase của một bản ghi: 'YYYY-MM-DD/HH:MM:SS' (giờ VN)."""
    return vn_datetime(int(round(ts))).strftime("%Y-%m-%d/%H:%M:%S")


def vn_date_str(ts):
    return vn_datetime(ts).strftime("%Y-%m-%d")


def vn_time_str(ts):
    return vn_datetime(ts).strftime("%Y-%m-%d %H:%M:%S")


def vn_hour_float(ts):
    """Giờ trong ngày (giờ VN) dạng số thực, ví dụ 6.5 = 06:30."""
    dt = vn_datetime(ts)
    return dt.hour + dt.minute / 60.0 + dt.second / 3600.0


def get_boot_id():
    """boot_id của Linux; nếu không có (Windows/macOS) dùng UUID ngẫu nhiên theo tiến trình."""
    global _PROCESS_BOOT_ID
    try:
        with open("/proc/sys/kernel/random/boot_id") as f:
            value = f.read().strip()
            if value:
                return value
    except (IOError, OSError):
        pass
    if _PROCESS_BOOT_ID is None:
        _PROCESS_BOOT_ID = "proc-" + uuid.uuid4().hex
    return _PROCESS_BOOT_ID


def system_uptime_sec():
    """Thời gian hệ thống đã chạy (giây). Không có /proc/uptime thì trả uptime tiến trình."""
    try:
        with open("/proc/uptime") as f:
            return float(f.read().split()[0])
    except (IOError, OSError, ValueError, IndexError):
        return time.monotonic() - _PROCESS_START_MONO


def process_uptime_sec():
    return time.monotonic() - _PROCESS_START_MONO
