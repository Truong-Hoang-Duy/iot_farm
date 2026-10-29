"""Nạp dữ liệu lịch sử (soil_all.json) vào InfluxDB 3 và (tùy chọn) đẩy lên Firebase.

Ví dụ:
    cd backend
    .venv\\Scripts\\python.exe -m scripts.seed_influx --json ../frontend/public/soil_all.json
    .venv\\Scripts\\python.exe -m scripts.seed_influx --push-firebase --days 7   # đẩy 7 ngày cuối lên Firebase
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import SOIL_JSON_PATH  # noqa: E402
from app.services import influx_service as ix  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Seed InfluxDB 3 từ soil_all.json")
    ap.add_argument("--json", default=str(SOIL_JSON_PATH))
    ap.add_argument("--push-firebase", action="store_true", help="Đẩy dữ liệu lên Firebase (PATCH theo ngày)")
    ap.add_argument("--days", type=int, default=0, help="Chỉ đẩy N ngày cuối lên Firebase (0 = tất cả)")
    ap.add_argument("--skip-influx", action="store_true")
    args = ap.parse_args()

    raw = json.loads(Path(args.json).read_text(encoding="utf-8"))
    data = raw.get("data", raw)
    days = sorted(data.keys())
    print(f"Đọc {len(days)} ngày từ {args.json} ({days[0]} -> {days[-1]})")

    if not args.skip_influx:
        print("InfluxDB:", ix.health())
        t0 = time.time()
        lines = (
            ix.sensor_record_to_line(d, t, rec)
            for d in days for t, rec in (data[d] or {}).items()
        )
        n = ix.write_lines(lines)
        print(f"Đã ghi {n} điểm vào InfluxDB ({time.time() - t0:.1f}s)")
        ix.write_sync_log({"direction": "seed_to_influx", "status": "ok", "n_records": n,
                           "range_start": days[0], "range_end": days[-1],
                           "duration_ms": int((time.time() - t0) * 1000), "detail": Path(args.json).name})
        print("Khoảng thời gian trong InfluxDB:", ix.sensor_time_range())

    if args.push_firebase:
        from app.services.firebase_client import get_firebase

        sel = days[-args.days:] if args.days > 0 else days

        async def push() -> None:
            fb = get_firebase()
            print("Firebase:", fb.info())
            total = 0
            for d in sel:
                recs = {t: {k: v for k, v in rec.items() if k != "light"}
                        for t, rec in (data[d] or {}).items() if isinstance(rec, dict) and rec}
                if recs:
                    await fb.patch(f"data/{d}", recs)
                    total += len(recs)
                    print(f"  {d}: {len(recs)} bản ghi")
            print(f"Đã đẩy {total} bản ghi lên Firebase")

        asyncio.run(push())


if __name__ == "__main__":
    main()

