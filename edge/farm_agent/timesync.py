# -*- coding: utf-8 -*-
"""Kiểm tra / theo dõi đồng bộ giờ NTP (Jetson Nano không có RTC có pin).

Bằng chứng đồng bộ:
  1. `timedatectl status` -> "System clock synchronized: yes" (18.04)
     hoặc "NTP synchronized: yes" (16.04).
  2. Truy vấn SNTP (UDP 123) tới pool.ntp.org / time.google.com -> độ lệch.
Quy tắc quyết định:
  - Có kết quả SNTP: synced  <=>  |offset| < max_offset_sec (mặc định 2 s).
  - Không có SNTP (mất mạng): synced nếu timedatectl = yes, HOẶC trước đó trong
    CÙNG lần boot đã từng đồng bộ (đồng hồ hệ thống vẫn chạy đúng – "dính").
  - Không có bằng chứng nào: synced = trust_system_clock (mặc định false).
Khi chuyển chưa đồng bộ -> đồng bộ, ghi mốc (sync_wall, sync_mono) và hiệu chỉnh
ngược mọi bản ghi 'pending' của boot hiện tại: ts = sync_wall - (sync_mono - mono).
"""
import logging
import os
import socket
import struct
import subprocess
import sys
import threading
import time

log = logging.getLogger("farm_agent.timesync")

NTP_DELTA = 2208988800  # giây từ 1900-01-01 tới 1970-01-01


def _ntp_to_unix(sec, frac):
    return sec - NTP_DELTA + frac / 4294967296.0


def sntp_query(server, port=123, timeout=2.0):
    """Gửi 1 gói SNTP (client mode). Trả (offset_s, delay_s). Lỗi -> exception."""
    from .netcheck import resolve_with_timeout  # tránh treo DNS khi mất mạng

    infos = resolve_with_timeout(server, port, timeout, socket.AF_INET, socket.SOCK_DGRAM)
    if not infos:
        raise OSError("không phân giải được %s" % server)
    addr = infos[0][4]
    pkt = bytearray(48)
    pkt[0] = 0x23  # LI=0, VN=4, Mode=3 (client)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        t1 = time.time()
        tx_sec = (int(t1) + NTP_DELTA) & 0xFFFFFFFF
        tx_frac = int((t1 % 1.0) * 4294967296.0) & 0xFFFFFFFF
        struct.pack_into("!II", pkt, 40, tx_sec, tx_frac)
        s.sendto(bytes(pkt), addr)
        data, _ = s.recvfrom(512)
        t4 = time.time()
    finally:
        s.close()
    if len(data) < 48:
        raise ValueError("gói NTP quá ngắn")
    mode = data[0] & 0x07
    stratum = data[1]
    if mode not in (4, 5) or stratum == 0 or stratum > 15:
        raise ValueError("phản hồi NTP không hợp lệ (mode=%d stratum=%d)" % (mode, stratum))
    orig = struct.unpack("!II", data[24:32])
    if orig != (tx_sec, tx_frac):
        raise ValueError("origin timestamp không khớp")
    t2 = _ntp_to_unix(*struct.unpack("!II", data[32:40]))
    t3 = _ntp_to_unix(*struct.unpack("!II", data[40:48]))
    offset = ((t2 - t1) + (t3 - t4)) / 2.0
    delay = (t4 - t1) - (t3 - t2)
    return offset, delay


