# -*- coding: utf-8 -*-
"""Hàng đợi offline (store-and-forward) bằng SQLite.

Quy tắc mốc thời gian (Jetson Nano không có RTC có pin):
  tq = "ntp"        : lúc đo đồng hồ đã đồng bộ NTP -> ts = wall_ts.
  tq = "pending"    : lúc đo CHƯA đồng bộ -> chưa biết giờ thật, CHƯA được upload.
  tq = "corrected"  : bản ghi "pending" của LẦN BOOT HIỆN TẠI, đã hiệu chỉnh khi NTP
                      đồng bộ: ts = sync_wall - (sync_mono - mono).
  tq = "estimated"  : bản ghi "pending" của LẦN BOOT CŨ (monotonic đã reset, không
                      thể hiệu chỉnh) -> dùng tạm wall_ts lúc đo. Nếu ts < min_valid_epoch
                      (đồng hồ còn ở 1970/2018...) thì chuyển sang bảng `quarantine`.
Chỉ upload các bản ghi có tq ∈ {ntp, corrected, estimated}; xoá khỏi hàng đợi chỉ
sau khi Firebase trả HTTP 200.

Chỉ dùng cú pháp SQLite có trên Ubuntu 18.04 (3.22): không UPSERT, không RETURNING.
"""
import json
import logging
import os
import sqlite3
import threading
import time

log = logging.getLogger("farm_agent.queue")

TQ_PENDING = "pending"
TQ_NTP = "ntp"
TQ_CORRECTED = "corrected"
TQ_ESTIMATED = "estimated"
UPLOADABLE = (TQ_NTP, TQ_CORRECTED, TQ_ESTIMATED)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wall_ts REAL NOT NULL,
    mono REAL NOT NULL,
    boot_id TEXT NOT NULL,
    ntp_synced INTEGER NOT NULL,
    ts REAL,
    tq TEXT NOT NULL,
    payload TEXT NOT NULL,
    sensor_status TEXT,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readings_tq ON readings(tq, id);
