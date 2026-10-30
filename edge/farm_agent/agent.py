# -*- coding: utf-8 -*-
"""FarmAgent: điều phối các luồng (thread) của edge agent.

Luồng:
  sampler   – đọc cảm biến mỗi sampling_interval_sec (căn theo mốc đồng hồ khi đã
              đồng bộ NTP), GHI VÀO SQLITE TRƯỚC rồi mới đánh thức uploader.
  uploader  – kiểm tra mạng -> PATCH multi-path tối đa 500 bản ghi/lô vào /data,
              xoá khỏi hàng đợi CHỈ khi HTTP 200; lỗi -> back-off luỹ thừa (tối đa 5 phút);
              ghi log mỗi lô vào logs/firebase_writes/{ngày} và logs/uploads.log.
  heartbeat – mỗi min(interval, 15 s) PATCH devices/{id}/status.
  control   – mỗi 5 s GET streaming (config + control) -> áp dụng interval ngay
              (không cần khởi động lại) và điều khiển relay demo.
  timesync  – kiểm tra NTP (timedatectl + SNTP), hiệu chỉnh mốc thời gian.
Mọi vòng lặp đều bắt mọi exception => không bao giờ làm sập tiến trình.
"""
import glob
import logging
import math
import os
import socket
import threading
import time

from . import __version__
from .config import clamp_interval
from .firebase_client import SERVER_TIMESTAMP, FirebaseAuth, FirebaseClient, error_text
from .netcheck import NetChecker, local_ip
from .queue_store import TQ_NTP, QueueStore
from .relay import MODE_AUTO, RelayController, parse_mode
from .sensors import build_sensors
from .timesync import TimeSync
from .timeutil import VN_OFFSET_SEC, get_boot_id, record_key, system_uptime_sec, vn_date_str

log = logging.getLogger("farm_agent.agent")
uplog = logging.getLogger("farm_agent.uploads")

RECORD_FIELDS = ("temperature", "humidity", "soiltemp", "moisture", "pH", "EC", "N", "P", "K")


def sanitize_payload(fields):
    """Chỉ giữ các trường hợp lệ theo hợp đồng, số thực hữu hạn (Firebase từ chối NaN)."""
    out = {}
    for k in RECORD_FIELDS:
        v = fields.get(k)
        if v is None or isinstance(v, bool):
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if math.isfinite(f):
            out[k] = f
    return out


def read_cpu_temp():
    """Nhiệt độ CPU (°C) từ /sys/devices/virtual/thermal/thermal_zone*/temp.

    Ưu tiên zone có type chứa 'CPU' (Jetson Nano: CPU-therm); bỏ PMIC-Die
    (luôn báo 100 °C trên Nano).
    """
    fallback = []
    for zone in sorted(glob.glob("/sys/devices/virtual/thermal/thermal_zone*")):
        try:
            with open(os.path.join(zone, "temp")) as f:
                t = int(f.read().strip()) / 1000.0
        except (IOError, OSError, ValueError):
            continue
        try:
            with open(os.path.join(zone, "type")) as f:
                typ = f.read().strip().lower()
        except (IOError, OSError):
            typ = ""
        if "cpu" in typ:
            return round(t, 1)
        if "pmic" in typ:
            continue
        if -40.0 < t < 125.0:
            fallback.append(t)
    return round(max(fallback), 1) if fallback else None


