# -*- coding: utf-8 -*-
"""Unit test cho edge agent (chạy được trên PC lẫn Jetson, không cần phần cứng / internet).

    python -m unittest discover -s tests -v      (chạy trong thư mục edge/)
"""
import os
import shutil
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
EDGE = os.path.dirname(HERE)
sys.path.insert(0, EDGE)
sys.path.insert(0, HERE)
# mock server chạy trên 127.0.0.1: không được đi qua proxy hệ thống (http_proxy)
os.environ["NO_PROXY"] = os.environ["no_proxy"] = "127.0.0.1,localhost"

from farm_agent import timeutil  # noqa: E402
from farm_agent.agent import FarmAgent, sanitize_payload  # noqa: E402
from farm_agent.config import clamp_interval, load_config  # noqa: E402
from farm_agent.firebase_client import FirebaseAuth, FirebaseClient  # noqa: E402
from farm_agent.netcheck import NetChecker  # noqa: E402
from farm_agent.queue_store import QueueStore  # noqa: E402
from farm_agent import relay as R  # noqa: E402
from farm_agent.sensors.dht20 import calc_crc8, decode_frame  # noqa: E402
from farm_agent.sensors.soil_cwt import decode_registers  # noqa: E402
from farm_agent.sensors import SensorError  # noqa: E402
from farm_agent.timesync import NTP_DELTA, TimeSync, parse_timedatectl, sntp_query  # noqa: E402
from mock_firebase import MockFirebase  # noqa: E402


class Stub(object):
    def __init__(self, **kw):
        self.__dict__.update(kw)


class TestTimeUtil(unittest.TestCase):
    def test_vn_key_fixed_offset(self):
        self.assertEqual(timeutil.record_key(0), "1970-01-01/07:00:00")
        self.assertEqual(timeutil.record_key(1704067200), "2024-01-01/07:00:00")
        self.assertEqual(timeutil.record_key(1704067200 - 7 * 3600 + 86399.6), "2024-01-02/00:00:00")
        self.assertEqual(timeutil.vn_date_str(1704067200 + 17 * 3600), "2024-01-02")
        self.assertAlmostEqual(timeutil.vn_hour_float(1704067200 + 1800), 7.5)

    def test_clamp(self):
        self.assertEqual(clamp_interval(1), 5)
        self.assertEqual(clamp_interval(10 ** 9), 86400)
        self.assertEqual(clamp_interval("60"), 60)
        self.assertEqual(clamp_interval("abc", 300), 300)
        self.assertEqual(clamp_interval(None, 42), 42)

    def test_sanitize(self):
        p = sanitize_payload({"temperature": 1, "humidity": float("nan"), "light": 5, "EC": "1.2", "pH": True})
        self.assertEqual(p, {"temperature": 1.0, "EC": 1.2})

    def test_load_example_config(self):
        cfg = load_config(os.path.join(EDGE, "config.example.ini"), EDGE)
        self.assertEqual(cfg.device_id, "jetson-nano-01")
        self.assertEqual(cfg.soil_slave_id, 2)
        self.assertEqual(cfg.dht_address, 0x38)
        self.assertEqual(cfg.sampling_interval_sec, 300)
        self.assertTrue(cfg.relay_enabled)
        self.assertEqual(cfg.pin_mode, "BOARD")
        self.assertEqual(cfg.light_pin, 40)  # Waveshare Relay 1 (CH1, P29) = Đèn
        self.assertEqual(cfg.pump_pin, 38)   # Waveshare Relay 2 (CH2, P28) = Máy bơm
        self.assertEqual(cfg.spare_pin, 37)  # Waveshare Relay 3 (CH3, P25) = Dự phòng
        self.assertTrue(cfg.active_low)
        self.assertTrue(cfg.data_dir.startswith(EDGE))


class TestSensorsDecode(unittest.TestCase):
    def test_soil(self):
        d = decode_registers([553, 65531, 1210, 620, 277, 800, 850, 0])
        self.assertEqual(d["moisture"], 55.3)
        self.assertEqual(d["soiltemp"], -0.5)
        self.assertEqual(d["EC"], 1.21)  # 1210 µS/cm -> 1.21 mS/cm
        self.assertEqual(d["pH"], 6.2)
        self.assertEqual((d["N"], d["P"], d["K"]), (277.0, 800.0, 850.0))
        self.assertEqual(decode_registers([0, 250, 0, 62, 0, 0, 0, 0])["pH"], 6.2)

    def _frame(self, temp, hum):
        rh = int(hum / 100.0 * 1048576)
        rt = int((temp + 50.0) / 200.0 * 1048576)
        d = [0x1C, (rh >> 12) & 0xFF, (rh >> 4) & 0xFF, ((rh & 0xF) << 4) | ((rt >> 16) & 0xF),
             (rt >> 8) & 0xFF, rt & 0xFF]
        return d + [calc_crc8(d)]

    def test_dht20(self):
        self.assertEqual(decode_frame(self._frame(25.0, 50.0)), (25.0, 50.0))
        bad = self._frame(25.0, 50.0)
        bad[6] ^= 0xFF
        with self.assertRaises(SensorError):
            decode_frame(bad)


