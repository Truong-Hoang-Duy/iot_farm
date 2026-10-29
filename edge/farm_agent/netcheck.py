# -*- coding: utf-8 -*-
"""Kiểm tra mạng trước khi gửi: phân giải DNS host Firebase + TCP connect (timeout 3 s).

Host/port lấy từ db_url => với --mock-url http://127.0.0.1:PORT sẽ kiểm tra đúng
mock server thay vì cổng 443.
Ép offline: tham số --offline, hoặc tạo file cờ `data/FORCE_OFFLINE` lúc đang chạy
(xoá file để có mạng trở lại) – tiện demo bộ đệm offline mà không cần rút dây mạng.
"""
import logging
import os
import socket
import threading
import time

try:
    from urllib.parse import urlparse
except ImportError:  # pragma: no cover
    from urlparse import urlparse  # type: ignore

log = logging.getLogger("farm_agent.net")


def resolve_with_timeout(host, port, timeout, family=0, socktype=socket.SOCK_STREAM):
    """getaddrinfo không có timeout -> chạy trong thread phụ để giới hạn thời gian."""
    result = {}

    def worker():
        try:
            result["infos"] = socket.getaddrinfo(host, port, family, socktype)
        except Exception as e:  # noqa: BLE001
            result["error"] = e

    t = threading.Thread(target=worker, name="dns-resolve")
    t.daemon = True
    t.start()
    t.join(timeout)
    if t.is_alive():
        raise socket.timeout("DNS timeout (%.1f s)" % timeout)
    if "error" in result:
        raise result["error"]
    return result.get("infos") or []


class NetChecker(object):
    def __init__(self, db_url, timeout=3.0, force_offline=False, flag_file=None):
        p = urlparse(db_url or "")
        self.host = p.hostname
        self.port = p.port or (443 if p.scheme == "https" else 80)
        self.timeout = timeout
        self.force_offline = force_offline
        self.flag_file = flag_file
        self._lock = threading.Lock()
        self._last = None  # (ok, err, mono)

    def last(self):
        return self._last

    def check(self, max_age=0.0):
        """Trả (ok, error). max_age > 0: dùng kết quả cache nếu còn mới."""
        with self._lock:
            if max_age > 0 and self._last is not None and time.monotonic() - self._last[2] < max_age:
                return self._last[0], self._last[1]
        ok, err = self._do_check()
        with self._lock:
            prev = self._last
            self._last = (ok, err, time.monotonic())
        if prev is None or prev[0] != ok:
            if ok:
                log.info("Mạng OK (%s:%s)", self.host, self.port)
            else:
                log.warning("Mất kết nối tới Firebase: %s", err)
        return ok, err

    def _do_check(self):
        if self.force_offline:
            return False, "ép offline (--offline)"
        if self.flag_file and os.path.exists(self.flag_file):
            return False, "ép offline (file cờ %s)" % os.path.basename(self.flag_file)
        if not self.host:
            return False, "chưa cấu hình firebase.db_url"
        try:
            infos = resolve_with_timeout(self.host, self.port, self.timeout)
        except Exception as e:  # noqa: BLE001
            return False, "DNS %s: %s" % (self.host, e)
        last_err = None
        for family, socktype, proto, _, addr in infos:
            s = None
            try:
                s = socket.socket(family, socktype, proto)
                s.settimeout(self.timeout)
                s.connect(addr)
                return True, None
            except Exception as e:  # noqa: BLE001
                last_err = e
            finally:
                if s is not None:
                    try:
                        s.close()
                    except Exception:  # noqa: BLE001
                        pass
        return False, "TCP %s:%s: %s" % (self.host, self.port, last_err)


def local_ip(target_host=None):
    """IP LAN của máy (mẹo UDP connect – không gửi gói tin nào)."""
    for host in (target_host, "8.8.8.8"):
        if not host:
            continue
        s = None
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect((host, 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("0."):
                return ip
        except Exception:  # noqa: BLE001
            pass
        finally:
            if s is not None:
                s.close()
    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:  # noqa: BLE001
        return None
