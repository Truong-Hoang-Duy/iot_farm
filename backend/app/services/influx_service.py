"""InfluxDB 3 Core client qua HTTP API v3 (không cần thư viện gRPC/Flight).

Bảng (table) trong database INFLUX_DB:
* sensor_data  tags: device_id | fields: temperature, humidity, soiltemp, moisture, pH, EC, N, P, K (float),
               tq (string), key (string – key thời gian gốc trên Firebase "HH:MM" hoặc "HH:MM:SS")
* weather      tags: kind, location | fields: các biến Open-Meteo
* sync_log     tags: direction, status | fields: n_records, duration_ms, range_start, range_end, error
"""
from __future__ import annotations

import math
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

import httpx
import pandas as pd

from app.core.config import DEVICE_ID, FARM_TZ, INFLUX_DB, INFLUX_TOKEN, INFLUX_URL, SENSOR_FIELDS

LOCAL_TZ_OFFSET = timedelta(hours=7)  # Asia/Ho_Chi_Minh không có DST
SENSOR_TABLE = "sensor_data"
_EFFECTIVE_URL = INFLUX_URL.replace("://localhost", "://127.0.0.1")
_health_cache: Dict[str, Any] = {"at": 0.0, "res": None}


class InfluxError(Exception):
    pass


def _headers(content_type: Optional[str] = None) -> Dict[str, str]:
    h: Dict[str, str] = {}
    if INFLUX_TOKEN:
        h["Authorization"] = f"Bearer {INFLUX_TOKEN}"
    if content_type:
        h["Content-Type"] = content_type
    return h


def _client(timeout: float = 60.0, connect_timeout: float = 1.5) -> httpx.Client:
    return httpx.Client(base_url=_EFFECTIVE_URL, timeout=httpx.Timeout(timeout, connect=connect_timeout))


# ---------------------------------------------------------------------------
# Line protocol helpers
# ---------------------------------------------------------------------------
def _esc_tag(v: str) -> str:
    return str(v).replace("\\", "\\\\").replace(",", "\\,").replace("=", "\\=").replace(" ", "\\ ")


def _esc_str(v: str) -> str:
    return str(v).replace("\\", "\\\\").replace('"', '\\"')