def timedatectl_synced():
    """True/False theo timedatectl; None nếu không chạy được (không phải Linux...)."""
    if not sys.platform.startswith("linux"):
        return None
    env = dict(os.environ)
    env["LANG"] = "C"
    env["LC_ALL"] = "C"
    try:
        res = subprocess.run(
            ["timedatectl", "status"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, env=env
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return parse_timedatectl(res.stdout.decode("utf-8", "replace"))


def parse_timedatectl(text):
    for line in text.splitlines():
        low = line.strip().lower()
        for prefix in ("system clock synchronized:", "ntp synchronized:"):
            if low.startswith(prefix):
                return low[len(prefix):].strip() == "yes"
    return None


class TimeSync(object):
    def __init__(self, cfg, queue, boot_id, on_synced=None):
        self.cfg = cfg
        self.queue = queue
        self.boot_id = boot_id
        self.on_synced = on_synced  # callback khi vừa chuyển sang đồng bộ (vd: căn lại lịch đo)
        self._lock = threading.Lock()
        self._start_mono = time.monotonic()
        self.synced = False
        self.offset_ms = None
        self.source = None
        self.last_check_wall = None
        self.anchor = None  # (sync_wall, sync_mono)
        self._prev_skew = None
        self._wake = threading.Event()
        # Cùng boot, tiến trình trước đã từng đồng bộ => đồng hồ hệ thống vẫn đúng
        self._sticky = False
        try:
            self._sticky = queue.get_meta("synced_boot_id") == boot_id
        except Exception:  # noqa: BLE001
            pass

    # ---------------------------------------------------------------- public
    def is_synced(self):
        return self.synced

    def status(self):
        with self._lock:
            return {
                "synced": self.synced,
                "offset_ms": self.offset_ms,
                "source": self.source,
                "anchor": self.anchor,
            }

    def request_check(self):
        self._wake.set()

    def run(self, stop_event):
        while not stop_event.is_set():
            try:
                self.check()
            except Exception:  # noqa: BLE001
                log.exception("Lỗi kiểm tra đồng bộ giờ")
            wait = self.cfg.check_synced_sec if self.synced else self.cfg.check_unsynced_sec
            if self.cfg.fake_sync_delay is not None and not self.synced:
                wait = 1.0
            end = time.monotonic() + wait
            while not stop_event.is_set() and time.monotonic() < end:
                if self._wake.wait(min(1.0, end - time.monotonic())):
                    self._wake.clear()
                    break

    def check(self):
        """Thu thập bằng chứng (có thể mất vài giây) rồi quyết định trạng thái."""
        cfg = self.cfg
        td = None
        sntp_offset = None
        sntp_server = None
        if cfg.fake_sync_delay is not None:
            # Chế độ kiểm thử: coi như chưa đồng bộ trong N giây đầu
            new_synced = (time.monotonic() - self._start_mono) >= cfg.fake_sync_delay
            source = "fake"
        else:
            if cfg.use_timedatectl:
                td = timedatectl_synced()
            if cfg.use_sntp and not cfg.force_offline:
                for server in cfg.ntp_servers:
                    host, port = server, 123
                    if server.count(":") == 1:  # cho phép "host:port" (dùng khi test)
                        host, _, p = server.partition(":")
                        port = int(p)
                    try:
                        off, delay = sntp_query(host, port=port, timeout=cfg.sntp_timeout)
                        sntp_offset, sntp_server = off, server
                        log.debug("SNTP %s: offset=%.3f s delay=%.3f s", server, off, delay)
                        break
                    except Exception as e:  # noqa: BLE001
                        log.debug("SNTP %s lỗi: %s", server, e)
            if sntp_offset is not None:
                new_synced = abs(sntp_offset) < cfg.max_offset_sec
                source = "sntp:%s" % sntp_server
                if not new_synced:
                    log.warning(
                        "Đồng hồ hệ thống lệch %.1f s so với %s (> %.1f s) -> coi là CHƯA đồng bộ; "
                        "chờ systemd-timesyncd chỉnh giờ", sntp_offset, sntp_server, cfg.max_offset_sec)
            elif td is True:
                new_synced, source = True, "timedatectl"
            elif self.synced or self._sticky:
                new_synced, source = True, "sticky"
            elif cfg.trust_system_clock:
                new_synced, source = True, "trusted"
            else:
                new_synced, source = False, ("timedatectl" if td is False else "none")

        # Phát hiện đồng hồ bị nhảy (bước chỉnh giờ) giữa 2 lần kiểm tra
        skew = time.time() - time.monotonic()
        if self._prev_skew is not None and abs(skew - self._prev_skew) > cfg.max_offset_sec:
            log.warning("Đồng hồ hệ thống vừa nhảy %.1f s", skew - self._prev_skew)
        self._prev_skew = skew

        with self._lock:
            was = self.synced
            just_synced = False
            self.offset_ms = round(sntp_offset * 1000.0, 1) if sntp_offset is not None else None
            self.source = source
            self.last_check_wall = time.time()
            if new_synced and not was:
                self.synced = True
                just_synced = True
                sync_wall, sync_mono = time.time(), time.monotonic()
                self.anchor = (sync_wall, sync_mono)
                n = self.queue.correct_boot(self.boot_id, sync_wall, sync_mono)
                self.queue.set_meta("synced_boot_id", self.boot_id)
                log.info("Đồng hồ ĐÃ đồng bộ (nguồn=%s, offset=%s ms) -> hiệu chỉnh %d bản ghi của boot hiện tại",
                         source, self.offset_ms, n)
            elif was and not new_synced:
                self.synced = False
                self._sticky = False
                log.warning("Mất trạng thái đồng bộ giờ (nguồn=%s)", source)
        if just_synced and self.on_synced is not None:
            try:
                self.on_synced()
            except Exception:  # noqa: BLE001
                log.exception("Lỗi callback on_synced")
        return self.synced
