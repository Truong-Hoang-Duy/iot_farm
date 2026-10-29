"""Đồng bộ 2 chiều Firebase RTDB <-> InfluxDB 3.

* Firebase -> InfluxDB (fast loop, mỗi SYNC_INTERVAL_SEC): ngày hôm nay, hôm qua và các ngày được
  Jetson báo là vừa đẩy dữ liệu tồn đọng (logs/firebase_writes, from_backlog=true).
* Audit (mỗi SYNC_AUDIT_INTERVAL_SEC): đối chiếu từng ngày (SYNC_AUDIT_DAYS gần nhất, 0 = tất cả):
    - key có trên Firebase nhưng thiếu trong Influx  -> ghi vào Influx
    - key có trong Influx nhưng thiếu trên Firebase -> backfill lên Firebase (BACKFILL_DAYS gần nhất)
So khớp theo "giây trong ngày" nên key cũ "HH:MM" và key mới "HH:MM:SS" tương đương nhau.
Mọi lần chạy được ghi log vào Influx (bảng sync_log) và Firebase (logs/sync/{YYYY-MM-DD}).
"""
from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Deque, Dict, List, Optional, Set, Tuple

import pandas as pd

from app.core.config import (
    BACKFILL_DAYS,
    BACKFILL_TO_FIREBASE,
    CACHE_DIR,
    DEVICE_ID,
    SENSOR_FIELDS,
    SYNC_AUDIT_DAYS,
    SYNC_AUDIT_INTERVAL_SEC,
    SYNC_ENABLED,
    SYNC_INTERVAL_SEC,
    SYNC_LOG_NOOP_TO_FIREBASE,
)
from app.services import influx_service as ix
from app.services.firebase_client import SERVER_TIMESTAMP, get_firebase

STATE_FILE = CACHE_DIR / "sync_state.json"
FB_TO_IX = "firebase_to_influx"
IX_TO_FB = "influx_to_firebase"
LOCAL = timezone(timedelta(hours=7))


def _today_local() -> str:
    return datetime.now(LOCAL).strftime("%Y-%m-%d")


def _day_shift(day: str, n: int) -> str:
    return (datetime.strptime(day, "%Y-%m-%d") + timedelta(days=n)).strftime("%Y-%m-%d")


def _sod_to_key(sod: int) -> str:
    return f"{sod // 3600:02d}:{(sod % 3600) // 60:02d}:{sod % 60:02d}"


