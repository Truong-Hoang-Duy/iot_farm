# -*- coding: utf-8 -*-
"""Điểm vào dòng lệnh của edge agent."""
import argparse
import json
import logging
import os
import signal
import sys
import time

from . import __version__
from .config import load_config

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build_arg_parser():
    p = argparse.ArgumentParser(
        prog="run_agent.py",
        description="IoT Farm edge agent cho Jetson Nano (CWT 7in1 + DHT20 -> SQLite -> Firebase RTDB)",
    )
    p.add_argument("--config", "-c", default=None,
                   help="file cấu hình INI (mặc định: edge/config.ini nếu tồn tại)")
    p.add_argument("--simulate", action="store_true", help="dùng cảm biến giả lập (chạy trên PC)")
    p.add_argument("--replay", metavar="JSON", default=None,
                   help="giả lập bằng cách phát lại file soil_all.json (ngầm bật --simulate)")
    p.add_argument("--once", action="store_true", help="đọc cảm biến 1 lần, in JSON rồi thoát (test phần cứng)")
    p.add_argument("--offline", action="store_true", help="ép kiểm tra mạng luôn thất bại (demo bộ đệm offline)")
    p.add_argument("--mock-url", dest="mock_url", default=None,
                   help="ghi đè db_url, ví dụ http://127.0.0.1:9000 (mock Firebase để test)")
    p.add_argument("--assume-synced", action="store_true",
                   help="tin đồng hồ hệ thống khi không có timedatectl/SNTP (PC, test)")
    p.add_argument("--fake-sync-delay", type=float, default=None, metavar="SEC",
                   help="(test) coi như chưa đồng bộ giờ trong SEC giây đầu để thử hiệu chỉnh thời gian")
    p.add_argument("--interval", type=int, default=None, help="chu kỳ lấy mẫu ban đầu (5..86400 s)")
    p.add_argument("--device-id", default=None)
    p.add_argument("--data-dir", default=None)
    p.add_argument("--log-dir", default=None)
    p.add_argument("--log-level", default=None, help="DEBUG/INFO/WARNING")
    p.add_argument("--version", action="version", version="farm-agent %s" % __version__)
    return p


def run_once(cfg):
    """Đọc cảm biến 1 lần và in kết quả (không đụng Firebase / SQLite)."""
    logging.basicConfig(level=logging.DEBUG if cfg.log_level == "DEBUG" else logging.INFO,
                        format="%(levelname)s %(name)s: %(message)s")
    from .agent import sanitize_payload
    from .sensors import build_sensors
    from .timeutil import record_key

    suite = build_sensors(cfg)
    try:
        fields, status, errors = suite.read_all()
    finally:
        suite.close()
    now = time.time()
    out = {
        "key": record_key(now),
        "ts": int(round(now)),
        "simulate": cfg.simulate,
        "record": sanitize_payload(fields),
        "sensors": status,
        "errors": errors,
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0 if out["record"] else 1


def main(argv=None):
    args = build_arg_parser().parse_args(argv)
    cfg_path = args.config
    if cfg_path is None:
        default = os.path.join(BASE_DIR, "config.ini")
        cfg_path = default if os.path.exists(default) else None
    try:
        cfg = load_config(cfg_path, BASE_DIR, args)
    except Exception as e:  # noqa: BLE001
        sys.stderr.write("Lỗi cấu hình: %s\n" % e)
        return 2

    if args.once:
        return run_once(cfg)

    from .logsetup import setup_logging
    from .agent import FarmAgent

    setup_logging(cfg.log_dir, cfg.log_level)
    log = logging.getLogger("farm_agent.main")
    if cfg_path is None:
        log.warning("Không có file cấu hình -> dùng giá trị mặc định (xem config.example.ini)")

    try:
        agent = FarmAgent(cfg)
    except Exception:  # noqa: BLE001
        log.exception("Không khởi tạo được agent")
        return 1

    def _on_signal(signum, frame):  # noqa: ARG001
        log.info("Nhận tín hiệu %s -> dừng an toàn", signum)
        agent.request_stop()

    for name in ("SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"):
        sig = getattr(signal, name, None)
        if sig is not None:
            try:
                signal.signal(sig, _on_signal)
            except (ValueError, OSError, RuntimeError):
                pass

    agent.start()
    try:
        while not agent.stop_event.wait(1.0):
            pass
    except KeyboardInterrupt:
        agent.request_stop()
    agent.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