class FarmAgent(object):
    def __init__(self, cfg):
        self.cfg = cfg
        self.stop_event = threading.Event()
        self.sample_wake = threading.Event()
        self.upload_wake = threading.Event()
        self.retry_now = threading.Event()
        self.boot_id = get_boot_id()
        if not os.path.isdir(cfg.data_dir):
            os.makedirs(cfg.data_dir)
        self.queue = QueueStore(os.path.join(cfg.data_dir, "queue.db"), cfg.queue_max_rows, cfg.failed_log_max)
        self.auth = FirebaseAuth(cfg.api_key, cfg.email, cfg.password, cfg.identity_url,
                                 cfg.securetoken_url, cfg.http_timeout)
        self.client = FirebaseClient(cfg.db_url, self.auth, cfg.http_timeout)
        self.net = NetChecker(cfg.db_url, cfg.net_timeout, cfg.force_offline, cfg.force_offline_file)
        self.timesync = TimeSync(cfg, self.queue, self.boot_id, on_synced=self._on_synced)
        self.relay = RelayController(cfg)
        self.sensors = build_sensors(cfg, pump_state_fn=lambda: self.relay.pump.state)
        self._sensor_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self.interval = cfg.sampling_interval_sec
        ok_label = "simulated" if cfg.simulate else "ok"
        self.sensor_status = {
            "soil": ok_label if cfg.soil_enabled else "disabled",
            "dht20": ok_label if cfg.dht_enabled else "disabled",
        }
        self.latest = None
        self._latest_soil = None  # (moisture, mono)
        self._latest_air_temp = None  # (temperature, mono)
        self._last_read_mono = None
        self._live_dirty = False
        self._last_read_now_id = str(self.queue.get_meta("last_read_now_id", "") or "")
        self._errors = {}
        self.network_ok = False
        self._had_failures = False
        self._in_backoff = False
        self._last_finalize = -1e9
        self._threads = []
        self._hostname = socket.gethostname()
        self._ip = None
        self._ip_mono = -1e9

    # ------------------------------------------------------------ properties
    @property
    def heartbeat_sec(self):
        return int(min(self.interval, self.cfg.max_heartbeat_sec))

    @property
    def last_error(self):
        with self._state_lock:
            if not self._errors:
                return None
            src, (mono, msg) = max(self._errors.items(), key=lambda kv: kv[1][0])
            return "%s: %s" % (src, msg)

    def _set_error(self, source, msg):
        with self._state_lock:
            self._errors[source] = (time.monotonic(), str(msg)[:300])

    def _clear_error(self, source):
        with self._state_lock:
            self._errors.pop(source, None)

    # ------------------------------------------------------------- lifecycle
    def start(self):
        cfg = self.cfg
        log.info("=== IoT Farm edge agent v%s | device=%s | simulate=%s | relay=%s ===",
                 __version__, cfg.device_id, cfg.simulate, "GPIO" if not self.relay.simulated else "giả lập")
        log.info("db_url=%s | auth=%s | interval=%d s | boot_id=%s | data=%s",
                 cfg.db_url or "(chưa cấu hình)", "email/password" if self.auth.enabled else "không",
                 self.interval, self.boot_id, cfg.data_dir)
        if not cfg.db_url:
            log.warning("Chưa cấu hình firebase.db_url -> chỉ lưu dữ liệu offline vào SQLite")
        counts = self.queue.count_by_tq()
        if counts:
            log.info("Hàng đợi còn tồn: %s", counts)
        try:
            self.timesync.check()  # kiểm tra giờ ngay để bản ghi đầu tiên có tq chính xác
        except Exception:  # noqa: BLE001
            log.exception("Kiểm tra giờ lần đầu lỗi")
        specs = [
            ("sampler", self._sampler_loop),
            ("uploader", self._uploader_loop),
            ("heartbeat", self._heartbeat_loop),
            ("control", self._control_loop),
            ("timesync", lambda: self.timesync.run(self.stop_event)),
        ]
        for name, fn in specs:
            t = threading.Thread(target=self._guard, args=(name, fn), name=name)
            t.daemon = True
            t.start()
            self._threads.append(t)

    def _guard(self, name, fn):
        """Chạy lại vòng lặp nếu nó bị văng exception ngoài dự kiến."""
        while not self.stop_event.is_set():
            try:
                fn()
                return
            except Exception:  # noqa: BLE001
                log.exception("Luồng %s gặp lỗi không mong muốn -> khởi động lại sau 5 s", name)
                self.stop_event.wait(5.0)

    def request_stop(self):
        self.stop_event.set()
        self.sample_wake.set()
        self.upload_wake.set()
        self.retry_now.set()
        self.timesync.request_check()

    def shutdown(self):
        log.info("Đang dừng agent...")
        self.request_stop()
        for t in self._threads:
            t.join(timeout=20)
        try:
            self.relay.shutdown()
        except Exception:  # noqa: BLE001
            log.exception("Lỗi tắt relay")
        try:
            ok, _ = self.net.check(0)
            if ok:
                for dev in ("pump", "light"):
                    self.client.patch("streaming/control/%s" % dev, self.relay.report_payload(dev), timeout=4)
                self.client.patch("devices/%s/status" % self.cfg.device_id, {
                    "online": False,
                    "last_seen": SERVER_TIMESTAMP,
                    "device_time": int(time.time()),
                    "queue_pending": self.queue.count(),
                    "network_ok": False,
                    "ntp_synced": False,
                }, timeout=4)
        except Exception as e:  # noqa: BLE001
            log.debug("Không gửi được trạng thái offline: %s", e)
        self.sensors.close()
        log.info("Agent đã dừng. Hàng đợi còn %d bản ghi.", self.queue.count())
        self.queue.close()

    def _on_synced(self):
        """Vừa đồng bộ giờ: căn lại lịch đo theo mốc đồng hồ và đẩy ngay bản ghi đã hiệu chỉnh."""
        self.sample_wake.set()
        self.upload_wake.set()

    # --------------------------------------------------------------- sampler
    def _next_due_mono(self, last_sample_mono):
        interval = self.interval
        now, mono = time.time(), time.monotonic()
        if self.cfg.align_to_wall_clock and self.timesync.is_synced():
            # Căn theo mốc giờ VN: interval 300 -> :00, :05, :10 ...; 86400 -> 00:00 giờ VN
            local = now + VN_OFFSET_SEC
            target = (math.floor((local + 0.5) / interval) + 1) * interval
            return mono + (target - local)
        base = last_sample_mono if last_sample_mono is not None else mono
        return max(mono, base + interval)

    def _sampler_loop(self):
        last_mono = None
        first = True
        while not self.stop_event.is_set():
            due = time.monotonic() if first else self._next_due_mono(last_mono)
            interrupted = False
            while not self.stop_event.is_set():
                rem = due - time.monotonic()
                if rem <= 0:
                    break
                if self.sample_wake.wait(min(rem, 1.0)):
                    self.sample_wake.clear()
                    interrupted = True
                    break
            if self.stop_event.is_set():
                break
            if interrupted:
                continue  # interval vừa đổi -> tính lại mốc kế tiếp
            first = False
            last_mono = time.monotonic()
            try:
                self._sample_once()
            except Exception:  # noqa: BLE001
                log.exception("Lỗi lấy mẫu")
                self._set_error("sampler", "lỗi lấy mẫu")

    def _read_sensors_locked(self):
        with self._sensor_lock:
            fields, status, errors = self.sensors.read_all()
        mono = time.monotonic()
        payload = sanitize_payload(fields)
        with self._state_lock:
            self.sensor_status.update(status)
            if payload:
                self.latest = payload
                self._last_read_mono = mono
                if "moisture" in payload:
                    self._latest_soil = (payload["moisture"], mono)
                if "temperature" in payload:
                    self._latest_air_temp = (payload["temperature"], mono)
        for name in ("soil", "dht20"):
            if name in errors:
                log.warning("Cảm biến %s lỗi: %s", name, errors[name])
                self._set_error(name, errors[name])
            else:
                self._clear_error(name)
        return payload, status, errors

    def _sample_once(self):
        wall, mono = time.time(), time.monotonic()
        synced = self.timesync.is_synced()
        payload, status, _ = self._read_sensors_locked()
        if not payload:
            log.error("Không đọc được cảm biến nào -> bỏ qua mẫu này")
            return None
        rid = self.queue.add(wall, mono, self.boot_id, synced, payload, status)
        if not synced and self.timesync.is_synced():
            # NTP vừa đồng bộ trong lúc đang đọc cảm biến -> hiệu chỉnh luôn bản ghi này
            anchor = self.timesync.anchor
            if anchor:
                self.queue.correct_boot(self.boot_id, anchor[0], anchor[1])
        with self._state_lock:
            self._live_dirty = True
        log.info("Mẫu #%d %s tq=%s %s", rid, record_key(wall), "ntp" if synced else "pending(chưa đồng bộ giờ)",
                 " ".join("%s=%g" % (k, payload[k]) for k in RECORD_FIELDS if k in payload))
        self.upload_wake.set()
        return rid

    # -------------------------------------------------------------- uploader
    def _uploader_loop(self):
        cfg = self.cfg
        backoff = 0.0
        while not self.stop_event.is_set():
            try:
                res = self._upload_once()
            except Exception:  # noqa: BLE001
                log.exception("Lỗi uploader")
                res = "fail"
            if res in ("ok", "more"):
                backoff = 0.0
                continue
            if res == "idle":
                backoff = 0.0
                self.upload_wake.wait(cfg.idle_poll_sec)
                self.upload_wake.clear()
                continue
            backoff = cfg.backoff_initial_sec if backoff <= 0 else min(backoff * 2.0, cfg.backoff_max_sec)
            log.info("Upload thất bại -> thử lại sau %.0f s (hàng đợi %d bản ghi)", backoff, self.queue.count())
            self._in_backoff = True
            self.retry_now.clear()
            self.retry_now.wait(backoff)  # heartbeat thành công sẽ đánh thức sớm
            self.retry_now.clear()
            self._in_backoff = False

    def _maybe_finalize_old_boots(self, net_ok):
        """Bản ghi 'pending' của boot cũ -> 'estimated' (chỉ khi đã có mạng)."""
        if not net_ok or time.monotonic() - self._last_finalize < 30:
            return 0
        self._last_finalize = time.monotonic()
        if self.queue.count_old_pending(self.boot_id) <= 0:
            return 0
        n_est, n_q = self.queue.finalize_old_boots(self.boot_id, self.cfg.min_valid_epoch)
        if n_est:
            log.warning("%d bản ghi của lần boot trước chưa từng được đồng bộ giờ -> upload với tq=estimated "
                        "(%d bị cách ly vì mốc thời gian vô lý)", n_est, n_q)
        return n_est

    def _upload_once(self):
        cfg = self.cfg
        rows = self.queue.next_batch(cfg.batch_size)
        if not rows:
            if (time.monotonic() - self._last_finalize >= 30
                    and self.queue.count_old_pending(self.boot_id) > 0):
                ok, _ = self.net.check(0)
                self.network_ok = ok
                if self._maybe_finalize_old_boots(ok):
                    return "more"
            return "idle"

        ok, err = self.net.check(0)
        self.network_ok = ok
        if not ok:
            self._record_failure(rows, None, None, None, "mạng: %s" % err, 0)
            return "fail"
        self._maybe_finalize_old_boots(ok)

        body = {}
        newest = None
        min_ts = None
        for r in rows:
            ts = r.ts if r.ts is not None else r.wall_ts
            key = record_key(ts)
            rec = dict(r.payload)
            rec["ts"] = int(round(ts))
            rec["tq"] = r.tq
            body[key] = rec
            if newest is None or ts > newest[0]:
                newest = (ts, key, rec)
            min_ts = ts if min_ts is None else min(min_ts, ts)
        keys = sorted(body)
        from_backlog = bool(
            self._had_failures
            or any(r.tq != TQ_NTP for r in rows)
            or (time.time() - min_ts) > max(2.0 * self.interval, 60.0)
        )
        t0 = time.monotonic()
        try:
            status, resp = self.client.patch("data", body)
        except Exception as e:  # noqa: BLE001 - requests/AuthError/...
            dur = int((time.monotonic() - t0) * 1000)
            self._record_failure(rows, keys, None, from_backlog, "%s: %s" % (type(e).__name__, e), dur)
            return "fail"
        dur = int((time.monotonic() - t0) * 1000)
        if status not in (200, 204):
            self._record_failure(rows, keys, status, from_backlog, error_text(status, resp), dur)
            return "fail"

        self.queue.delete_ids([r.id for r in rows])
        pending = self.queue.count()
        entry = self._log_entry("ok", len(body), keys[0], keys[-1], status, dur, pending, from_backlog, None)
        self._write_upload_line(entry)
        log.info("Upload OK %d bản ghi [%s .. %s] %d ms, còn %d, backlog=%s",
                 len(body), keys[0], keys[-1], dur, pending, from_backlog)
        self._had_failures = False
        self._clear_error("upload")
        self._post_log(entry)
        self._update_last_reading(newest)
        self._flush_failed_logs()
        return "more" if len(rows) >= cfg.batch_size else "ok"

    def _log_entry(self, status, n, first_key, last_key, http_status, dur, pending, from_backlog, error):
        return {
            "device_id": self.cfg.device_id,
            "n_records": int(n),
            "first_key": first_key,
            "last_key": last_key,
            "status": status,
            "http_status": http_status,
            "duration_ms": int(dur or 0),
            "queue_pending": int(pending),
            "from_backlog": bool(from_backlog),
            "error": error,
        }

    def _write_upload_line(self, e):
        uplog.info("status=%s n=%s first=%s last=%s http=%s dur_ms=%s pending=%s backlog=%s error=%s",
                   e["status"], e["n_records"], e["first_key"], e["last_key"], e["http_status"],
                   e["duration_ms"], e["queue_pending"], e["from_backlog"], e["error"])

    def _record_failure(self, rows, keys, http_status, from_backlog, error, dur):
        if keys is None:
            keys = sorted(record_key(r.ts if r.ts is not None else r.wall_ts) for r in rows)
        pending = self.queue.count()
        entry = self._log_entry("error", len(keys), keys[0] if keys else None, keys[-1] if keys else None,
                                http_status, dur, pending, True if from_backlog is None else from_backlog, error)
        self._write_upload_line(entry)
        log.warning("Upload thất bại (%d bản ghi): %s", len(keys), error)
        stored = dict(entry)
        stored["ts_ms"] = int(time.time() * 1000)
        try:
            self.queue.add_failed_log(stored)
        except Exception:  # noqa: BLE001
            log.exception("Không ghi được log lỗi cục bộ")
        self._had_failures = True
        self._set_error("upload", error)

    def _log_path(self, ts):
        return "logs/firebase_writes/%s" % vn_date_str(ts)

    def _post_log(self, entry):
        body = dict(entry)
        body["ts"] = SERVER_TIMESTAMP
        try:
            st, resp = self.client.post(self._log_path(time.time()), body, timeout=10)
            if st != 200:
                log.debug("Ghi logs/firebase_writes lỗi: %s", error_text(st, resp))
        except Exception as e:  # noqa: BLE001
            log.debug("Ghi logs/firebase_writes lỗi: %s", e)

    def _flush_failed_logs(self, limit=50):
        """Đẩy các lần upload thất bại (lưu cục bộ khi mất mạng) lên Firebase."""
        items = self.queue.list_failed_logs(limit)
        if not items:
            return 0
        done = []
        for rid, e in items:
            if not isinstance(e, dict):
                done.append(rid)
                continue
            body = dict(e)
            ts_ms = body.pop("ts_ms", None)
            body["ts"] = int(ts_ms) if ts_ms else SERVER_TIMESTAMP
            body["logged_late"] = True
            path = self._log_path(ts_ms / 1000.0 if ts_ms else time.time())
            try:
                st, _ = self.client.post(path, body, timeout=10)
            except Exception as ex:  # noqa: BLE001
                log.debug("Đẩy log lỗi cũ thất bại: %s", ex)
                break
            if st != 200:
                break
            done.append(rid)
        self.queue.delete_failed_logs(done)
        if done:
            log.info("Đã đẩy %d log upload-thất-bại (lưu offline) lên Firebase", len(done))
        return len(done)

    def _update_last_reading(self, newest):
        if newest is None:
            return
        ts, key, rec = newest
        try:
            prev = float(self.queue.get_meta("last_reading_ts", "0") or 0)
        except ValueError:
            prev = 0.0
        if ts <= prev:
            return
        body = dict(rec)
        body["key"] = key
        try:
            st, _ = self.client.put("devices/%s/last_reading" % self.cfg.device_id, body, timeout=10)
            if st == 200:
                self.queue.set_meta("last_reading_ts", ts)
        except Exception as e:  # noqa: BLE001
            log.debug("Cập nhật last_reading lỗi: %s", e)

    # ------------------------------------------------------------- heartbeat
    def _get_ip(self):
        if time.monotonic() - self._ip_mono > 60:
            self._ip = local_ip(self.net.host)
            self._ip_mono = time.monotonic()
        return self._ip

    def status_payload(self):
        ts = self.timesync.status()
        with self._state_lock:
            sensors = {"soil": self.sensor_status.get("soil"), "dht20": self.sensor_status.get("dht20")}
        return {
            "online": True,
            "last_seen": SERVER_TIMESTAMP,
            "device_time": int(time.time()),
            "hostname": self._hostname,
            "ip": self._get_ip(),
            "fw_version": __version__,
            "interval_sec": int(self.interval),
            "heartbeat_sec": self.heartbeat_sec,
            "queue_pending": int(self.queue.count()),
            "ntp_synced": bool(ts["synced"]),
            "clock_offset_ms": ts["offset_ms"],
            "network_ok": bool(self.network_ok),
            "sensors": sensors,
            "relays": self.relay.summary(),
            "last_error": self.last_error,
            "cpu_temp_c": read_cpu_temp(),
            "uptime_s": int(system_uptime_sec()),
            "simulate": bool(self.cfg.simulate),
        }

    def _push_live(self, payload, source, request_id=None):
        """Ghi đè giá trị tức thời lên devices/{id}/live (không lưu vào lịch sử /data)."""
        if not payload or not self.cfg.db_url:
            return False
        with self._state_lock:
            sensors = {"soil": self.sensor_status.get("soil"), "dht20": self.sensor_status.get("dht20")}
        body = dict(payload)
        body["updated_at"] = SERVER_TIMESTAMP
        body["device_ts"] = int(time.time())
        body["source"] = source
        if request_id:
            body["request_id"] = request_id
        body["sensors"] = sensors
        try:
            st, resp = self.client.put("devices/%s/live" % self.cfg.device_id, body, timeout=8)
            if st == 200:
                with self._state_lock:
                    self._live_dirty = False
                return True
            log.debug("Cập nhật live lỗi: %s", error_text(st, resp))
        except Exception as e:  # noqa: BLE001
            log.debug("Cập nhật live lỗi: %s", e)
        return False

    def _sync_live_snapshot(self):
        if not self.cfg.live_enabled:
            return
        with self._state_lock:
            last_mono = self._last_read_mono
            dirty = self._live_dirty
            latest = dict(self.latest) if self.latest else None
        age = (time.monotonic() - last_mono) if last_mono is not None else 1e9
        if not self.cfg.replay_path and age >= max(4.0, self.cfg.live_interval_sec - 1.0):
            payload, _, _ = self._read_sensors_locked()
            if payload:
                self._push_live(payload, "heartbeat")
        elif dirty and latest:
            self._push_live(latest, "sample")

    def _handle_read_now_command(self):
        """Xử lý nút 'Đọc ngay' từ Dashboard qua devices/{id}/command/read_now."""
        try:
            st, cmd = self.client.get("devices/%s/command/read_now" % self.cfg.device_id, timeout=8)
        except Exception as e:  # noqa: BLE001
            log.debug("Đọc command/read_now lỗi: %s", e)
            return
        if st != 200 or not isinstance(cmd, dict):
            return
        raw_id = cmd.get("request_id")
        req_id = raw_id.strip() if isinstance(raw_id, str) else ""
        if not req_id or req_id == self._last_read_now_id:
            return
        log.info("Nhận lệnh đọc cảm biến tức thời (request_id=%s)", req_id)
        payload, _, errors = self._read_sensors_locked()
        pushed = self._push_live(payload, "manual", request_id=req_id) if payload else False
        self._last_read_now_id = req_id
        try:
            self.queue.set_meta("last_read_now_id", req_id)
        except Exception:  # noqa: BLE001
            pass
        err_msg = "; ".join("%s: %s" % (k, v) for k, v in sorted(errors.items())) if errors else None
        if not payload and not err_msg:
            err_msg = "Không đọc được cảm biến nào"
        ack = {
            "request_id": req_id,
            "ack_at": SERVER_TIMESTAMP,
            "status": "ok" if (payload and pushed) else "error",
        }
        if err_msg:
            ack["error"] = err_msg
        try:
            self.client.put("devices/%s/command/read_now_ack" % self.cfg.device_id, ack, timeout=8)
        except Exception as e:  # noqa: BLE001
            log.debug("Ghi read_now_ack lỗi: %s", e)

    def _heartbeat_loop(self):
        self.stop_event.wait(1.0)
        while not self.stop_event.is_set():
            try:
                ok, _ = self.net.check(max_age=min(10.0, self.heartbeat_sec / 2.0))
                if ok:
                    self.network_ok = True
                    st, resp = self.client.patch("devices/%s/status" % self.cfg.device_id,
                                                 self.status_payload(), timeout=8)
                    if st == 200:
                        if self._in_backoff:
                            self.retry_now.set()  # Firebase đã phản hồi -> thử upload lại ngay
                        self._sync_live_snapshot()
                    else:
                        log.debug("Heartbeat lỗi: %s", error_text(st, resp))
                else:
                    self.network_ok = False
            except Exception as e:  # noqa: BLE001 - offline thì bỏ qua lặng lẽ
                log.debug("Heartbeat lỗi: %s", e)
            self.stop_event.wait(self.heartbeat_sec)

    # --------------------------------------------------------------- control
    def _apply_remote(self, data):
        cfgd = data.get("config") if isinstance(data.get("config"), dict) else {}
        if self.cfg.use_remote_interval and cfgd.get("sampling_interval_sec") is not None:
            new = clamp_interval(cfgd.get("sampling_interval_sec"), self.interval)
            if new != self.interval:
                log.info("Chu kỳ lấy mẫu đổi %d -> %d s (từ Firebase, áp dụng ngay)", self.interval, new)
                self.interval = new
                self.sample_wake.set()
        self.relay.update_remote(data)

    def _moisture_for_control(self):
        """Độ ẩm đất cho chế độ tưới auto; tự đọc nhanh nếu số liệu đã cũ."""
        cfgd = self.relay.remote.get("config") if isinstance(self.relay.remote, dict) else None
        mode = parse_mode((cfgd or {}).get("irrigation_mode"))
        lm = self._latest_soil
        if mode == MODE_AUTO:
            max_age = 10.0 if self.relay.pump.state else 60.0
            if lm is None or time.monotonic() - lm[1] > max_age:
                if self._sensor_lock.acquire(False):
                    try:
                        s = self.sensors.read_soil()
                    finally:
                        self._sensor_lock.release()
                    if s and s.get("moisture") is not None:
                        lm = (float(s["moisture"]), time.monotonic())
                        self._latest_soil = lm
        if lm is None or time.monotonic() - lm[1] > 300:
            return None
        return lm[0]

    def _air_temp_for_control(self):
        """Nhiệt độ không khí từ DHT20 cho chế độ đèn auto; đọc bổ sung nếu số liệu đã cũ."""
        cfgd = self.relay.remote.get("config") if isinstance(self.relay.remote, dict) else None
        mode = parse_mode((cfgd or {}).get("light_mode"))
        lt = self._latest_air_temp
        if mode == MODE_AUTO and self.cfg.dht_enabled:
            if lt is None or time.monotonic() - lt[1] > 60.0:
                if self._sensor_lock.acquire(False):
                    try:
                        d = self.sensors.read_dht() if hasattr(self.sensors, "read_dht") else None
                    except Exception:  # noqa: BLE001
                        d = None
                    finally:
                        self._sensor_lock.release()
                    if d and d.get("temperature") is not None:
                        lt = (float(d["temperature"]), time.monotonic())
                        self._latest_air_temp = lt
        if lt is None or time.monotonic() - lt[1] > 300:
            return None
        return lt[0]

    def _control_loop(self):
        cfg = self.cfg
        while not self.stop_event.is_set():
            try:
                ok, _ = self.net.check(max_age=10.0)
                if ok:
                    try:
                        st, data = self.client.get("streaming", timeout=8)
                        if st == 200:
                            self._apply_remote(data if isinstance(data, dict) else {})
                        else:
                            log.debug("Đọc streaming lỗi: %s", error_text(st, data))
                    except Exception as e:  # noqa: BLE001
                        log.debug("Đọc streaming lỗi: %s", e)
                    self._handle_read_now_command()
                self.relay.evaluate(
                    time.time(),
                    self.timesync.is_synced(),
                    self._moisture_for_control(),
                    air_temp=self._air_temp_for_control(),
                )
                if self.relay.last_error:
                    self._set_error("relay", self.relay.last_error)
                    self.relay.last_error = None
                if ok:
                    for dev in ("pump", "light"):
                        if self.relay.needs_report(dev):
                            payload = self.relay.report_payload(dev)
                            try:
                                st, _ = self.client.patch("streaming/control/%s" % dev, payload, timeout=8)
                                if st == 200:
                                    self.relay.mark_reported(dev, payload)
                            except Exception as e:  # noqa: BLE001
                                log.debug("Báo cáo relay %s lỗi: %s", dev, e)
            except Exception:  # noqa: BLE001
                log.exception("Lỗi vòng điều khiển")
            self.stop_event.wait(cfg.control_poll_sec)
