// Tiện ích xử lý khóa thời gian của Firebase `data/{YYYY-MM-DD}/{HH:MM[:SS]}`.
// Mọi key đều là giờ địa phương Asia/Ho_Chi_Minh (UTC+7). Key cũ dạng "HH:MM",
// key mới dạng "HH:MM:SS" – mọi hàm ở đây chấp nhận cả hai.

export const FARM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_KEY_RE = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;

export interface ParsedTimeKey {
  hour: number;
  minute: number;
  second: number;
}

/** Parse "HH:MM" hoặc "HH:MM:SS" → {hour, minute, second}; trả null nếu sai định dạng. */
export function parseTimeKey(key: string): ParsedTimeKey | null {
  const m = TIME_KEY_RE.exec(key.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] !== undefined ? Number(m[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

/** Số giây kể từ 00:00 (key không hợp lệ → -1 để xếp lên đầu). */
export function timeKeyToSeconds(key: string): number {
  const p = parseTimeKey(key);
  return p ? p.hour * 3600 + p.minute * 60 + p.second : -1;
}

/** So sánh 2 key thời gian theo giá trị số (an toàn cho cả HH:MM và HH:MM:SS). */
export function compareTimeKeys(a: string, b: string): number {
  return timeKeyToSeconds(a) - timeKeyToSeconds(b);
}

/** Sắp xếp danh sách key thời gian tăng dần (không đổi mảng gốc). */
export function sortTimeKeys(keys: string[]): string[] {
  return [...keys].sort(compareTimeKeys);
}

/** Hiển thị "HH:MM" (bỏ giây) – dùng cho trục biểu đồ. */
export function shortTimeLabel(key: string): string {
  const p = parseTimeKey(key);
  if (!p) return key;
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Chuẩn hóa thành "HH:MM:SS". */
export function normalizeTimeKey(key: string): string {
  const p = parseTimeKey(key);
  if (!p) return key;
  return `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}

export function isDateKey(key: string): boolean {
  return DATE_KEY_RE.test(key);
}

/**
 * Đổi (dateKey, timeKey) giờ VN → epoch ms (UTC) chính xác, không phụ thuộc
 * múi giờ của trình duyệt.
 */
export function keysToEpochMs(dateKey: string, timeKey: string): number | null {
  const d = DATE_KEY_RE.exec(dateKey);
  const t = parseTimeKey(timeKey);
  if (!d || !t) return null;
  return (
    Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), t.hour, t.minute, t.second) - VN_OFFSET_MS
  );
}

/** Khóa ngày YYYY-MM-DD (giờ VN) của một thời điểm. */
export function dateKeyFromDate(date: Date): string {
  const shifted = new Date(date.getTime() + VN_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** Khóa ngày hôm nay (giờ VN). */
export function todayDateKey(): string {
  return dateKeyFromDate(new Date());
}

/** Cộng/trừ số ngày trên khóa YYYY-MM-DD. */
export function addDaysToKey(dateKey: string, days: number): string {
  const d = DATE_KEY_RE.exec(dateKey);
  if (!d) return dateKey;
  const utc = new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]) + days));
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
}

/** Số ngày giữa 2 khóa (b - a). */
export function diffDateKeys(a: string, b: string): number {
  const da = DATE_KEY_RE.exec(a);
  const db = DATE_KEY_RE.exec(b);
  if (!da || !db) return 0;
  const ta = Date.UTC(Number(da[1]), Number(da[2]) - 1, Number(da[3]));
  const tb = Date.UTC(Number(db[1]), Number(db[2]) - 1, Number(db[3]));
  return Math.round((tb - ta) / 86_400_000);
}

/** Khóa ngày → Date (nửa đêm giờ trình duyệt) – chỉ dùng cho date picker UI. */
export function dateKeyToLocalDate(dateKey: string): Date {
  const d = DATE_KEY_RE.exec(dateKey);
  if (!d) return new Date(NaN);
  return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
}

/** Date (giờ trình duyệt, từ date picker) → khóa YYYY-MM-DD theo ngày đã chọn. */
export function localDateToDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** "dd/MM/yyyy" từ khóa ngày. */
export function formatDateKeyVi(dateKey: string): string {
  const d = DATE_KEY_RE.exec(dateKey);
  if (!d) return dateKey;
  return `${d[3]}/${d[2]}/${d[1]}`;
}

/** Định dạng epoch ms theo giờ VN. */
export function formatEpochMsVi(
  ms: number,
  opts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  },
): string {
  if (!Number.isFinite(ms)) return '--';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: FARM_TIME_ZONE, ...opts }).format(new Date(ms));
}

export function formatTimeOnlyVi(ms: number): string {
  return formatEpochMsVi(ms, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** "5 giây trước", "3 phút trước", ... */
export function formatRelativeVi(deltaMs: number): string {
  if (!Number.isFinite(deltaMs)) return '--';
  const future = deltaMs < 0;
  const abs = Math.abs(deltaMs);
  const s = Math.round(abs / 1000);
  let text: string;
  if (s < 5) return 'vừa xong';
  if (s < 60) text = `${s} giây`;
  else if (s < 3600) text = `${Math.floor(s / 60)} phút`;
  else if (s < 86400) text = `${Math.floor(s / 3600)} giờ ${Math.floor((s % 3600) / 60)} phút`;
  else text = `${Math.floor(s / 86400)} ngày`;
  return future ? `sau ${text}` : `${text} trước`;
}

/** Thời lượng (giây) → "2 ngày 3 giờ", "15 phút", ... */
export function formatDurationVi(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '--';
  const s = Math.floor(totalSeconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} ngày ${h} giờ`;
  if (h > 0) return `${h} giờ ${m} phút`;
  if (m > 0) return `${m} phút`;
  return `${s} giây`;
}

/** Chu kỳ lấy mẫu (giây) → "5 giây", "1 phút", "1 giờ 30 phút"... */
export function formatIntervalVi(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '--';
  if (sec < 60) return `${sec} giây`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return r ? `${m} phút ${r} giây` : `${m} phút`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}
