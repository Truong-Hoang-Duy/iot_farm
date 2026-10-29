# -*- coding: utf-8 -*-
"""Kiểm thử end-to-end: agent thật (subprocess, --simulate) <-> mock Firebase (127.0.0.1).

Kịch bản:
  0. Agent A chạy nhưng KHÔNG BAO GIỜ đồng bộ giờ (--fake-sync-delay 9999) -> bản ghi 'pending'
     nằm trong SQLite; dừng A (giả lập reboot: boot_id mới cho tiến trình sau).
  1. Agent B (--fake-sync-delay 12, có xác thực email/password qua mock Auth):
     bản ghi boot cũ -> 'estimated'; bản ghi chưa đồng bộ của B -> 'corrected'; sau đó 'ntp'.
     Kiểm tra key data/YYYY-MM-DD/HH:MM:SS (giờ VN), trường dữ liệu, status heartbeat, last_reading.
  2. Sự cố: mock trả 503 -> file cờ FORCE_OFFLINE -> tắt hẳn cổng TCP; dữ liệu dồn trong SQLite,
     khôi phục -> đẩy hết lên, log from_backlog=true, log lỗi được đẩy bù (logged_late).
  3. Đổi streaming/config/sampling_interval_sec = 10 -> agent áp dụng ngay (status + nhịp bản ghi).
  4. Relay demo: manual / auto (hysteresis) / light schedule; `status` không bị agent ghi đè.
  5. Dừng an toàn (CTRL_BREAK/SIGTERM) -> online=false, relay TẮT.

Chạy:  python tests/e2e_test.py   (trong thư mục edge/)
"""
import datetime
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
EDGE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
os.environ["NO_PROXY"] = os.environ["no_proxy"] = "127.0.0.1,localhost"

from mock_firebase import MockFirebase  # noqa: E402

DEVICE = "jetson-e2e"
EMAIL, PASSWORD = "jetson-e2e@smartfarm.com", "secret-pw"
FIELDS = {"temperature", "humidity", "soiltemp", "moisture", "pH", "EC", "N", "P", "K", "ts", "tq"}
KEY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}/\d{2}:\d{2}:\d{2}$")
RESULTS = []


def check(name, cond, detail=""):
    RESULTS.append((name, bool(cond)))
    print("[%s] %s%s" % ("PASS" if cond else "FAIL", name, (" -- %s" % detail) if detail else ""), flush=True)
    return bool(cond)


def wait_until(fn, timeout, step=0.5):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
        except Exception:  # noqa: BLE001
            v = None
        if v:
            return v
        time.sleep(step)
    return None


def vn_key(ts):
    dt = datetime.datetime(1970, 1, 1) + datetime.timedelta(seconds=int(ts) + 7 * 3600)
    return dt.strftime("%Y-%m-%d/%H:%M:%S")


def records(mock):
    out = []
    data = mock.get("data") or {}
    for day, items in data.items():
        for t, rec in (items or {}).items():
            out.append((day + "/" + t, rec))
    return sorted(out)


def logs(mock):
    out = []
    for day, items in (mock.get("logs/firebase_writes") or {}).items():
        for pid, e in (items or {}).items():
            out.append(e)
    return out


def queue_counts(db):
    if not os.path.exists(db):
        return {}
    con = sqlite3.connect(db, timeout=5)
    try:
        return dict(con.execute("SELECT tq, COUNT(*) FROM readings GROUP BY tq").fetchall())
    finally:
        con.close()


class AgentProc(object):
    def __init__(self, name, args, workdir):
        self.name = name
        self.log_path = os.path.join(workdir, "%s.console.log" % name)
        self.logf = open(self.log_path, "wb")
        flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        self.p = subprocess.Popen([sys.executable, "-u", os.path.join(EDGE, "run_agent.py")] + args,
                                  stdout=self.logf, stderr=subprocess.STDOUT, cwd=EDGE, env=env,
                                  creationflags=flags)

    def stop(self, timeout=45):
        if self.p.poll() is None:
            if os.name == "nt":
                os.kill(self.p.pid, signal.CTRL_BREAK_EVENT)
            else:
                self.p.send_signal(signal.SIGTERM)
            try:
                self.p.wait(timeout)
            except subprocess.TimeoutExpired:
                self.p.kill()
                self.p.wait()
        self.logf.close()
        return self.p.returncode