CREATE INDEX IF NOT EXISTS idx_readings_boot ON readings(boot_id, tq);
CREATE TABLE IF NOT EXISTS failed_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at REAL NOT NULL,
    entry TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quarantine (
    id INTEGER PRIMARY KEY,
    wall_ts REAL,
    mono REAL,
    boot_id TEXT,
    payload TEXT,
    reason TEXT,
    moved_at REAL
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

_QUARANTINE_MAX = 10000


class Row(object):
    __slots__ = ("id", "ts", "tq", "payload", "boot_id", "wall_ts")

    def __init__(self, rid, ts, tq, payload, boot_id, wall_ts):
        self.id = rid
        self.ts = ts
        self.tq = tq
        self.payload = payload
        self.boot_id = boot_id
        self.wall_ts = wall_ts


class QueueStore(object):
    def __init__(self, path, max_rows=500000, failed_max=1000):
        d = os.path.dirname(os.path.abspath(path))
        if not os.path.isdir(d):
            os.makedirs(d)
        self.path = path
        self.max_rows = int(max_rows)
        self.failed_max = int(failed_max)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(path, timeout=30, check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.executescript(_SCHEMA)
        self._inserts = 0
        self._cap_every = 1 if self.max_rows <= 10000 else 100

    # ------------------------------------------------------------------ utils
    def close(self):
        with self._lock:
            try:
                self._conn.close()
            except Exception:  # noqa: BLE001
                pass

    def _tx(self, statements):
        """Chạy nhiều câu lệnh trong 1 transaction. statements: [(sql, params)]."""
        with self._lock:
            cur = self._conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                counts = []
                for sql, params in statements:
                    cur.execute(sql, params)
                    counts.append(cur.rowcount)
                cur.execute("COMMIT")
                return counts
            except Exception:
                cur.execute("ROLLBACK")
                raise

    # --------------------------------------------------------------- readings
    def add(self, wall_ts, mono, boot_id, synced, payload, sensor_status=None):
        tq = TQ_NTP if synced else TQ_PENDING
        ts = float(wall_ts) if synced else None
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO readings (wall_ts, mono, boot_id, ntp_synced, ts, tq, payload, sensor_status, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    float(wall_ts),
                    float(mono),
                    boot_id,
                    1 if synced else 0,
                    ts,
                    tq,
                    json.dumps(payload, separators=(",", ":")),
                    json.dumps(sensor_status or {}, separators=(",", ":")),
                    time.time(),
                ),
            )
            rid = cur.lastrowid
            self._inserts += 1
            if self._inserts % self._cap_every == 0:
                self._enforce_cap()
            return rid

    def _enforce_cap(self):
        n = self.count()
        if n > self.max_rows:
            drop = n - self.max_rows
            self._conn.execute(
                "DELETE FROM readings WHERE id IN (SELECT id FROM readings ORDER BY id LIMIT ?)", (drop,)
            )
            log.warning("Hàng đợi vượt giới hạn %d bản ghi -> đã xoá %d bản ghi CŨ NHẤT", self.max_rows, drop)

    def correct_boot(self, boot_id, sync_wall, sync_mono):
        """Hiệu chỉnh mọi bản ghi 'pending' của boot hiện tại theo mốc đồng bộ."""
        counts = self._tx(
            [
                (
                    "UPDATE readings SET ts = ? - (? - mono), tq = ? WHERE boot_id = ? AND tq = ?",
                    (float(sync_wall), float(sync_mono), TQ_CORRECTED, boot_id, TQ_PENDING),
                )
            ]
        )
        return counts[0]

    def count_old_pending(self, current_boot_id):
        with self._lock:
            return self._conn.execute(
                "SELECT COUNT(*) FROM readings WHERE tq = ? AND boot_id != ?", (TQ_PENDING, current_boot_id)
            ).fetchone()[0]

    def finalize_old_boots(self, current_boot_id, min_valid_epoch):
        """Bản ghi pending của boot cũ -> 'estimated'; ts vô lý -> quarantine.

        Trả (n_estimated, n_quarantined).
        """
        now = time.time()
        counts = self._tx(
            [
                (
                    "UPDATE readings SET ts = wall_ts, tq = ? WHERE tq = ? AND boot_id != ?",
                    (TQ_ESTIMATED, TQ_PENDING, current_boot_id),
                ),
                (
                    "INSERT OR REPLACE INTO quarantine (id, wall_ts, mono, boot_id, payload, reason, moved_at)"
                    " SELECT id, wall_ts, mono, boot_id, payload, 'ts<min_valid_epoch', ? FROM readings"
                    " WHERE tq != ? AND ts < ?",
                    (now, TQ_PENDING, float(min_valid_epoch)),
                ),
                ("DELETE FROM readings WHERE tq != ? AND ts < ?", (TQ_PENDING, float(min_valid_epoch))),
                (
                    "DELETE FROM quarantine WHERE id IN (SELECT id FROM quarantine ORDER BY id DESC LIMIT -1 OFFSET ?)",
                    (_QUARANTINE_MAX,),
                ),
            ]
        )
        n_est, n_q = counts[0], counts[2]
        if n_q:
            log.warning("Đã cách ly %d bản ghi có mốc thời gian vô lý (đồng hồ chưa đúng, không thể hiệu chỉnh)", n_q)
        return n_est, n_q

    def next_batch(self, limit):
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, ts, tq, payload, boot_id, wall_ts FROM readings WHERE tq IN (?,?,?) ORDER BY id LIMIT ?",
                UPLOADABLE + (int(limit),),
            ).fetchall()
        out = []
        for rid, ts, tq, payload, boot_id, wall_ts in rows:
            try:
                data = json.loads(payload)
            except ValueError:
                data = {}
            out.append(Row(rid, ts, tq, data, boot_id, wall_ts))
        return out

    def delete_ids(self, ids):
        ids = list(ids)
        with self._lock:
            for i in range(0, len(ids), 500):
                chunk = ids[i:i + 500]
                self._conn.execute(
                    "DELETE FROM readings WHERE id IN (%s)" % ",".join("?" * len(chunk)), chunk
                )

    def count(self):
        with self._lock:
            return self._conn.execute("SELECT COUNT(*) FROM readings").fetchone()[0]

    def count_by_tq(self):
        with self._lock:
            rows = self._conn.execute("SELECT tq, COUNT(*) FROM readings GROUP BY tq").fetchall()
        return dict(rows)

    # ------------------------------------------------------------ failed logs
    def add_failed_log(self, entry):
        with self._lock:
            self._conn.execute(
                "INSERT INTO failed_logs (created_at, entry) VALUES (?, ?)",
                (time.time(), json.dumps(entry, separators=(",", ":"))),
            )
            self._conn.execute(
                "DELETE FROM failed_logs WHERE id IN (SELECT id FROM failed_logs ORDER BY id DESC LIMIT -1 OFFSET ?)",
                (self.failed_max,),
            )

    def list_failed_logs(self, limit=50):
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, entry FROM failed_logs ORDER BY id LIMIT ?", (int(limit),)
            ).fetchall()
        out = []
        for rid, entry in rows:
            try:
                out.append((rid, json.loads(entry)))
            except ValueError:
                out.append((rid, None))
        return out

    def delete_failed_logs(self, ids):
        ids = list(ids)
        if not ids:
            return
        with self._lock:
            self._conn.execute("DELETE FROM failed_logs WHERE id IN (%s)" % ",".join("?" * len(ids)), ids)

    def count_failed_logs(self):
        with self._lock:
            return self._conn.execute("SELECT COUNT(*) FROM failed_logs").fetchone()[0]

    # ------------------------------------------------------------------- meta
    def get_meta(self, key, default=None):
        with self._lock:
            row = self._conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row[0] if row else default

    def set_meta(self, key, value):
        with self._lock:
            self._conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (key, str(value)))