class SyncService:
    def __init__(self) -> None:
        self.fb = get_firebase()
        self.lock = asyncio.Lock()
        self.recent: Deque[Dict[str, Any]] = deque(maxlen=200)
        self.state: Dict[str, Any] = self._load_state()
        self._last_fb_error_log: Dict[str, float] = {}
        self.running = False

    # ---------------------------------------------------------------- state
    def _load_state(self) -> Dict[str, Any]:
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _save_state(self) -> None:
        try:
            STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
            STATE_FILE.write_text(json.dumps(self.state, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as exc:
            print(f"[Sync] Không lưu được state: {exc}")

    # ------------------------------------------------------------------ log
    async def _log(
        self, direction: str, status: str, n: int, t0: float,
        range_start: Optional[str] = None, range_end: Optional[str] = None,
        error: Optional[str] = None, detail: Optional[str] = None, trigger: str = "",
    ) -> Dict[str, Any]:
        entry = {
            "direction": direction,
            "status": status,
            "n_records": int(n),
            "range_start": range_start,
            "range_end": range_end,
            "duration_ms": int((time.time() - t0) * 1000),
            "error": error,
            "detail": detail,
            "trigger": trigger,
            "time": datetime.now(LOCAL).isoformat(timespec="seconds"),
        }
        self.recent.appendleft(entry)
        print(f"[Sync] {direction} {status} n={n} {range_start or ''}..{range_end or ''} {error or ''}")
        await asyncio.to_thread(ix.write_sync_log, entry)
        push = status == "ok" and n > 0 or (status == "noop" and SYNC_LOG_NOOP_TO_FIREBASE)
        if status == "error":
            # tránh spam: tối đa 1 log lỗi / 10 phút / chiều
            last = self._last_fb_error_log.get(direction, 0)
            if time.time() - last > 600:
                push = True
                self._last_fb_error_log[direction] = time.time()
        if push:
            try:
                fb_entry = {k: v for k, v in entry.items() if v is not None and k != "time"}
                fb_entry["ts"] = SERVER_TIMESTAMP
                fb_entry["host"] = "backend"
                await self.fb.post(f"logs/sync/{_today_local()}", fb_entry)
            except Exception as exc:
                print(f"[Sync] Không ghi được log lên Firebase: {exc}")
        return entry

    # -------------------------------------------------------------- helpers
    async def _influx_sods(self, days: List[str]) -> Dict[str, Set[int]]:
        """{day: set(giây trong ngày)} cho các ngày (1 truy vấn cho cả khoảng)."""
        if not days:
            return {}
        lo = ix.local_day_bounds_utc(min(days))[0]
        hi = ix.local_day_bounds_utc(max(days))[1]
        rows = await asyncio.to_thread(
            ix.query, f"SELECT time FROM {ix.SENSOR_TABLE} WHERE time >= '{lo}' AND time < '{hi}'", 300.0
        )
        out: Dict[str, Set[int]] = {d: set() for d in days}
        for r in rows:
            ts = int(pd.Timestamp(r["time"], tz="UTC").timestamp()) if pd.Timestamp(r["time"]).tzinfo is None \
                else int(pd.Timestamp(r["time"]).timestamp())
            d, t = ix.epoch_to_keys(ts)
            sod = ix.parse_time_key(t)
            if d in out and sod is not None:
                out[d].add(sod)
        return out

    async def _fb_day_keys(self, day: str) -> Dict[int, str]:
        keys = await self.fb.shallow_keys(f"data/{day}")
        out: Dict[int, str] = {}
        for k in keys:
            sod = ix.parse_time_key(k)
            if sod is not None:
                out[sod] = k
        return out

    async def _copy_fb_to_influx(self, day: str, missing: Dict[int, str]) -> int:
        """Đọc các key thiếu của 1 ngày từ Firebase và ghi vào Influx."""
        if not missing:
            return 0
        if len(missing) > 40:
            data = await self.fb.get(f"data/{day}") or {}
            items = [(k, data.get(k)) for k in missing.values()]
        else:
            sem = asyncio.Semaphore(8)

            async def one(k: str) -> Tuple[str, Any]:
                async with sem:
                    return k, await self.fb.get(f"data/{day}/{k}")

            items = await asyncio.gather(*(one(k) for k in missing.values()))
        lines = [ix.sensor_record_to_line(day, k, rec) for k, rec in items if isinstance(rec, dict)]
        return await asyncio.to_thread(ix.write_lines, lines)

    async def _copy_influx_to_fb(self, day: str, sods: Set[int]) -> int:
        rows = await asyncio.to_thread(ix.sensor_day_rows, day)
        patch: Dict[str, Any] = {}
        for r in rows:
            t = pd.Timestamp(r["time"])
            t = t.tz_localize("UTC") if t.tzinfo is None else t
            d, tkey = ix.epoch_to_keys(int(t.timestamp()))
            sod = ix.parse_time_key(tkey)
            if d != day or sod not in sods:
                continue
            key = r.get("key") or _sod_to_key(sod)
            rec = {f: r.get(f) for f in SENSOR_FIELDS if r.get(f) is not None}
            if not rec:
                continue
            rec["ts"] = int(t.timestamp())
            rec["tq"] = r.get("tq") or "backfill"
            patch[key] = rec
        n = 0
        items = list(patch.items())
        for i in range(0, len(items), 500):
            chunk = dict(items[i:i + 500])
            await self.fb.patch(f"data/{day}", chunk)
            n += len(chunk)
        return n

    async def _backlog_hint_days(self) -> Set[str]:
        """Các ngày Jetson vừa đẩy dữ liệu tồn đọng (từ logs/firebase_writes hôm nay)."""
        days: Set[str] = set()
        try:
            logs = await self.fb.query_by_key(f"logs/firebase_writes/{_today_local()}", limit_to_last=50) or {}
            seen = set(self.state.get("seen_backlog_logs", []))
            new_seen = list(seen)
            for pid, e in (logs.items() if isinstance(logs, dict) else []):
                if not isinstance(e, dict) or not e.get("from_backlog") or pid in seen:
                    continue
                new_seen.append(pid)
                for k in ("first_key", "last_key"):
                    v = str(e.get(k) or "")
                    if len(v) >= 10:
                        days.add(v[:10])
                if len(days) == 2:
                    a, b = sorted(days)
                    cur = a
                    while cur < b:
                        days.add(cur)
                        cur = _day_shift(cur, 1)
            self.state["seen_backlog_logs"] = new_seen[-500:]
        except Exception:
            pass
        return days

    # ------------------------------------------------------------ operations
    async def sync_days_fb_to_influx(self, days: List[str], trigger: str) -> Dict[str, Any]:
        t0 = time.time()
        try:
            ix_sods = await self._influx_sods(days)
            total = 0
            touched: List[str] = []
            for day in sorted(days):
                fb_keys = await self._fb_day_keys(day)
                missing = {s: k for s, k in fb_keys.items() if s not in ix_sods.get(day, set())}
                if missing:
                    total += await self._copy_fb_to_influx(day, missing)
                    touched.append(day)
            status = "ok" if total else "noop"
            return await self._log(
                FB_TO_IX, status, total, t0,
                touched[0] if touched else (min(days) if days else None),
                touched[-1] if touched else (max(days) if days else None),
                detail=f"days={','.join(touched) or '-'}", trigger=trigger,
            )
        except Exception as exc:
            return await self._log(FB_TO_IX, "error", 0, t0, error=str(exc)[:300], trigger=trigger)

    async def fast_sync(self, trigger: str = "fast") -> Dict[str, Any]:
        today = _today_local()
        days = {today, _day_shift(today, -1)}
        days |= await self._backlog_hint_days()
        async with self.lock:
            res = await self.sync_days_fb_to_influx(sorted(days), trigger)
            self.state["last_fast"] = res
            self._save_state()
            return res

    async def audit(self, trigger: str = "audit") -> Dict[str, Any]:
        """Đối chiếu toàn bộ + backfill 2 chiều."""
        async with self.lock:
            t0 = time.time()
            try:
                fb_days = set(await self.fb.shallow_keys("data"))
            except Exception as exc:
                res = await self._log(FB_TO_IX, "error", 0, t0, error=f"Firebase: {exc}"[:300], trigger=trigger)
                return {"fb_to_influx": res}
            try:
                ix_counts = await asyncio.to_thread(ix.sensor_day_counts)
            except Exception as exc:
                res = await self._log(FB_TO_IX, "error", 0, t0, error=f"InfluxDB: {exc}"[:300], trigger=trigger)
                return {"fb_to_influx": res}
            all_days = sorted(fb_days | set(ix_counts))
            if not all_days:
                res = await self._log(FB_TO_IX, "noop", 0, t0, trigger=trigger, detail="no data")
                return {"fb_to_influx": res}
            latest = all_days[-1]
            if SYNC_AUDIT_DAYS > 0:
                lo = _day_shift(latest, -(SYNC_AUDIT_DAYS - 1))
                all_days = [d for d in all_days if d >= lo]
            bf_lo = _day_shift(latest, -(BACKFILL_DAYS - 1)) if BACKFILL_DAYS > 0 else "0000-00-00"

            ix_sods = await self._influx_sods(all_days)
            sem = asyncio.Semaphore(8)

            async def keys_for(d: str) -> Tuple[str, Dict[int, str]]:
                if d not in fb_days:
                    return d, {}
                async with sem:
                    return d, await self._fb_day_keys(d)

            fb_keys_by_day = dict(await asyncio.gather(*(keys_for(d) for d in all_days)))

            n_in, n_out, days_in, days_out, errors = 0, 0, [], [], []
            for d in all_days:
                fbk = fb_keys_by_day.get(d, {})
                ixs = ix_sods.get(d, set())
                miss_ix = {s: k for s, k in fbk.items() if s not in ixs}
                miss_fb = {s for s in ixs if s not in fbk}
                try:
                    if miss_ix:
                        n_in += await self._copy_fb_to_influx(d, miss_ix)
                        days_in.append(d)
                    if miss_fb and BACKFILL_TO_FIREBASE and d >= bf_lo:
                        n_out += await self._copy_influx_to_fb(d, miss_fb)
                        days_out.append(d)
                except Exception as exc:
                    errors.append(f"{d}: {exc}"[:200])
            st_in = "error" if errors and not n_in else ("ok" if n_in else "noop")
            r_in = await self._log(
                FB_TO_IX, st_in, n_in, t0, days_in[0] if days_in else all_days[0],
                days_in[-1] if days_in else all_days[-1],
                error="; ".join(errors)[:300] or None,
                detail=f"audit {len(all_days)} ngày; bù {len(days_in)} ngày", trigger=trigger,
            )
            st_out = "ok" if n_out else "noop"
            r_out = await self._log(
                IX_TO_FB, st_out, n_out, t0, days_out[0] if days_out else None,
                days_out[-1] if days_out else None,
                detail=(f"backfill {len(days_out)} ngày (cửa sổ từ {bf_lo})" if BACKFILL_TO_FIREBASE
                        else "backfill tắt"), trigger=trigger,
            )
            self.state["last_audit"] = {"time": r_in["time"], "fb_to_influx": r_in, "influx_to_firebase": r_out,
                                        "days_checked": len(all_days)}
            self._save_state()
            return {"fb_to_influx": r_in, "influx_to_firebase": r_out}

    # --------------------------------------------------------------- worker
    async def worker(self) -> None:
        if not SYNC_ENABLED:
            print("[Sync] SYNC_ENABLED=false – bỏ qua worker đồng bộ.")
            return
        self.running = True
        print(f"[Sync] Worker khởi động (fast={SYNC_INTERVAL_SEC}s, audit={SYNC_AUDIT_INTERVAL_SEC}s).")
        await asyncio.sleep(5)
        last_audit = 0.0
        try:
            while True:
                try:
                    if time.time() - last_audit >= SYNC_AUDIT_INTERVAL_SEC:
                        await self.audit()
                        last_audit = time.time()
                    else:
                        await self.fast_sync()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    print(f"[Sync] Lỗi worker: {exc}")
                await asyncio.sleep(SYNC_INTERVAL_SEC)
        finally:
            self.running = False

    def status(self) -> Dict[str, Any]:
        return {
            "enabled": SYNC_ENABLED,
            "running": self.running,
            "device_id": DEVICE_ID,
            "config": {
                "sync_interval_sec": SYNC_INTERVAL_SEC,
                "audit_interval_sec": SYNC_AUDIT_INTERVAL_SEC,
                "audit_days": SYNC_AUDIT_DAYS,
                "backfill_to_firebase": BACKFILL_TO_FIREBASE,
                "backfill_days": BACKFILL_DAYS,
            },
            "firebase": self.fb.info(),
            "influx": ix.health(),
            "last_fast": self.state.get("last_fast"),
            "last_audit": self.state.get("last_audit"),
            "recent": list(self.recent)[:50],
        }


_service: Optional[SyncService] = None


def get_sync_service() -> SyncService:
    global _service
    if _service is None:
        _service = SyncService()
    return _service

