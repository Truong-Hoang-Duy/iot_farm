// Nhật ký đồng bộ: logs/firebase_writes (Jetson ghi) & logs/sync (Backend ghi)
import { db } from '../config/firebaseConfig';
import { ref, onValue, query, orderByKey, limitToLast, type Unsubscribe } from 'firebase/database';

export type LogStatus = 'ok' | 'error' | 'noop';
export type SyncDirection = 'firebase_to_influx' | 'influx_to_firebase';

export interface FirebaseWriteLog {
  id: string;
  /** server timestamp (ms) */
  ts?: number;
  device_id?: string;
  n_records?: number;
  first_key?: string;
  last_key?: string;
  status?: LogStatus | string;
  http_status?: number | null;
  duration_ms?: number;
  queue_pending?: number;
  from_backlog?: boolean;
  error?: string | null;
}

export interface SyncLog {
  id: string;
  ts?: number;
  direction?: SyncDirection | string;
  n_records?: number;
  range_start?: string | number | null;
  range_end?: string | number | null;
  status?: LogStatus | string;
  duration_ms?: number;
  error?: string | null;
}

export const LOG_LIMIT = 500;

/** Chuẩn hóa timestamp (giây hoặc ms) → ms. */
export const normalizeTs = (ts: unknown): number | null => {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null;
  return ts < 1e12 ? ts * 1000 : ts;
};

const sortDesc = <T extends { id: string; ts?: number }>(items: T[]): T[] =>
  [...items].sort((a, b) => {
    const ta = normalizeTs(a.ts) ?? 0;
    const tb = normalizeTs(b.ts) ?? 0;
    if (tb !== ta) return tb - ta;
    return b.id.localeCompare(a.id); // pushId tăng dần theo thời gian
  });

function subscribeLogNode<T extends { id: string; ts?: number }>(
  path: string,
  limit: number,
  callback: (items: T[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onValue(
    query(ref(db, path), orderByKey(), limitToLast(limit)),
    (snapshot) => {
      const val = snapshot.val() as Record<string, Omit<T, 'id'>> | null;
      if (!val || typeof val !== 'object') {
        callback([]);
        return;
      }
      const items = Object.entries(val)
        .filter(([, v]) => v && typeof v === 'object')
        .map(([id, v]) => ({ ...(v as object), id }) as T);
      callback(sortDesc(items));
    },
    (error) => {
      console.warn(`[LogsAPI] Lỗi đọc ${path}:`, error);
      onError?.(error);
    },
  );
}

/** Log upload của Jetson theo ngày (mới nhất trước). */
export const subscribeFirebaseWriteLogs = (
  dateKey: string,
  callback: (items: FirebaseWriteLog[]) => void,
  onError?: (error: Error) => void,
  limit: number = LOG_LIMIT,
): Unsubscribe => subscribeLogNode<FirebaseWriteLog>(`logs/firebase_writes/${dateKey}`, limit, callback, onError);

/** Log đồng bộ Firebase ↔ InfluxDB theo ngày (mới nhất trước). */
export const subscribeSyncLogs = (
  dateKey: string,
  callback: (items: SyncLog[]) => void,
  onError?: (error: Error) => void,
  limit: number = LOG_LIMIT,
): Unsubscribe => subscribeLogNode<SyncLog>(`logs/sync/${dateKey}`, limit, callback, onError);

// ==================== Backend (FastAPI qua Vite proxy /api) ====================

export type SyncStatusPayload = Record<string, unknown>;

export class BackendUnavailableError extends Error {
  constructor(message = 'Không kết nối được backend') {
    super(message);
    this.name = 'BackendUnavailableError';
  }
}

async function readJsonOrThrow(res: Response): Promise<unknown> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    // Vite proxy trả 500/502/504 khi backend chưa chạy
    if ([502, 503, 504].includes(res.status) || (res.status === 500 && !text)) {
      throw new BackendUnavailableError();
    }
    const detail =
      body && typeof body === 'object' && 'detail' in body ? String((body as { detail: unknown }).detail) : text;
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  if (typeof body === 'string' && body.trim().startsWith('<')) {
    // index.html trả về → không có proxy/backend
    throw new BackendUnavailableError();
  }
  return body;
}

export async function fetchSyncStatus(signal?: AbortSignal): Promise<SyncStatusPayload> {
  const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(`${apiBase}/api/sync/status`, { signal });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new BackendUnavailableError();
  }
  const body = await readJsonOrThrow(res);
  return body && typeof body === 'object' ? (body as SyncStatusPayload) : { result: body };
}

export async function runSyncNow(direction: 'both' | SyncDirection = 'both'): Promise<SyncStatusPayload> {
  const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
  let res: Response;
  try {
    res = await fetch(`${apiBase}/api/sync/run?direction=${encodeURIComponent(direction)}`, { method: 'POST' });
  } catch {
    throw new BackendUnavailableError();
  }
  const body = await readJsonOrThrow(res);
  return body && typeof body === 'object' ? (body as SyncStatusPayload) : { result: body };
}
