/** Tiện ích định dạng & biểu đồ dùng chung cho các component dự báo / thời tiết. */
import type { CSSProperties } from 'react';

export const VN_TZ = 'Asia/Ho_Chi_Minh';

const dtFmt = new Intl.DateTimeFormat('vi-VN', {
  timeZone: VN_TZ,
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour12: false,
});
const timeFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: VN_TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const dayMonthFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: VN_TZ, day: '2-digit', month: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: VN_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: VN_TZ, weekday: 'short', day: '2-digit', month: '2-digit' });

const ok = (ms: unknown): ms is number => typeof ms === 'number' && Number.isFinite(ms);

/** "14:05 29/10/2026" */
export function fmtDateTime(ms: number | undefined): string {
  if (!ok(ms)) return '—';
  const parts = dtFmt.formatToParts(new Date(ms));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('hour')}:${g('minute')} ${g('day')}/${g('month')}/${g('year')}`;
}

/** "14:05" */
export function fmtTime(ms: number | undefined): string {
  return ok(ms) ? timeFmt.format(new Date(ms)) : '—';
}

/** "29/10/2026" */
export function fmtDate(ms: number | undefined): string {
  return ok(ms) ? dayFmt.format(new Date(ms)) : '—';
}

/** "T5, 29/10" */
export function fmtWeekday(ms: number | undefined): string {
  return ok(ms) ? weekdayFmt.format(new Date(ms)) : '—';
}

/** Nhãn trục X tuỳ theo độ dài khoảng thời gian hiển thị. */
export function makeTimeTick(spanMs: number) {
  return (ms: number) => {
    if (!ok(ms)) return '';
    if (spanMs <= 36 * 3600 * 1000) return timeFmt.format(new Date(ms));
    if (spanMs <= 6 * 86400 * 1000) return `${dayMonthFmt.format(new Date(ms))} ${timeFmt.format(new Date(ms))}`;
    return dayMonthFmt.format(new Date(ms));
  };
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function fmtRelative(ms: number | undefined): string {
  if (!ok(ms)) return '';
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'trước' : 'nữa';
  if (abs < 60_000) return 'vừa xong';
  if (abs < 3600_000) return `${Math.round(abs / 60_000)} phút ${suffix}`;
  if (abs < 86400_000) return `${Math.round(abs / 3600_000)} giờ ${suffix}`;
  return `${Math.round(abs / 86400_000)} ngày ${suffix}`;
}

export const tooltipContentStyle: CSSProperties = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  fontSize: '12px',
};

export const axisProps = {
  stroke: 'hsl(var(--muted-foreground))',
  fontSize: 10,
  tick: { fontSize: 10 },
};

/** Giảm số điểm (giữ đều) để biểu đồ mượt. */
export function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

/** Nội suy màu cho hệ số tương quan −1..1 (đỏ ↔ trắng ↔ xanh). */
export function corrColor(r: number | null | undefined): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return 'hsl(var(--muted))';
  const v = Math.max(-1, Math.min(1, r));
  const a = Math.abs(v);
  // dương: xanh dương; âm: đỏ
  const hue = v >= 0 ? 212 : 0;
  const light = 97 - a * 50;
  const sat = 20 + a * 60;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

export function corrTextColor(r: number | null | undefined): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return 'hsl(var(--muted-foreground))';
  return Math.abs(r) > 0.55 ? '#fff' : 'hsl(var(--foreground))';
}
