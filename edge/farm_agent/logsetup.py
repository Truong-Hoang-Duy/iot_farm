# -*- coding: utf-8 -*-
"""Cấu hình logging: file xoay vòng logs/agent.log (5 MB x 5) + console,
và logs/uploads.log riêng (mỗi lô upload 1 dòng)."""
import io
import logging
import logging.handlers
import os
import sys

FMT = "%(asctime)s %(levelname)-7s [%(threadName)s] %(name)s: %(message)s"
_KEEP = []  # giữ tham chiếu wrapper: nếu bị GC, TextIOWrapper sẽ đóng luôn stdout.buffer


def _console_stream():
    """Tránh UnicodeEncodeError khi console không phải UTF-8 (systemd LANG=C, Windows pipe)."""
    stream = sys.stdout
    enc = (getattr(stream, "encoding", "") or "").lower().replace("-", "")
    if "utf8" in enc:
        return stream
    if _KEEP:
        return _KEEP[0]
    try:
        w = io.TextIOWrapper(stream.buffer, encoding=enc or "ascii", errors="backslashreplace",
                             line_buffering=True)
        _KEEP.append(w)
        return w
    except Exception:  # noqa: BLE001
        return stream


def setup_logging(log_dir, level="INFO", console=True):
    if not os.path.isdir(log_dir):
        os.makedirs(log_dir)
    lvl = getattr(logging, str(level).upper(), logging.INFO)
    root = logging.getLogger("farm_agent")
    root.setLevel(lvl)
    root.propagate = False
    for h in list(root.handlers):
        root.removeHandler(h)
    fmt = logging.Formatter(FMT)
    fh = logging.handlers.RotatingFileHandler(
        os.path.join(log_dir, "agent.log"), maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    fh.setFormatter(fmt)
    root.addHandler(fh)
    if console:
        ch = logging.StreamHandler(_console_stream())
        ch.setFormatter(fmt)
        root.addHandler(ch)

    up = logging.getLogger("farm_agent.uploads")
    up.setLevel(logging.INFO)
    up.propagate = False
    for h in list(up.handlers):
        up.removeHandler(h)
    uh = logging.handlers.RotatingFileHandler(
        os.path.join(log_dir, "uploads.log"), maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    uh.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    up.addHandler(uh)
    return root