def _fmt_field(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return repr(f)  # luôn là float (không hậu tố i) để kiểu cột nhất quán
    return f'"{_esc_str(v)}"'


def to_line(table: str, tags: Dict[str, Any], fields: Dict[str, Any], ts_sec: int) -> Optional[str]:
    fparts = []
    for k, v in fields.items():
        fv = _fmt_field(v)
        if fv is not None:
            fparts.append(f"{_esc_tag(k)}={fv}")
    if not fparts:
        return None
    tparts = "".join(f",{_esc_tag(k)}={_esc_tag(v)}" for k, v in sorted(tags.items()) if v not in (None, ""))
    return f"{_esc_tag(table)}{tparts} {','.join(fparts)} {int(ts_sec)}"


# ---------------------------------------------------------------------------
# Key Firebase <-> timestamp
# ---------------------------------------------------------------------------
def parse_time_key(t: str) -> Optional[int]:
    """'HH:MM' hoặc 'HH:MM:SS' -> giây trong ngày."""
    try:
        parts = [int(p) for p in t.split(":")]
        if len(parts) == 2:
            h, m, s = parts[0], parts[1], 0
        elif len(parts) == 3:
            h, m, s = parts
        else:
            return None
        if not (0 <= h < 24 and 0 <= m < 60 and 0 <= s < 60):
            return None
        return h * 3600 + m * 60 + s
    except (ValueError, AttributeError):
        return None


def key_to_epoch(date_key: str, time_key: str) -> Optional[int]:
    sod = parse_time_key(time_key)
    if sod is None:
        return None
    try:
        d = datetime.strptime(date_key, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return int((d - LOCAL_TZ_OFFSET).timestamp()) + sod


def epoch_to_keys(ts: int) -> tuple[str, str]:
    local = datetime.fromtimestamp(ts, tz=timezone.utc) + LOCAL_TZ_OFFSET
    return local.strftime("%Y-%m-%d"), local.strftime("%H:%M:%S")


def local_day_bounds_utc(day: str) -> tuple[str, str]:
    start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc) - LOCAL_TZ_OFFSET
    end = start + timedelta(days=1)
    return start.strftime("%Y-%m-%dT%H:%M:%SZ"), end.strftime("%Y-%m-%dT%H:%M:%SZ")


def sensor_record_to_line(date_key: str, time_key: str, rec: Dict[str, Any], device_id: str = DEVICE_ID) -> Optional[str]:
    ts = key_to_epoch(date_key, time_key)
    if ts is None or not isinstance(rec, dict):
        return None
    fields: Dict[str, Any] = {}
    for f in SENSOR_FIELDS:
        v = rec.get(f)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            fields[f] = float(v)
    if not fields:
        return None
    fields["tq"] = str(rec.get("tq") or "legacy")
    fields["key"] = time_key
    return to_line(SENSOR_TABLE, {"device_id": device_id}, fields, ts)


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------
def health(force: bool = False) -> Dict[str, Any]:
    now = time.time()
    cached = _health_cache.get("res")
    if not force and cached is not None and (now - _health_cache.get("at", 0.0) < 15.0):
        return cached
    try:
        with _client(1.5, connect_timeout=0.8) as c:
            r = c.get("/health", headers=_headers())
            ok = r.status_code == 200
            res = {"ok": ok, "status": r.status_code, "url": INFLUX_URL, "db": INFLUX_DB, "body": r.text[:100]}
    except Exception as exc:
        res = {"ok": False, "url": INFLUX_URL, "db": INFLUX_DB, "error": str(exc)}
    _health_cache["at"] = now
    _health_cache["res"] = res
    return res


def write_lines(lines: Iterable[Optional[str]], chunk: int = 5000) -> int:
    if not health().get("ok"):
        return 0
    buf: List[str] = []
    n = 0
    with _client(120.0) as c:
        def flush() -> None:
            nonlocal n
            if not buf:
                return
            r = c.post(
                "/api/v3/write_lp",
                params={"db": INFLUX_DB, "precision": "second"},
                content="\n".join(buf).encode("utf-8"),
                headers=_headers("text/plain; charset=utf-8"),
            )
            if r.status_code >= 300:
                raise InfluxError(f"Ghi InfluxDB lỗi HTTP {r.status_code}: {r.text[:300]}")
            n += len(buf)
            buf.clear()

        for ln in lines:
            if ln:
                buf.append(ln)
                if len(buf) >= chunk:
                    flush()
        flush()
    return n


def query(sql: str, timeout: float = 120.0) -> List[Dict[str, Any]]:
    """Chạy SQL, trả list dict. Bảng/database chưa tồn tại -> []."""
    if not health().get("ok"):
        raise InfluxError(health().get("error") or "InfluxDB chưa mở cổng kết nối")
    with _client(timeout) as c:
        r = c.post(
            "/api/v3/query_sql",
            json={"db": INFLUX_DB, "q": sql, "format": "json"},
            headers=_headers("application/json"),
        )
    if r.status_code >= 300:
        txt = r.text.lower()
        if r.status_code == 404 or "not found" in txt or "does not exist" in txt:
            return []
        raise InfluxError(f"Truy vấn InfluxDB lỗi HTTP {r.status_code}: {r.text[:300]}")
    try:
        data = r.json()
    except ValueError:
        return []
    return data if isinstance(data, list) else []


def _ts_literal(dt: datetime | date | str) -> str:
    if isinstance(dt, str):
        return dt
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone(LOCAL_TZ_OFFSET))
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return local_day_bounds_utc(dt.isoformat())[0]


def _parse_time_col(df: pd.DataFrame, col: str = "time") -> pd.DataFrame:
    df[col] = pd.to_datetime(df[col], utc=True).dt.tz_convert(FARM_TZ)
    return df


def query_sensor_df(
    start: Optional[datetime | date] = None,
    end: Optional[datetime | date] = None,
    every: Optional[str] = None,
    fields: Optional[List[str]] = None,
    device_id: Optional[str] = None,
) -> pd.DataFrame:
    """Dữ liệu cảm biến -> DataFrame (index tz-aware Asia/Ho_Chi_Minh, cột = fields).
    every: None (dữ liệu gốc) hoặc khoảng gộp, ví dụ '5 minutes', '1 hour'."""
    fields = [f for f in (fields or SENSOR_FIELDS) if f in SENSOR_FIELDS]
    where = []
    if start is not None:
        where.append(f"time >= '{_ts_literal(start)}'")
    if end is not None:
        where.append(f"time < '{_ts_literal(end)}'")
    if device_id:
        where.append(f"device_id = '{device_id}'")
    wsql = (" WHERE " + " AND ".join(where)) if where else ""
    qcols = ", ".join(f'"{f}"' for f in fields)
    if every:
        agg = ", ".join(f'avg("{f}") AS "{f}"' for f in fields)
        sql = (
            f"SELECT date_bin(INTERVAL '{every}', time, TIMESTAMP '1970-01-01T00:00:00Z') AS time, {agg} "
            f"FROM {SENSOR_TABLE}{wsql} GROUP BY 1 ORDER BY 1"
        )
    else:
        sql = f"SELECT time, {qcols} FROM {SENSOR_TABLE}{wsql} ORDER BY time"
    rows = query(sql, timeout=300.0)
    if not rows:
        return pd.DataFrame(columns=fields, index=pd.DatetimeIndex([], tz=FARM_TZ, name="time"))
    df = _parse_time_col(pd.DataFrame(rows)).set_index("time").sort_index()
    for f in fields:
        if f not in df.columns:
            df[f] = float("nan")
    return df[fields].astype("float64")


