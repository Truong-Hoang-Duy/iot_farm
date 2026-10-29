/** Tiện ích xử lý dữ liệu thời tiết dùng chung. */
import { num, type WeatherHourly } from '@/services/backendAPI';

export const SUM_VARS = new Set(['precipitation', 'rain', 'et0_fao_evapotranspiration']);

/** Mô tả mã thời tiết WMO (Open-Meteo weather_code). */
export function wmoDescription(code: number | undefined): { text: string; emoji: string } {
  if (code === undefined) return { text: '', emoji: '🌤️' };
  if (code === 0) return { text: 'Trời quang', emoji: '☀️' };
  if (code === 1) return { text: 'Ít mây', emoji: '🌤️' };
  if (code === 2) return { text: 'Mây rải rác', emoji: '⛅' };
  if (code === 3) return { text: 'Nhiều mây', emoji: '☁️' };
  if (code === 45 || code === 48) return { text: 'Sương mù', emoji: '🌫️' };
  if (code >= 51 && code <= 57) return { text: 'Mưa phùn', emoji: '🌦️' };
  if (code >= 61 && code <= 67) return { text: code >= 65 ? 'Mưa to' : 'Mưa', emoji: '🌧️' };
  if (code >= 80 && code <= 82) return { text: 'Mưa rào', emoji: '🌦️' };
  if (code >= 95) return { text: 'Dông', emoji: '⛈️' };
  return { text: `Mã ${code}`, emoji: '🌤️' };
}

export function val(row: WeatherHourly | Record<string, unknown> | undefined, key: string): number | undefined {
  if (!row) return undefined;
  return num((row as Record<string, unknown>)[key]);
}

const VN_OFFSET = 7 * 3600_000;

/** Gộp dữ liệu giờ → ngày (theo giờ VN): trung bình, riêng mưa/ET0 là tổng. Thêm _max/_min cho nhiệt độ. */
export function aggregateDaily(rows: WeatherHourly[]): WeatherHourly[] {
  const buckets = new Map<number, WeatherHourly[]>();
  for (const r of rows) {
    const day = Math.floor((r.ts + VN_OFFSET) / 86400_000) * 86400_000 - VN_OFFSET;
    const arr = buckets.get(day) ?? [];
    arr.push(r);
    buckets.set(day, arr);
  }
  const out: WeatherHourly[] = [];
  for (const [day, arr] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const keys = new Set<string>();
    arr.forEach((r) => Object.keys(r).forEach((k) => k !== 't' && k !== 'ts' && keys.add(k)));
    const row: WeatherHourly = { t: new Date(day).toISOString(), ts: day };
    for (const k of keys) {
      const vs = arr.map((r) => val(r, k)).filter((v): v is number => v !== undefined);
      if (!vs.length) continue;
      const sum = vs.reduce((a, b) => a + b, 0);
      row[k] = SUM_VARS.has(k) ? sum : sum / vs.length;
      if (k === 'temperature_2m') {
        row.temperature_2m_max = Math.max(...vs);
        row.temperature_2m_min = Math.min(...vs);
      }
    }
    row._hours = arr.length;
    out.push(row);
  }
  return out;
}

/** Tổng một biến trong khoảng [from, to). */
export function sumBetween(rows: WeatherHourly[], key: string, from: number, to: number): { sum: number; n: number } {
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    if (r.ts < from || r.ts >= to) continue;
    const v = val(r, key);
    if (v === undefined) continue;
    sum += v;
    n++;
  }
  return { sum, n };
}

export function statsBetween(rows: WeatherHourly[], key: string, from: number, to: number) {
  const vs = rows.filter((r) => r.ts >= from && r.ts < to).map((r) => val(r, key)).filter((v): v is number => v !== undefined);
  if (!vs.length) return undefined;
  return { max: Math.max(...vs), min: Math.min(...vs), mean: vs.reduce((a, b) => a + b, 0) / vs.length, n: vs.length };
}

export function nearestRow(rows: WeatherHourly[], ts: number): WeatherHourly | undefined {
  let best: WeatherHourly | undefined;
  let d = Infinity;
  for (const r of rows) {
    const dd = Math.abs(r.ts - ts);
    if (dd < d) {
      d = dd;
      best = r;
    }
  }
  return best;
}