class TestQueue(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.q = QueueStore(os.path.join(self.dir, "q.db"), max_rows=100)

    def tearDown(self):
        self.q.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_correction_and_eligibility(self):
        # boot cũ, chưa đồng bộ: 1 bản ghi giờ hợp lệ, 1 bản ghi giờ 1970
        self.q.add(1.75e9, 10.0, "old", False, {"temperature": 1})
        self.q.add(1000.0, 11.0, "old", False, {"temperature": 2})
        # boot hiện tại: 2 bản ghi chưa đồng bộ (đồng hồ sai) + 1 bản ghi đã đồng bộ
        self.q.add(5000.0, 90.0, "cur", False, {"temperature": 3})
        self.q.add(5010.0, 95.0, "cur", False, {"temperature": 4})
        self.assertEqual(self.q.next_batch(10), [])  # chưa có gì được phép upload
        n = self.q.correct_boot("cur", 1.8e9, 100.0)
        self.assertEqual(n, 2)
        self.q.add(1.8e9 + 5, 105.0, "cur", True, {"temperature": 5})
        rows = self.q.next_batch(10)
        self.assertEqual([r.tq for r in rows], ["corrected", "corrected", "ntp"])
        self.assertAlmostEqual(rows[0].ts, 1.8e9 - 10.0)
        self.assertAlmostEqual(rows[1].ts, 1.8e9 - 5.0)
        self.assertEqual(self.q.count_old_pending("cur"), 2)
        n_est, n_q = self.q.finalize_old_boots("cur", 1704067200)
        self.assertEqual((n_est, n_q), (2, 1))
        rows = self.q.next_batch(10)
        self.assertEqual(sorted(r.tq for r in rows), ["corrected", "corrected", "estimated", "ntp"])
        est = [r for r in rows if r.tq == "estimated"][0]
        self.assertEqual(est.ts, 1.75e9)
        self.q.delete_ids([r.id for r in rows])
        self.assertEqual(self.q.count(), 0)

    def test_cap_and_failed_logs(self):
        for i in range(150):
            self.q.add(1.8e9 + i, i, "b", True, {"temperature": i})
        self.assertEqual(self.q.count(), 100)
        self.assertEqual(self.q.next_batch(1)[0].payload["temperature"], 50)
        for i in range(5):
            self.q.add_failed_log({"i": i})
        items = self.q.list_failed_logs(3)
        self.assertEqual([e["i"] for _, e in items], [0, 1, 2])
        self.q.delete_failed_logs([rid for rid, _ in items])
        self.assertEqual(self.q.count_failed_logs(), 2)
        self.q.set_meta("k", 1.5)
        self.assertEqual(self.q.get_meta("k"), "1.5")


class FakeNtpServer(object):
    """Máy chủ SNTP giả trên 127.0.0.1, trả giờ = giờ máy + offset."""

    def __init__(self, offset):
        self.offset = offset
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.port = self.sock.getsockname()[1]
        self.sock.settimeout(0.2)
        self.running = True
        self.t = threading.Thread(target=self._run)
        self.t.daemon = True
        self.t.start()

    def _ntp(self, t):
        return (int(t) + NTP_DELTA) & 0xFFFFFFFF, int((t % 1.0) * 4294967296.0) & 0xFFFFFFFF

    def _run(self):
        while self.running:
            try:
                data, addr = self.sock.recvfrom(512)
            except socket.timeout:
                continue
            except OSError:
                break
            now = time.time() + self.offset
            resp = bytearray(48)
            resp[0] = 0x24  # VN=4 mode=4
            resp[1] = 2
            resp[24:32] = data[40:48]
            struct.pack_into("!II", resp, 32, *self._ntp(now))
            struct.pack_into("!II", resp, 40, *self._ntp(now))
            self.sock.sendto(bytes(resp), addr)

    def close(self):
        self.running = False
        self.sock.close()


class TestTimeSync(unittest.TestCase):
    def test_parse_timedatectl(self):
        self.assertTrue(parse_timedatectl("  System clock synchronized: yes\n"))
        self.assertFalse(parse_timedatectl("NTP synchronized: no"))
        self.assertIsNone(parse_timedatectl("Local time: ..."))

    def _cfg(self, port):
        return Stub(fake_sync_delay=None, use_timedatectl=False, use_sntp=True, force_offline=False,
                    ntp_servers=["127.0.0.1:%d" % port], sntp_timeout=1.0, max_offset_sec=2.0,
                    trust_system_clock=False, check_synced_sec=600, check_unsynced_sec=15)

    def test_sntp_and_correction(self):
        d = tempfile.mkdtemp()
        q = QueueStore(os.path.join(d, "q.db"))
        srv = FakeNtpServer(10.0)
        try:
            off, delay = sntp_query("127.0.0.1", srv.port, timeout=1.0)
            self.assertAlmostEqual(off, 10.0, delta=0.2)
            self.assertLess(delay, 0.5)
            boot = timeutil.get_boot_id()
            q.add(time.time() - 3, time.monotonic() - 3, boot, False, {"temperature": 1})
            ts = TimeSync(self._cfg(srv.port), q, boot)
            self.assertFalse(ts.check())  # lệch 10 s -> chưa đồng bộ
            self.assertEqual(q.count_by_tq(), {"pending": 1})
            srv.offset = 0.05
            self.assertTrue(ts.check())   # lệch 50 ms -> đồng bộ -> hiệu chỉnh
            rows = q.next_batch(10)
            self.assertEqual(rows[0].tq, "corrected")
            self.assertAlmostEqual(rows[0].ts, time.time() - 3, delta=0.5)
            self.assertEqual(q.get_meta("synced_boot_id"), boot)
            # lần chạy sau cùng boot, mất mạng (không SNTP) => vẫn đồng bộ nhờ 'sticky'
            srv.close()
            cfg = self._cfg(1)
            cfg.ntp_servers = []
            ts2 = TimeSync(cfg, q, boot)
            self.assertTrue(ts2.check())
            self.assertEqual(ts2.source, "sticky")
        finally:
            srv.close()
            q.close()
            shutil.rmtree(d, ignore_errors=True)


class TestRelayLogic(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(R.parse_hour(6), 6.0)
        self.assertEqual(R.parse_hour("06:30"), 6.5)
        self.assertEqual(R.parse_hour("17"), 17.0)
        self.assertIsNone(R.parse_hour(""))
        self.assertIsNone(R.parse_hour(24))
        self.assertEqual(R.parse_mode(""), 0)
        self.assertEqual(R.parse_mode("2"), 2)
        self.assertEqual(R.parse_mode(7), 0)
        self.assertTrue(R.to_bool(1) and R.to_bool("true") and R.to_bool(True))
        self.assertFalse(R.to_bool(None) or R.to_bool(0) or R.to_bool("false"))

    def test_pump(self):
        f = R.decide_pump
        self.assertEqual(f(0, True, None, 40, 80, False, 0, [], 5, False)[0], True)
        self.assertEqual(f(1, False, 30, 40, 80, False, 0, [], 5, True)[0], True)
        self.assertEqual(f(1, False, 60, 40, 80, True, 0, [], 5, True)[0], True)    # vùng trễ giữ BẬT
        self.assertEqual(f(1, False, 60, 40, 80, False, 0, [], 5, True)[0], False)  # vùng trễ giữ TẮT
        self.assertEqual(f(1, False, 85, 40, 80, True, 0, [], 5, True)[0], False)
        self.assertEqual(f(1, True, None, 40, 80, True, 0, [], 5, True)[0], False)  # không có số liệu
        self.assertEqual(f(2, False, None, 0, 0, False, 6.05, [6.0, 17.0], 5, True)[0], True)
        self.assertEqual(f(2, False, None, 0, 0, False, 6.10, [6.0, 17.0], 5, True)[0], False)
        self.assertEqual(f(2, False, None, 0, 0, False, 6.05, [6.0, 17.0], 5, False)[0], False)
        self.assertEqual(f(2, False, None, 0, 0, False, 23.99, [23.95], 5, True)[0], True)

    def test_light(self):
        f = R.decide_light
        # Lập lịch theo khoảng giờ (window)
        self.assertTrue(f(2, False, 7, 6, 18, True)[0])
        self.assertFalse(f(2, True, 19, 6, 18, True)[0])
        self.assertTrue(f(2, False, 23, 18, 6, True)[0])   # qua nửa đêm
        # Lập lịch theo cữ + thời lượng (slots, tương tự máy bơm)
        self.assertTrue(f(2, False, 6.25, None, None, True, slot_times=[6.0, 18.0], duration_min=30,
                          schedule_style="slots")[0])
        self.assertFalse(f(2, False, 6.75, None, None, True, slot_times=[6.0, 18.0], duration_min=30,
                           schedule_style="slots")[0])
        # Thủ công
        self.assertTrue(f(0, True, 3, 6, 18, True)[0])
        # Tự động: bù quang kỳ theo giai đoạn cây + bảo vệ nhiệt độ DHT20
        self.assertTrue(f(1, False, 18.5, None, None, True, age_days=45, air_temp=26.0)[0])
        self.assertFalse(f(1, False, 12.0, None, None, True, age_days=45, air_temp=28.0)[0])
        self.assertFalse(f(1, False, 18.5, None, None, True, age_days=45, air_temp=37.0, max_temp_c=35.0)[0])
        self.assertTrue(f(1, False, 2.0, None, None, True, age_days=45, air_temp=16.5, min_temp_c=18.0)[0])

    def test_waveshare_3ch_gpio_mapping(self):
        class FakeGPIO(object):
            BOARD = 10
            BCM = 11
            OUT = 0
            LOW = 0
            HIGH = 1

            def __init__(self):
                self.mode = None
                self.levels = {}
                self.cleaned = []

            def setwarnings(self, _flag):
                pass

            def setmode(self, mode):
                self.mode = mode

            def setup(self, pin, _dir, initial=1):
                self.levels[pin] = initial

            def output(self, pin, val):
                self.levels[pin] = val

            def cleanup(self, pins=None):
                self.cleaned = list(pins or [])

        fg = FakeGPIO()
        cfg = Stub(relay_enabled=True, pin_mode="BOARD", light_pin=40, pump_pin=38, spare_pin=37,
                   active_low=True, max_pump_run_min=30, max_light_run_min=960,
                   default_irrigation_duration_min=5, default_light_duration_min=120,
                   light_max_temp_c=35.0, relay_report_every_sec=60)
        rc = R.RelayController(cfg, gpio=fg)
        self.assertFalse(rc.simulated)
        self.assertEqual(fg.mode, FakeGPIO.BOARD)
        # Active-low: mới khởi động tất cả kênh CH1(40), CH2(38), CH3(37) đều ở mức HIGH (TẮT)
        self.assertEqual(fg.levels, {40: 1, 38: 1, 37: 1})

        # Bật đèn thủ công -> chỉ Relay 1 (chân 40) xuống LOW
        rc.update_remote({"config": {"irrigation_mode": 0, "light_mode": 0},
                          "control": {"pump": {"status": False}, "light": {"status": True}}})
        rc.evaluate(time.time(), True, None)
        self.assertEqual(fg.levels[40], 0)
        self.assertEqual(fg.levels[38], 1)
        self.assertEqual(fg.levels[37], 1)

        # Bật bơm thủ công -> Relay 2 (chân 38) xuống LOW
        rc.update_remote({"config": {"irrigation_mode": 0, "light_mode": 0},
                          "control": {"pump": {"status": True}, "light": {"status": False}}})
        rc.evaluate(time.time(), True, None)
        self.assertEqual(fg.levels[40], 1)
        self.assertEqual(fg.levels[38], 0)
        self.assertEqual(fg.levels[37], 1)

        rc.shutdown()
        self.assertEqual(fg.levels, {40: 1, 38: 1, 37: 1})
        self.assertEqual(sorted(fg.cleaned), [37, 38, 40])

    def test_controller_safety(self):
        cfg = Stub(relay_enabled=False, pump_pin=31, light_pin=33, active_low=True,
                   max_pump_run_min=0.002, default_irrigation_duration_min=5, relay_report_every_sec=60)
        rc = R.RelayController(cfg)
        rc.update_remote({"config": {"irrigation_mode": 0, "light_mode": ""},
                          "control": {"pump": {"status": True}, "light": {"status": 1}}})
        now = time.time()
        rc.evaluate(now, True, None)
        self.assertTrue(rc.pump.state and rc.light.state)
        self.assertTrue(rc.needs_report("pump"))
        p = rc.report_payload("pump")
        self.assertEqual(set(p), {"actual", "simulated", "last_on_time", "daily_time", "updated_at"})
        self.assertTrue(p["simulated"])
        rc.mark_reported("pump", p)
        self.assertFalse(rc.needs_report("pump"))
        time.sleep(0.2)  # > 0.12 s = max_pump_run
        rc.evaluate(time.time(), True, None)
        self.assertFalse(rc.pump.state)  # khoá an toàn
        self.assertIsNotNone(rc.last_error)
        rc.evaluate(time.time(), True, None)
        self.assertFalse(rc.pump.state)
        rc.update_remote({"config": {"irrigation_mode": 0}, "control": {"pump": {"status": False}}})
        rc.evaluate(time.time(), True, None)
        rc.update_remote({"config": {"irrigation_mode": 0}, "control": {"pump": {"status": True}}})
        rc.evaluate(time.time(), True, None)
        self.assertTrue(rc.pump.state)  # đã bỏ khoá
        self.assertGreater(rc.report_payload("pump")["daily_time"], 0)
        rc.shutdown()
        self.assertFalse(rc.pump.state or rc.light.state)


class TestNetAndFirebase(unittest.TestCase):
    def setUp(self):
        self.mock = MockFirebase(require_auth=True, token_ttl=3600).start()
        self.mock.add_user("dev@x.com", "pw")

    def tearDown(self):
        self.mock.stop()

    def test_netcheck(self):
        self.assertEqual(NetChecker(self.mock.url, 1.0).check(), (True, None))
        self.assertFalse(NetChecker(self.mock.url, 1.0, force_offline=True).check()[0])
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        self.assertFalse(NetChecker("http://127.0.0.1:%d" % port, 1.0).check()[0])
        self.assertFalse(NetChecker("", 1.0).check()[0])

    def test_auth_and_multipath(self):
        url = self.mock.url + "/__auth/v1"
        anon = FirebaseClient(self.mock.url, None, 5)
        self.assertEqual(anon.get("x")[0], 401)
        auth = FirebaseAuth("KEY", "dev@x.com", "pw", url, url, 5)
        c = FirebaseClient(self.mock.url, auth, 5)
        st, _ = c.patch("data", {"2026-01-01/07:00:00": {"temperature": 1, "ts": 1},
                                 "2026-01-01/07:00:05": {"temperature": 2, "ts": 2}})
        self.assertEqual(st, 200)
        self.assertEqual(self.mock.get("data/2026-01-01/07:00:05/temperature"), 2)
        st, body = c.post("logs/firebase_writes/2026-01-01", {"ts": {".sv": "timestamp"}})
        self.assertEqual(st, 200)
        logs = self.mock.get("logs/firebase_writes/2026-01-01")
        self.assertIsInstance(logs[body["name"]]["ts"], int)
        # token bị thu hồi phía server -> 401 -> tự đăng nhập/refresh lại 1 lần
        self.mock.tokens.clear()
        self.assertEqual(c.get("data")[0], 200)
        # token hết hạn phía client -> dùng refresh token
        auth._exp_mono = 0
        self.assertEqual(c.put("devices/d/status/online", True)[0], 200)
        self.assertIs(self.mock.get("devices/d/status/online"), True)

    def test_live_snapshot_and_read_now(self):
        tmp = tempfile.mkdtemp(prefix="edge-live-")
        try:
            args = Stub(simulate=True, replay=None, offline=False, assume_synced=True,
                        fake_sync_delay=None, interval=3600, device_id="jetson-live",
                        data_dir=os.path.join(tmp, "data"), log_dir=os.path.join(tmp, "logs"),
                        log_level="WARNING", mock_url=self.mock.url)
            cfg = load_config(args=args)
            cfg.api_key, cfg.email, cfg.password = "KEY", "dev@x.com", "pw"
            agent = FarmAgent(cfg)
            try:
                agent._sync_live_snapshot()
                live = self.mock.get("devices/jetson-live/live")
                self.assertIsInstance(live, dict)
                self.assertEqual(live.get("source"), "heartbeat")
                self.assertIn("temperature", live)
                self.assertIn("humidity", live)
                self.assertIsInstance(live.get("updated_at"), int)
                # Không làm bẩn bảng lịch sử /data hay hàng đợi SQLite
                self.assertIsNone(self.mock.get("data"))
                self.assertEqual(agent.queue.count(), 0)

                # Lệnh đọc tức thời từ Dashboard
                self.mock.set("devices/jetson-live/command/read_now", {"request_id": "req-001"})
                agent._handle_read_now_command()
                live2 = self.mock.get("devices/jetson-live/live")
                ack = self.mock.get("devices/jetson-live/command/read_now_ack")
                self.assertEqual(live2.get("source"), "manual")
                self.assertEqual(live2.get("request_id"), "req-001")
                self.assertEqual(ack.get("status"), "ok")
                self.assertEqual(ack.get("request_id"), "req-001")

                # Gọi lại với cùng request_id -> bỏ qua (không đọc lại)
                prev_mono = agent._last_read_mono
                agent._handle_read_now_command()
                self.assertEqual(agent._last_read_mono, prev_mono)
            finally:
                agent.sensors.close()
                agent.queue.close()
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)