def sensor_time_range() -> Dict[str, Any]:
    if not health().get("ok"):
        return {"ok": False, "detail": "InfluxDB phụ trợ chưa mở cổng 18181"}
    rows = query(f"SELECT min(time) AS tmin, max(time) AS tmax, count(*) AS n FROM {SENSOR_TABLE}")
    return rows[0] if rows else {}


def sensor_day_counts(days: Optional[List[str]] = None) -> Dict[str, int]:
    """Số bản ghi theo ngày địa phương (UTC+7) -> {YYYY-MM-DD: n}."""
    where = ""
    if days:
        lo = local_day_bounds_utc(min(days))[0]
        hi = local_day_bounds_utc(max(days))[1]
        where = f" WHERE time >= '{lo}' AND time < '{hi}'"
    sql = (
        "SELECT date_bin(INTERVAL '1 day', time, TIMESTAMP '1970-01-01T17:00:00Z') AS d, count(*) AS n "
        f"FROM {SENSOR_TABLE}{where} GROUP BY 1 ORDER BY 1"
    )
    out: Dict[str, int] = {}
    for r in query(sql, timeout=300.0):
        d = pd.to_datetime(r["d"], utc=True) + pd.Timedelta(hours=7)
        out[d.strftime("%Y-%m-%d")] = int(r["n"])
    return out


def sensor_day_rows(day: str) -> List[Dict[str, Any]]:
    lo, hi = local_day_bounds_utc(day)
    cols = ", ".join(f'"{f}"' for f in SENSOR_FIELDS)
    sql = f"SELECT time, {cols}, tq, key FROM {SENSOR_TABLE} WHERE time >= '{lo}' AND time < '{hi}' ORDER BY time"
    return query(sql, timeout=120.0)


def write_sync_log(entry: Dict[str, Any]) -> None:
    if not health().get("ok"):
        return
    ts = int(datetime.now(timezone.utc).timestamp())
    line = to_line(
        "sync_log",
        {"direction": entry.get("direction", ""), "status": entry.get("status", "")},
        {
            "n_records": float(entry.get("n_records", 0)),
            "duration_ms": float(entry.get("duration_ms", 0)),
            "range_start": entry.get("range_start") or "",
            "range_end": entry.get("range_end") or "",
            "error": entry.get("error") or "",
            "detail": entry.get("detail") or "",
        },
        ts,
    )
    try:
        write_lines([line])
    except Exception as exc:
        print(f"[Influx] Không ghi được sync_log: {exc}")


def query_sync_logs(limit: int = 200, direction: Optional[str] = None) -> List[Dict[str, Any]]:
    if not health().get("ok"):
        return []
    where = f" WHERE direction = '{direction}'" if direction else ""
    sql = (
        "SELECT time, direction, status, n_records, duration_ms, range_start, range_end, error, detail "
        f"FROM sync_log{where} ORDER BY time DESC LIMIT {int(limit)}"
    )
    try:
        rows = query(sql)
    except Exception:
        return []
    for r in rows:
        r["time"] = pd.to_datetime(r["time"], utc=True).tz_convert(FARM_TZ).isoformat()
    return rows


def write_weather_df(df: pd.DataFrame, location: str = "farm") -> int:
    if df is None or df.empty or not health().get("ok"):
        return 0
    lines = []
    for ts, row in df.iterrows():
        kind = row.get("kind", "archive") if "kind" in row else "archive"
        fields = {k: v for k, v in row.items() if k != "kind"}
        lines.append(to_line("weather", {"kind": kind, "location": location}, fields, int(ts.timestamp())))
    return write_lines(lines)