def main():
    work = tempfile.mkdtemp(prefix="edge-e2e-")
    data_dir = os.path.join(work, "data")
    log_dir = os.path.join(work, "logs")
    db = os.path.join(data_dir, "queue.db")
    ini = os.path.join(work, "e2e.ini")
    with open(ini, "w", encoding="utf-8") as f:
        f.write("""[device]
device_id = %s
[firebase]
api_key = FAKE-API-KEY
email = %s
password = %s
timeout_sec = 5
[sampling]
sampling_interval_sec = 5
[timesync]
use_timedatectl = false
use_sntp = false
[upload]
backoff_initial_sec = 2
backoff_max_sec = 8
idle_poll_sec = 1
[heartbeat]
control_poll_sec = 2
[relay]
report_every_sec = 30
[paths]
data_dir = %s
log_dir = %s
[logging]
level = INFO
""" % (DEVICE, EMAIL, PASSWORD, data_dir.replace("\\", "/"), log_dir.replace("\\", "/")))

    mock = MockFirebase(require_auth=True).start()
    mock.add_user(EMAIL, PASSWORD)
    mock.set("streaming", {
        "config": {"sampling_interval_sec": 5, "irrigation_mode": 0, "light_mode": 0,
                   "irrigation_time": {"time1": 6, "time2": 17}, "light_time": {"on": 6, "off": 18},
                   "threshold": {"soil_moisture": {"low": 40, "high": 80}}},
        "control": {"pump": {"status": False, "daily_time": 0, "last_on_time": ""},
                    "light": {"status": False, "daily_time": 0, "last_on_time": ""}},
    })
    print("Mock Firebase: %s | thư mục làm việc: %s" % (mock.url, work), flush=True)
    base = ["--config", ini, "--simulate", "--mock-url", mock.url]
    b = None
    try:
        # ---------------------------------------------------------------- 0
        print("\n=== Pha 0: agent A không đồng bộ giờ (boot cũ) ===", flush=True)
        a = AgentProc("agentA", base + ["--fake-sync-delay", "9999"], work)
        got = wait_until(lambda: queue_counts(db).get("pending", 0) >= 2, 30)
        check("A: bản ghi chưa đồng bộ được giữ lại trong SQLite (pending)", got, str(queue_counts(db)))
        check("A: không upload bản ghi chưa đồng bộ của boot hiện tại", not records(mock))
        rc = a.stop()
        check("A: dừng an toàn (exit code 0)", rc == 0, "rc=%s" % rc)
        st = mock.get("devices/%s/status" % DEVICE) or {}
        check("A: status.online=false sau khi dừng", st.get("online") is False, str(st.get("online")))
        n_a = queue_counts(db).get("pending", 0)

        # ---------------------------------------------------------------- 1
        print("\n=== Pha 1: agent B (đồng bộ giờ sau 12 s) ===", flush=True)
        b = AgentProc("agentB", base + ["--fake-sync-delay", "12"], work)
        est = wait_until(lambda: [r for r in records(mock) if r[1].get("tq") == "estimated"], 20)
        check("B: bản ghi boot cũ được upload với tq=estimated (khi có mạng, dù chưa đồng bộ)",
              est and len(est) >= n_a, "estimated=%d, A pending=%d" % (len(est or []), n_a))
        got = wait_until(lambda: {"corrected", "ntp"} <= set(r[1].get("tq") for r in records(mock)), 45)
        check("B: có bản ghi tq=corrected (hiệu chỉnh ngược) và tq=ntp", got,
              str(sorted(set(r[1].get("tq") for r in records(mock)))))
        recs = records(mock)
        check("Key đúng dạng data/YYYY-MM-DD/HH:MM:SS", recs and all(KEY_RE.match(k) for k, _ in recs),
              recs[-1][0] if recs else "")
        check("Key = giờ VN (UTC+7) của ts", all(vn_key(r["ts"]) == k for k, r in recs))
        check("Trường dữ liệu đúng hợp đồng (không có light)",
              all(set(r) <= FIELDS and {"ts", "tq", "moisture", "temperature"} <= set(r) for _, r in recs))
        corr = [r for _, r in recs if r["tq"] == "corrected"]
        check("Bản ghi corrected có ts gần thời điểm đo thật", corr and all(abs(r["ts"] - time.time()) < 120 for r in corr))
        ntp_secs = [int(k[-2:]) for k, r in recs if r["tq"] == "ntp"]
        check("Bản ghi ntp được căn theo mốc 5 s", ntp_secs and all(s % 5 == 0 for s in ntp_secs), str(ntp_secs[:8]))
        st = wait_until(lambda: (mock.get("devices/%s/status" % DEVICE) or {}).get("ntp_synced") and
                        mock.get("devices/%s/status" % DEVICE), 20) or {}
        need = {"online", "last_seen", "device_time", "hostname", "ip", "fw_version", "interval_sec", "heartbeat_sec",
                "queue_pending", "ntp_synced", "network_ok", "sensors", "cpu_temp_c", "uptime_s", "simulate"}
        check("Heartbeat status đủ trường hợp đồng", need <= set(st) or need - {"cpu_temp_c"} <= set(st),
              "thiếu %s" % sorted(need - set(st)))
        check("Heartbeat: online, last_seen=server ms, interval 5, heartbeat 5, simulate",
              st.get("online") is True and isinstance(st.get("last_seen"), int) and st.get("interval_sec") == 5
              and st.get("heartbeat_sec") == 5 and st.get("simulate") is True
              and st.get("sensors") == {"soil": "simulated", "dht20": "simulated"}, str(st))
        lr = mock.get("devices/%s/last_reading" % DEVICE) or {}
        check("last_reading có key + ts", KEY_RE.match(str(lr.get("key", ""))) and "ts" in lr, str(lr.get("key")))
        lg = logs(mock)
        check("logs/firebase_writes có log ok, from_backlog=true cho lô backlog",
              any(e.get("status") == "ok" and e.get("from_backlog") is True for e in lg)
              and all(isinstance(e.get("ts"), int) and e.get("device_id") == DEVICE for e in lg), "n_logs=%d" % len(lg))

        # ---------------------------------------------------------------- 2
        print("\n=== Pha 2: sự cố mạng / Firebase ===", flush=True)
        wait_until(lambda: sum(queue_counts(db).values()) == 0, 15)
        n0 = len(records(mock))
        mock.set_mode("503")
        time.sleep(12)
        q503 = sum(queue_counts(db).values())
        check("503: bản ghi dồn lại trong SQLite", q503 >= 2, "queue=%d" % q503)
        check("503: không có bản ghi mới trên Firebase", len(records(mock)) == n0)
        mock.set_mode("ok")
        flag = os.path.join(data_dir, "FORCE_OFFLINE")
        open(flag, "w").close()
        time.sleep(10)
        n_flag = len(records(mock))
        q_flag = sum(queue_counts(db).values())
        check("FORCE_OFFLINE: hàng đợi tiếp tục tăng, Firebase không đổi", q_flag > q503 and n_flag == n0,
              "queue=%d firebase_new=%d" % (q_flag, n_flag - n0))
        os.remove(flag)
        mock.stop_listening()
        time.sleep(12)
        q_down = sum(queue_counts(db).values())
        check("Cổng TCP bị đóng: hàng đợi tiếp tục tăng", q_down > q_flag, "queue=%d" % q_down)
        mock.start_listening()
        t_rec = time.time()
        ok = wait_until(lambda: sum(queue_counts(db).values()) <= 1 and len(records(mock)) >= n0 + q_down, 40)
        check("Khôi phục: toàn bộ backlog được đẩy lên (%.0f s)" % (time.time() - t_rec), ok,
              "firebase_new=%d queue_before=%d" % (len(records(mock)) - n0, q_down))
        lg = logs(mock)
        late = [e for e in lg if e.get("status") == "error" and e.get("logged_late") is True]
        check("Log upload thất bại được lưu offline rồi đẩy bù lên Firebase", len(late) >= 2,
              "n=%d, ví dụ: %s" % (len(late), (late[0].get("error") if late else "")))
        check("Có log lô backlog status=ok, from_backlog=true sau khôi phục",
              any(e.get("status") == "ok" and e.get("from_backlog") is True and e.get("n_records", 0) >= 2 for e in lg))
        with open(os.path.join(log_dir, "uploads.log"), encoding="utf-8") as f:
            ul = f.read()
        check("logs/uploads.log ghi cả lô ok và lô lỗi", "status=ok" in ul and "status=error" in ul)

        # ---------------------------------------------------------------- 3
        print("\n=== Pha 3: đổi chu kỳ lấy mẫu từ Firebase ===", flush=True)
        mock.set("streaming/config/sampling_interval_sec", 10)
        t_cfg = time.time()
        st = wait_until(lambda: (mock.get("devices/%s/status" % DEVICE) or {}).get("interval_sec") == 10
                        and mock.get("devices/%s/status" % DEVICE), 30) or {}
        check("status.interval_sec=10, heartbeat_sec=10 (áp dụng không cần restart)",
              st.get("interval_sec") == 10 and st.get("heartbeat_sec") == 10, "sau %.0f s" % (time.time() - t_cfg))
        time.sleep(1)
        t_mark = time.time()

        def new_recs():
            r = [x for x in records(mock) if x[1]["ts"] > t_mark and x[1]["tq"] == "ntp"]
            return r if len(r) >= 3 else None
        nr = wait_until(new_recs, 45) or []
        ts_list = sorted(x[1]["ts"] for x in nr)
        diffs = [b2 - a2 for a2, b2 in zip(ts_list, ts_list[1:])]
        check("Bản ghi mới cách nhau 10 s, căn mốc 10 s", nr and all(d == 10 for d in diffs)
              and all(t % 10 == 0 for t in ts_list), "diffs=%s" % diffs)

        # ---------------------------------------------------------------- 4
        print("\n=== Pha 4: relay demo ===", flush=True)
        ctl = "streaming/control/pump"
        mock.set(ctl + "/status", True)
        got = wait_until(lambda: mock.get(ctl + "/actual") is True, 15)
        p = mock.get(ctl) or {}
        check("Manual: status=true -> actual=true, simulated=true", got and p.get("simulated") is True, str(p))
        check("Agent không ghi đè status; updated_at là server ms; có last_on_time",
              p.get("status") is True and isinstance(p.get("updated_at"), int) and p.get("last_on_time"))
        mock.set(ctl + "/status", False)
        check("Manual: status=false -> actual=false", wait_until(lambda: mock.get(ctl + "/actual") is False, 15))
        mock.set("streaming/config/threshold/soil_moisture", {"low": 95, "high": 99})
        mock.set("streaming/config/irrigation_mode", 1)
        check("Auto: độ ẩm < low -> bơm BẬT", wait_until(lambda: mock.get(ctl + "/actual") is True, 15))
        mock.set("streaming/config/threshold/soil_moisture", {"low": 5, "high": 10})
        check("Auto: độ ẩm > high -> bơm TẮT", wait_until(lambda: mock.get(ctl + "/actual") is False, 15))
        check("daily_time > 0 sau khi bơm chạy", (mock.get(ctl + "/daily_time") or 0) > 0,
              str(mock.get(ctl + "/daily_time")))
        h = (datetime.datetime(1970, 1, 1) + datetime.timedelta(seconds=time.time() + 7 * 3600)).hour
        mock.set("streaming/config/light_time", {"on": h, "off": (h + 1) % 24})
        mock.set("streaming/config/light_mode", 2)
        check("Light schedule: trong khung giờ -> đèn BẬT",
              wait_until(lambda: mock.get("streaming/control/light/actual") is True, 15))
        mock.set("streaming/config/light_mode", "")
        check("Light mode '' = manual (status=false) -> đèn TẮT",
              wait_until(lambda: mock.get("streaming/control/light/actual") is False, 15))
        mock.set("streaming/config/irrigation_mode", 2)
        mock.set("streaming/config/irrigation_time", {"time1": h, "time2": "%02d:%02d" % ((h + 12) % 24, 0)})
        mock.set("streaming/config/irrigation_duration_min", 60)
        check("Schedule: trong khung tưới -> bơm BẬT", wait_until(lambda: mock.get(ctl + "/actual") is True, 15))

        # ---------------------------------------------------------------- 5
        print("\n=== Pha 5: dừng an toàn ===", flush=True)
        rc = b.stop()
        b = None
        check("B: dừng an toàn (exit code 0)", rc == 0, "rc=%s" % rc)
        st = mock.get("devices/%s/status" % DEVICE) or {}
        check("status.online=false sau khi dừng", st.get("online") is False)
        check("Relay TẮT khi thoát (actual=false)", mock.get(ctl + "/actual") is False)
        check("Có logs/agent.log", os.path.getsize(os.path.join(log_dir, "agent.log")) > 0)
        print("\nSố bản ghi trên mock Firebase: %d; phân bố tq: %s" % (
            len(records(mock)), dict((t, sum(1 for _, r in records(mock) if r["tq"] == t))
                                     for t in ("estimated", "corrected", "ntp"))))
    finally:
        if b is not None:
            b.stop()
        try:
            mock.stop()
        except Exception:  # noqa: BLE001
            pass
    n_fail = sum(1 for _, ok in RESULTS if not ok)
    print("\nKẾT QUẢ: %d/%d PASS" % (len(RESULTS) - n_fail, len(RESULTS)))
    print("Log console/agent: %s" % work)
    if n_fail == 0 and "--keep" not in sys.argv:
        shutil.rmtree(work, ignore_errors=True)
    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
