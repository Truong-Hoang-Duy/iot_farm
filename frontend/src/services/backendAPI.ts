/**
 * backendAPI.ts – Typed client cho FastAPI backend (prefix /api, Vite proxy → :8000).
 *
 * Mọi hàm parse đều "phòng thủ": thiếu trường → undefined, trường lạ → bỏ qua,
 * hỗ trợ cả định dạng dòng (array of objects) lẫn định dạng cột kiểu Open-Meteo.
 * Thời gian (`t`) là chuỗi ISO có offset +07:00; mỗi điểm được bổ sung `ts` (epoch ms).
 */

import { loadLocalSoilData } from './firebaseAPI';

// ============================================================================
// Hằng số dùng chung
// ============================================================================

export interface TargetDef {
  key: string;
  label: string;
  unit: string;
  color: string;
  digits: number;
}

export const TARGETS: TargetDef[] = [
  { key: 'temperature', label: 'Nhiệt độ KK', unit: '°C', color: 'hsl(0, 70%, 55%)', digits: 1 },
  { key: 'humidity', label: 'Độ ẩm KK', unit: '%', color: 'hsl(220, 70%, 55%)', digits: 1 },
  { key: 'soiltemp', label: 'Nhiệt độ đất', unit: '°C', color: 'hsl(38, 92%, 50%)', digits: 1 },
  { key: 'moisture', label: 'Độ ẩm đất', unit: '%', color: 'hsl(200, 85%, 55%)', digits: 1 },
  { key: 'pH', label: 'pH', unit: '', color: 'hsl(195, 85%, 40%)', digits: 2 },
  { key: 'EC', label: 'EC', unit: 'mS/cm', color: 'hsl(30, 60%, 45%)', digits: 2 },
  { key: 'N', label: 'Đạm (N)', unit: 'mg/kg', color: 'hsl(280, 70%, 55%)', digits: 0 },
  { key: 'P', label: 'Lân (P)', unit: 'mg/kg', color: 'hsl(152, 76%, 40%)', digits: 0 },
  { key: 'K', label: 'Kali (K)', unit: 'mg/kg', color: 'hsl(330, 70%, 55%)', digits: 0 },
];

export const TARGET_MAP: Record<string, TargetDef> = Object.fromEntries(TARGETS.map((t) => [t.key, t]));

export function targetLabel(key: string, withUnit = false): string {
  const t = TARGET_MAP[key];
  if (!t) return key;
  return withUnit && t.unit ? `${t.label} (${t.unit})` : t.label;
}

export type HorizonGroup = 'short' | 'long';

export interface HorizonDef {
  key: string;
  label: string;
  short: string;
  group: HorizonGroup;
  minutes: number;
}

export const HORIZONS: HorizonDef[] = [
  { key: '5m', label: '5 phút', short: '5′', group: 'short', minutes: 5 },
  { key: '10m', label: '10 phút', short: '10′', group: 'short', minutes: 10 },
  { key: '30m', label: '30 phút', short: '30′', group: 'short', minutes: 30 },
  { key: '1h', label: '1 giờ', short: '1h', group: 'short', minutes: 60 },
  { key: '2h', label: '2 giờ', short: '2h', group: 'short', minutes: 120 },
  { key: '6h', label: '6 giờ', short: '6h', group: 'short', minutes: 360 },
  { key: '12h', label: '12 giờ', short: '12h', group: 'short', minutes: 720 },
  { key: '1d', label: '1 ngày', short: '1d', group: 'long', minutes: 1440 },
  { key: '2d', label: '2 ngày', short: '2d', group: 'long', minutes: 2880 },
  { key: '3d', label: '3 ngày', short: '3d', group: 'long', minutes: 4320 },
  { key: '4d', label: '4 ngày', short: '4d', group: 'long', minutes: 5760 },
  { key: '5d', label: '5 ngày', short: '5d', group: 'long', minutes: 7200 },
];

export const HORIZON_MAP: Record<string, HorizonDef> = Object.fromEntries(HORIZONS.map((h) => [h.key, h]));

export const GROUP_LABELS: Record<HorizonGroup, string> = {
  short: 'Ngắn hạn (lưới 5 phút)',
  long: 'Dài hạn (lưới 1 giờ)',
};

export interface ModelDef {
  key: string;
  label: string;
  color: string;
  family: string;
  baseline?: boolean;
  paper?: string;
  doi?: string;
  year?: number;
}

export const MODELS: ModelDef[] = [
  { key: 'best', label: 'Tốt nhất (tự chọn)', color: 'hsl(var(--primary))', family: 'Tự động chọn theo MASE thấp nhất' },
  {
    key: 'xgboost', label: 'XGBoost', color: 'hsl(25, 90%, 52%)', family: 'Gradient Boosting',
    paper: 'Chen, T. & Guestrin, C. (2016). XGBoost: A Scalable Tree Boosting System. KDD \'16.',
    doi: '10.1145/2939672.2939785', year: 2016,
  },
  {
    key: 'lstm', label: 'LSTM', color: 'hsl(210, 80%, 50%)', family: 'Mạng hồi quy (RNN)',
    paper: 'Hochreiter, S. & Schmidhuber, J. (1997). Long Short-Term Memory. Neural Computation 9(8).',
    doi: '10.1162/neco.1997.9.8.1735', year: 1997,
  },
  {
    key: 'nhits', label: 'N-HiTS', color: 'hsl(150, 65%, 38%)', family: 'Deep MLP đa tầng tần số',
    paper: 'Challu, C. et al. (2023). N-HiTS: Neural Hierarchical Interpolation for Time Series Forecasting. AAAI 37(6).',
    doi: '10.1609/aaai.v37i6.25854', year: 2023,
  },
  {
    key: 'patchtst', label: 'PatchTST', color: 'hsl(275, 65%, 55%)', family: 'Transformer',
    paper: 'Nie, Y. et al. (2023). A Time Series is Worth 64 Words: Long-term Forecasting with Transformers. ICLR.',
    doi: '10.48550/arXiv.2211.14730', year: 2023,
  },
  {
    key: 'chronos', label: 'Chronos-Bolt', color: 'hsl(340, 75%, 52%)', family: 'Foundation model (pretrained)',
    paper: 'Ansari, A. F. et al. (2024). Chronos: Learning the Language of Time Series. TMLR.',
    doi: '10.48550/arXiv.2403.07815', year: 2024,
  },
  {
    key: 'seasonal_naive', label: 'Seasonal Naive', color: 'hsl(45, 10%, 50%)', family: 'Baseline', baseline: true,
    paper: 'Hyndman, R. J. & Athanasopoulos, G. Forecasting: Principles and Practice (3rd ed.), OTexts.',
  },
  {
    key: 'naive', label: 'Naive', color: 'hsl(220, 8%, 62%)', family: 'Baseline', baseline: true,
    paper: 'Hyndman, R. J. & Athanasopoulos, G. Forecasting: Principles and Practice (3rd ed.), OTexts.',
  },
];

export const MODEL_MAP: Record<string, ModelDef> = Object.fromEntries(MODELS.map((m) => [m.key, m]));

export function modelLabel(key: string | undefined): string {
  if (!key) return '—';
  return MODEL_MAP[key]?.label ?? key;
}

export function modelColor(key: string | undefined, idx = 0): string {
  if (key && MODEL_MAP[key]) return MODEL_MAP[key].color;
  const fallback = ['hsl(190, 70%, 45%)', 'hsl(90, 55%, 42%)', 'hsl(10, 70%, 55%)', 'hsl(260, 40%, 55%)'];
  return fallback[idx % fallback.length];
}

export type MetricKey = 'mae' | 'rmse' | 'mape' | 'smape' | 'mase' | 'r2' | 'coverage80';

export interface MetricDef {
  key: MetricKey;
  label: string;
  /** 'lower' – càng nhỏ càng tốt; 'higher' – càng lớn càng tốt; 'target80' – càng gần 0.8 càng tốt */
  better: 'lower' | 'higher' | 'target80';
  percent?: boolean;
  description: string;
}

export const METRICS: MetricDef[] = [
  { key: 'mae', label: 'MAE', better: 'lower', description: 'Sai số tuyệt đối trung bình (đúng đơn vị đo)' },
  { key: 'rmse', label: 'RMSE', better: 'lower', description: 'Căn bậc hai sai số bình phương trung bình – phạt nặng sai số lớn' },
  { key: 'mape', label: 'MAPE', better: 'lower', percent: true, description: 'Sai số phần trăm tuyệt đối trung bình' },
  { key: 'smape', label: 'sMAPE', better: 'lower', percent: true, description: 'Sai số phần trăm đối xứng – ổn định hơn khi giá trị gần 0' },
  { key: 'mase', label: 'MASE', better: 'lower', description: 'MAE chia cho MAE của Seasonal Naive; < 1 là tốt hơn baseline' },
  { key: 'r2', label: 'R²', better: 'higher', description: 'Tỷ lệ phương sai giải thích được' },
  { key: 'coverage80', label: 'Coverage 80%', better: 'target80', description: 'Tỷ lệ giá trị thật rơi vào khoảng dự báo 80%' },
];

export const METRIC_MAP: Record<string, MetricDef> = Object.fromEntries(METRICS.map((m) => [m.key, m]));

export const FARM_LOCATION = { lat: 10.8433, lon: 106.8389 };

// ============================================================================
// Lỗi & fetch
// ============================================================================

export type BackendErrorKind = 'network' | 'not_trained' | 'not_found' | 'conflict' | 'http' | 'parse';

export class BackendError extends Error {
  status: number;
  kind: BackendErrorKind;
  detail?: string;

  constructor(message: string, status: number, kind: BackendErrorKind, detail?: string) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
    this.kind = kind;
    this.detail = detail;
  }
}

export function isBackendError(e: unknown): e is BackendError {
  return e instanceof BackendError;
}

/** Mô tả lỗi thân thiện (tiếng Việt) để hiển thị trong UI. */
export function describeError(e: unknown): { title: string; description: string; kind: BackendErrorKind } {
  if (isBackendError(e)) {
    switch (e.kind) {
      case 'network':
        return {
          title: 'Không kết nối được backend',
          description: 'Máy chủ FastAPI (cổng 8000) chưa chạy hoặc không phản hồi. Hãy khởi động backend rồi thử lại.',
          kind: e.kind,
        };
      case 'not_trained':
        return {
          title: 'Mô hình chưa được huấn luyện',
          description: e.detail || 'Hãy vào "Phòng thí nghiệm mô hình" và bấm Huấn luyện để tạo mô hình.',
          kind: e.kind,
        };
      case 'not_found':
        return { title: 'Không tìm thấy dữ liệu', description: e.detail || 'Endpoint hoặc dữ liệu chưa có.', kind: e.kind };
      case 'conflict':
        return { title: 'Đang huấn luyện', description: e.detail || 'Một tiến trình huấn luyện khác đang chạy – vui lòng đợi hoàn tất.', kind: e.kind };
      case 'parse':
        return { title: 'Dữ liệu không hợp lệ', description: e.detail || 'Phản hồi từ backend không đúng định dạng.', kind: e.kind };
      default:
        return { title: `Lỗi máy chủ (${e.status})`, description: e.detail || e.message, kind: e.kind };
    }
  }
  return {
    title: 'Đã xảy ra lỗi',
    description: e instanceof Error ? e.message : String(e),
    kind: 'http',
  };
}

/** Retry policy cho TanStack Query: không retry khi chưa train / 404 / mất kết nối. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isBackendError(error) && ['not_trained', 'not_found', 'network', 'parse', 'conflict'].includes(error.kind)) return false;
  return failureCount < 1;
}

const BACKEND_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const API_BASE = `${BACKEND_ORIGIN}/api`;

type ParamValue = string | number | boolean | undefined | null;

function buildUrl(path: string, params?: Record<string, ParamValue>): string {
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      qs.append(k, String(v));
    }
  }
  const s = qs.toString();
  return `${API_BASE}${path}${s ? `?${s}` : ''}`;
}

function extractDetail(body: unknown): string | undefined {
  if (!body) return undefined;
  if (typeof body === 'string') return body.slice(0, 300);
  if (typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const d = b.detail ?? b.message ?? b.error;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) {
      return d
        .map((x) => (x && typeof x === 'object' && 'msg' in x ? String((x as { msg: unknown }).msg) : String(x)))
        .join('; ');
    }
    if (d && typeof d === 'object') return JSON.stringify(d).slice(0, 300);
  }
  return undefined;
}

async function request<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  params?: Record<string, ParamValue>,
  opts: { signal?: AbortSignal; body?: unknown } = {},
): Promise<T> {
  const url = buildUrl(path, params);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal: opts.signal,
      headers: { Accept: 'application/json', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new BackendError('Network error', 0, 'network', e instanceof Error ? e.message : undefined);
  }

  const text = await res.text().catch(() => '');
  let body: unknown = undefined;
  let isJson = false;
  if (text) {
    try {
      body = JSON.parse(text);
      isJson = true;
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const detail = extractDetail(body);
    // Vite proxy trả 500/502/504 khi backend tắt (ECONNREFUSED) – thường không có JSON.
    if (res.status === 502 || res.status === 504 || (res.status === 500 && !isJson)) {
      throw new BackendError(`HTTP ${res.status}`, res.status, 'network', detail);
    }
    if (res.status === 503) {
      throw new BackendError(`HTTP 503`, 503, 'not_trained', detail);
    }
    if (res.status === 404) {
      throw new BackendError(`HTTP 404`, 404, 'not_found', detail);
    }
    if (res.status === 409) {
      throw new BackendError(`HTTP 409`, 409, 'conflict', detail);
    }
    throw new BackendError(`HTTP ${res.status}`, res.status, 'http', detail);
  }

  if (text && !isJson) {
    // Ví dụ index.html của Vite khi endpoint không tồn tại
    throw new BackendError('Invalid JSON', res.status, 'parse', 'Phản hồi không phải JSON');
  }
  return body as T;
}

const get = <T = unknown>(path: string, params?: Record<string, ParamValue>, signal?: AbortSignal) =>
  request<T>('GET', path, params, { signal });
const post = <T = unknown>(path: string, params?: Record<string, ParamValue>, body?: unknown) =>
  request<T>('POST', path, params, { body });

// ============================================================================
// Helpers parse phòng thủ
// ============================================================================

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

export function num(x: unknown): number | undefined {
  if (typeof x === 'number') return Number.isFinite(x) ? x : undefined;
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function numOrNull(x: unknown): number | null {
  const n = num(x);
  return n === undefined ? null : n;
}

function str(x: unknown): string | undefined {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  return undefined;
}

function bool(x: unknown): boolean | undefined {
  if (typeof x === 'boolean') return x;
  if (x === 'true' || x === 1) return true;
  if (x === 'false' || x === 0) return false;
  return undefined;
}

function arr(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

const TZ_SUFFIX = /([zZ]|[+-]\d{2}:?\d{2})$/;

/** Chuyển thời gian (ISO / epoch s / epoch ms) → epoch ms. Chuỗi thiếu múi giờ được hiểu là +07:00. */
export function toMs(t: unknown): number | undefined {
  if (typeof t === 'number' && Number.isFinite(t)) return t < 1e12 ? t * 1000 : t;
  if (typeof t !== 'string' || !t) return undefined;
  let s = t.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s = `${s}T00:00:00+07:00`;
  else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) && !TZ_SUFFIX.test(s)) s = `${s.replace(' ', 'T')}+07:00`;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : undefined;
}

function pickTime(o: Obj): unknown {
  return o.t ?? o.time ?? o.timestamp ?? o.ts ?? o.date ?? o.ds;
}

/** Chuyển dạng cột {time:[..], a:[..]} → dạng dòng [{t, a}]. */
function columnarToRows(o: Obj): Obj[] {
  const timeKey = ['t', 'time', 'timestamp', 'date', 'ds'].find((k) => Array.isArray(o[k]));
  if (!timeKey) return [];
  const times = o[timeKey] as unknown[];
  const keys = Object.keys(o).filter((k) => k !== timeKey && Array.isArray(o[k]));
  return times.map((t, i) => {
    const row: Obj = { t };
    for (const k of keys) row[k] = (o[k] as unknown[])[i];
    return row;
  });
}

function rowsFrom(x: unknown, ...containerKeys: string[]): Obj[] {
  if (Array.isArray(x)) return x.filter(isObj);
  if (!isObj(x)) return [];
  for (const k of containerKeys) {
    const v = x[k];
    if (Array.isArray(v)) return v.filter(isObj);
    if (isObj(v)) {
      const cols = columnarToRows(v);
      if (cols.length) return cols;
    }
  }
  const cols = columnarToRows(x);
  return cols;
}

// ============================================================================
// Kiểu dữ liệu & parse: Forecast
// ============================================================================

export interface SeriesPoint {
  t: string;
  ts: number;
  v?: number;
}

export interface ForecastPoint {
  t: string;
  ts: number;
  yhat?: number;
  lo?: number;
  hi?: number;
}

export interface HorizonMetrics {
  mae?: number;
  rmse?: number;
  mape?: number;
  smape?: number;
  mase?: number;
  r2?: number;
  coverage80?: number;
}

export interface ForecastResponse {
  target: string;
  horizon: string;
  group?: HorizonGroup;
  resolution_minutes?: number;
  model: string;
  model_label?: string;
  issued_at?: string;
  issued_ts?: number;
  last_observation_at?: string;
  last_observation_ts?: number;
  history: SeriesPoint[];
  forecast: ForecastPoint[];
  metrics_at_horizon?: HorizonMetrics;
  /** Chỉ số tại đúng bước k (khi backend trả {cum, point}) */
  metrics_point?: HorizonMetrics;
  device?: string;
  unit?: string;
  requested_model?: string;
  origin?: string;
  origin_ts?: number;
  data_source?: string;
  weather_source?: string;
  context_valid?: boolean;
  note?: string;
}

function parseMetricsObj(o: unknown): HorizonMetrics | undefined {
  if (!isObj(o)) return undefined;
  // Dạng lồng {cum:{...}, point:{...}} → mặc định lấy cum (sai số trung bình bước 1..k)
  if (isObj(o.cum) || isObj(o.point)) return parseMetricsObj(o.cum ?? o.point);
  const m: HorizonMetrics = {
    mae: num(o.mae ?? o.MAE),
    rmse: num(o.rmse ?? o.RMSE),
    mape: num(o.mape ?? o.MAPE),
    smape: num(o.smape ?? o.sMAPE ?? o.SMAPE),
    mase: num(o.mase ?? o.MASE),
    r2: num(o.r2 ?? o.R2),
    coverage80: num(o.coverage80 ?? o.coverage ?? o.coverage_80),
  };
  return Object.values(m).some((v) => v !== undefined) ? m : undefined;
}

function parseSeries(x: unknown): SeriesPoint[] {
  return rowsFrom(x, 'points', 'data')
    .map((r): SeriesPoint | null => {
      const t = pickTime(r);
      const ts = toMs(t);
      if (ts === undefined) return null;
      return { t: str(t) ?? new Date(ts).toISOString(), ts, v: num(r.v ?? r.value ?? r.y ?? r.actual) };
    })
    .filter((p): p is SeriesPoint => p !== null)
    .sort((a, b) => a.ts - b.ts);
}

function parseForecastPoints(x: unknown): ForecastPoint[] {
  return rowsFrom(x, 'points', 'data')
    .map((r): ForecastPoint | null => {
      const t = pickTime(r);
      const ts = toMs(t);
      if (ts === undefined) return null;
      return {
        t: str(t) ?? new Date(ts).toISOString(),
        ts,
        yhat: num(r.yhat ?? r.value ?? r.y ?? r.v ?? r.mean ?? r.median),
        lo: num(r.lo ?? r.lower ?? r.q10 ?? r.p10),
        hi: num(r.hi ?? r.upper ?? r.q90 ?? r.p90),
      };
    })
    .filter((p): p is ForecastPoint => p !== null)
    .sort((a, b) => a.ts - b.ts);
}

export function parseForecast(raw: unknown, fallback: { target: string; horizon: string; model: string }): ForecastResponse {
  if (!isObj(raw)) throw new BackendError('Invalid forecast', 200, 'parse', 'Phản hồi dự báo không hợp lệ');
  const group = str(raw.group);
  return {
    target: str(raw.target) ?? fallback.target,
    horizon: str(raw.horizon) ?? fallback.horizon,
    group: group === 'short' || group === 'long' ? group : HORIZON_MAP[fallback.horizon]?.group,
    resolution_minutes: num(raw.resolution_minutes),
    model: str(raw.model) ?? fallback.model,
    model_label: str(raw.model_label),
    issued_at: str(raw.issued_at),
    issued_ts: toMs(raw.issued_at),
    last_observation_at: str(raw.last_observation_at),
    last_observation_ts: toMs(raw.last_observation_at),
    history: parseSeries(raw.history),
    forecast: parseForecastPoints(raw.forecast),
    metrics_at_horizon: parseMetricsObj(raw.metrics_at_horizon ?? raw.metrics),
    metrics_point: isObj(raw.metrics_at_horizon) && isObj(raw.metrics_at_horizon.point) ? parseMetricsObj(raw.metrics_at_horizon.point) : undefined,
    device: str(raw.device),
    unit: str(raw.unit),
    requested_model: str(raw.requested_model),
    origin: str(raw.origin),
    origin_ts: toMs(raw.origin),
    data_source: str(raw.data_source),
    weather_source: str(raw.weather_source),
    context_valid: bool(raw.context_valid),
    note: str(raw.note),
  };
}

// ---- Metrics ----

export type MetricKind = 'cum' | 'point';

export interface MetricRow extends HorizonMetrics {
  model: string;
  target: string;
  horizon: string;
  n_eval?: number;
  group?: string;
  steps?: number;
  kind?: string;
}

export interface DatasetSplit {
  train_end?: string;
  val_end?: string;
  test_start?: string;
  test_end?: string;
}

export interface DatasetInfo {
  start?: string;
  end?: string;
  n_points?: number;
  resolution_minutes?: number;
  split?: DatasetSplit;
}

export interface MetricsResponse {
  rows: MetricRow[];
  /** Thông tin tập dữ liệu; key 'default' hoặc theo nhóm 'short' / 'long' */
  datasets: Record<string, DatasetInfo>;
  device?: string;
  generated_at?: string;
  /** best[target][horizon] = {model, mase} */
  best: Record<string, Record<string, { model: string; mase?: number }>>;
  kind?: string;
  gpu_usage?: unknown;
  assumptions?: unknown;
  evaluation?: unknown;
}

function parseDataset(o: unknown): DatasetInfo | undefined {
  if (!isObj(o)) return undefined;
  const sp = isObj(o.split) ? o.split : undefined;
  const info: DatasetInfo = {
    start: str(o.start),
    end: str(o.end),
    n_points: num(o.n_points ?? o.n ?? o.length),
    resolution_minutes: num(o.resolution_minutes),
    split: sp
      ? {
          train_end: str(sp.train_end),
          val_end: str(sp.val_end),
          test_start: str(sp.test_start),
          test_end: str(sp.test_end),
        }
      : undefined,
  };
  return info.start || info.end || info.n_points !== undefined || info.split ? info : undefined;
}

export function parseMetrics(raw: unknown): MetricsResponse {
  const rows = rowsFrom(raw, 'rows', 'metrics', 'data')
    .map((r): MetricRow | null => {
      const model = str(r.model);
      const target = str(r.target);
      const horizon = str(r.horizon);
      if (!model || !target || !horizon) return null;
      return {
        model,
        target,
        horizon,
        ...(parseMetricsObj(r) ?? {}),
        n_eval: num(r.n_eval ?? r.n),
        group: str(r.group),
        steps: num(r.steps),
        kind: str(r.kind),
      };
    })
    .filter((r): r is MetricRow => r !== null);

  const best: MetricsResponse['best'] = {};
  if (isObj(raw) && isObj(raw.best)) {
    for (const [t, hs] of Object.entries(raw.best)) {
      if (!isObj(hs)) continue;
      for (const [h, b] of Object.entries(hs)) {
        const model = isObj(b) ? str(b.model) : str(b);
        if (!model) continue;
        (best[t] ??= {})[h] = { model, mase: isObj(b) ? num(b.mase) : undefined };
      }
    }
  }

  const datasets: Record<string, DatasetInfo> = {};
  if (isObj(raw)) {
    const ds = raw.dataset ?? raw.datasets;
    const direct = parseDataset(ds);
    if (direct) datasets.default = direct;
    if (isObj(ds)) {
      for (const [k, v] of Object.entries(ds)) {
        if (k === 'split') continue;
        const d = parseDataset(v);
        if (d) datasets[k] = d;
      }
    }
  }
  return {
    rows,
    datasets,
    device: isObj(raw) ? str(raw.device) : undefined,
    generated_at: isObj(raw) ? str(raw.generated_at ?? raw.trained_at) : undefined,
    best,
    kind: isObj(raw) ? str(raw.kind) : undefined,
    gpu_usage: isObj(raw) ? raw.gpu_usage : undefined,
    assumptions: isObj(raw) ? raw.assumptions : undefined,
    evaluation: isObj(raw) ? raw.evaluation : undefined,
  };
}

// ---- Models ----

export interface ModelGroupStatus {
  available?: boolean;
  device?: string;
  train_seconds?: number;
  trained_at?: string;
  [k: string]: unknown;
}

export interface ModelInfo {
  key: string;
  name: string;
  family?: string;
  paper?: string;
  doi_url?: string;
  year?: number;
  available?: boolean;
  trained_at?: string;
  device?: string;
  gpu_name?: string;
  status?: Record<string, ModelGroupStatus>;
  hyperparameters?: Record<string, unknown>;
  description?: string;
}

export function parseModels(raw: unknown): ModelInfo[] {
  return rowsFrom(raw, 'models', 'data', 'items')
    .map((r): ModelInfo | null => {
      const key = str(r.key ?? r.id ?? r.name);
      if (!key) return null;
      const doi = str(r.doi_url ?? r.doi);
      const status: Record<string, ModelGroupStatus> = {};
      if (isObj(r.status)) {
        for (const [g, s] of Object.entries(r.status)) {
          if (!isObj(s)) continue;
          status[g] = { ...s, available: bool(s.available), device: str(s.device), train_seconds: num(s.train_seconds), trained_at: str(s.trained_at) };
        }
      }
      const st = Object.values(status);
      const anyAvail = st.some((s) => s.available === true) ? true : st.length && st.every((s) => s.available === false) ? false : undefined;
      return {
        key,
        name: str(r.name ?? r.label) ?? modelLabel(key),
        family: str(r.family),
        paper: str(r.paper ?? r.citation),
        doi_url: doi ? (doi.startsWith('http') ? doi : `https://doi.org/${doi}`) : undefined,
        year: num(r.year),
        available: bool(r.available ?? r.trained) ?? anyAvail,
        trained_at: str(r.trained_at) ?? st.map((s) => s.trained_at).find(Boolean),
        device: str(r.device) ?? st.map((s) => s.device).find(Boolean),
        gpu_name: str(r.gpu_name),
        status: st.length ? status : undefined,
        hyperparameters: isObj(r.hyperparameters) ? r.hyperparameters : isObj(r.params) ? r.params : undefined,
        description: str(r.description ?? r.reason),
      };
    })
    .filter((m): m is ModelInfo => m !== null);
}

// ---- Runtime ----

export interface RuntimeInfo {
  trained?: boolean;
  trained_at?: string;
  training_device?: string;
  gpu_name?: string;
  cuda_available?: boolean;
}

export function parseRuntime(raw: unknown): RuntimeInfo {
  if (!isObj(raw)) return {};
  const rd = isObj(raw.runtime_device) ? raw.runtime_device : {};
  return {
    trained: bool(raw.trained),
    trained_at: str(raw.trained_at),
    training_device: str(raw.training_device),
    gpu_name: str(rd.gpu_name ?? raw.gpu_name),
    cuda_available: bool(rd.cuda_available),
  };
}

// ---- Test predictions ----

export interface TestPredictionsResponse {
  target: string;
  group?: HorizonGroup;
  horizon?: string;
  resolution_minutes?: number;
  unit?: string;
  description?: string;
  /** Số thời điểm phát dự báo (rolling-origin) */
  origins?: number;
  actual: SeriesPoint[];
  /** model → điểm dự báo trên tập test */
  predictions: Record<string, ForecastPoint[]>;
}

export function parseTestPredictions(raw: unknown, fallback: { target: string; group?: string }): TestPredictionsResponse {
  const out: TestPredictionsResponse = {
    target: fallback.target,
    group: fallback.group === 'short' || fallback.group === 'long' ? fallback.group : undefined,
    actual: [],
    predictions: {},
  };
  if (!isObj(raw) && !Array.isArray(raw)) return out;

  if (isObj(raw)) {
    out.target = str(raw.target) ?? out.target;
    out.unit = str(raw.unit);
    out.description = str(raw.description);
    out.origins = Array.isArray(raw.origins) ? raw.origins.length : num(raw.origins);
    const g = str(raw.group);
    if (g === 'short' || g === 'long') out.group = g;
    out.horizon = str(raw.horizon);
    out.resolution_minutes = num(raw.resolution_minutes);

    // Dạng A: { actual:[{t,v}], predictions:{model:[{t,yhat}]} }
    if (raw.actual !== undefined) out.actual = parseSeries(raw.actual);
    const preds = raw.predictions ?? raw.models ?? raw.forecasts;
    if (isObj(preds)) {
      for (const [k, v] of Object.entries(preds)) out.predictions[k] = parseForecastPoints(v);
    } else if (Array.isArray(preds)) {
      // Dạng B: models:[{model, points:[...]}]
      for (const p of preds) {
        if (!isObj(p)) continue;
        const k = str(p.model ?? p.key);
        if (k) out.predictions[k] = parseForecastPoints(p.points ?? p.forecast ?? p.data);
      }
    }
    if (out.actual.length || Object.keys(out.predictions).length) return out;
  }

  // Dạng C: rows [{t, actual, xgboost, lstm, ...}]
  const rows = rowsFrom(raw, 'rows', 'data', 'points');
  const actual: SeriesPoint[] = [];
  const preds: Record<string, ForecastPoint[]> = {};
  for (const r of rows) {
    const t = pickTime(r);
    const ts = toMs(t);
    if (ts === undefined) continue;
    const tStr = str(t) ?? new Date(ts).toISOString();
    actual.push({ t: tStr, ts, v: num(r.actual ?? r.y ?? r.v) });
    for (const [k, v] of Object.entries(r)) {
      if (['t', 'time', 'timestamp', 'ts', 'date', 'ds', 'actual', 'y', 'v'].includes(k)) continue;
      const n = num(v);
      if (n === undefined) continue;
      (preds[k] ??= []).push({ t: tStr, ts, yhat: n });
    }
  }
  out.actual = actual.sort((a, b) => a.ts - b.ts);
  out.predictions = preds;
  return out;
}

// ---- Train ----

export type TrainState = 'idle' | 'running' | 'done' | 'error' | 'unknown';

export interface TrainStatus {
  state: TrainState;
  running: boolean;
  /** 0..100 */
  progress?: number;
  message?: string;
  stage?: string;
  quick?: boolean;
  started_at?: string;
  finished_at?: string;
  error?: string;
  log: string[];
}

export function parseTrainStatus(raw: unknown): TrainStatus {
  if (!isObj(raw)) return { state: 'unknown', running: false, log: [] };
  const s = (str(raw.state ?? raw.status) ?? '').toLowerCase();
  const runningFlag = bool(raw.running);
  let state: TrainState = 'unknown';
  if (['running', 'training', 'queued', 'started', 'pending', 'in_progress'].includes(s)) state = 'running';
  else if (['done', 'finished', 'completed', 'success', 'ok'].includes(s)) state = 'done';
  else if (['error', 'failed', 'failure'].includes(s)) state = 'error';
  else if (['idle', 'none', ''].includes(s)) state = runningFlag ? 'running' : 'idle';
  const running = runningFlag ?? state === 'running';
  if (running && state !== 'running') state = 'running';

  let progress = num(raw.progress ?? raw.percent ?? raw.pct);
  if (progress !== undefined && progress >= 0 && progress <= 1) progress *= 100;

  const logRaw = raw.log ?? raw.logs ?? raw.messages;
  const log = Array.isArray(logRaw)
    ? logRaw.map((l) => (typeof l === 'string' ? l : isObj(l) ? str(l.message ?? l.msg) ?? JSON.stringify(l) : String(l)))
    : typeof logRaw === 'string'
      ? logRaw.split('\n').filter(Boolean)
      : [];

  return {
    state,
    running,
    progress: progress !== undefined ? Math.max(0, Math.min(100, progress)) : undefined,
    message: str(raw.message ?? raw.detail ?? raw.step_desc),
    stage: str(raw.stage ?? raw.step ?? raw.current),
    quick: bool(raw.quick),
    started_at: str(raw.started_at),
    finished_at: str(raw.finished_at ?? raw.ended_at),
    error: str(raw.error),
    log,
  };
}

// ============================================================================
// Weather
// ============================================================================

export const WEATHER_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'precipitation',
  'rain',
  'cloud_cover',
  'shortwave_radiation',
  'et0_fao_evapotranspiration',
  'vapour_pressure_deficit',
  'wind_speed_10m',
  'dew_point_2m',
  'surface_pressure',
  'soil_temperature',
  'soil_moisture',
] as const;

export type WeatherVar = (typeof WEATHER_VARS)[number];

export const WEATHER_VAR_INFO: Record<string, { label: string; unit: string; color: string; digits: number }> = {
  temperature_2m: { label: 'Nhiệt độ 2m', unit: '°C', color: 'hsl(0, 75%, 55%)', digits: 1 },
  relative_humidity_2m: { label: 'Độ ẩm 2m', unit: '%', color: 'hsl(215, 75%, 55%)', digits: 0 },
  precipitation: { label: 'Lượng mưa', unit: 'mm', color: 'hsl(200, 90%, 45%)', digits: 1 },
  rain: { label: 'Mưa', unit: 'mm', color: 'hsl(205, 80%, 50%)', digits: 1 },
  cloud_cover: { label: 'Mây che phủ', unit: '%', color: 'hsl(220, 10%, 55%)', digits: 0 },
  shortwave_radiation: { label: 'Bức xạ sóng ngắn', unit: 'W/m²', color: 'hsl(42, 95%, 50%)', digits: 0 },
  et0_fao_evapotranspiration: { label: 'Bốc thoát hơi ET0', unit: 'mm', color: 'hsl(150, 60%, 40%)', digits: 2 },
  vapour_pressure_deficit: { label: 'VPD', unit: 'kPa', color: 'hsl(300, 50%, 50%)', digits: 2 },
  wind_speed_10m: { label: 'Gió 10m', unit: 'km/h', color: 'hsl(180, 55%, 40%)', digits: 1 },
  dew_point_2m: { label: 'Điểm sương 2m', unit: '°C', color: 'hsl(190, 60%, 45%)', digits: 1 },
  surface_pressure: { label: 'Áp suất bề mặt', unit: 'hPa', color: 'hsl(250, 35%, 55%)', digits: 0 },
  precipitation_probability: { label: 'Xác suất mưa', unit: '%', color: 'hsl(205, 60%, 60%)', digits: 0 },
  soil_temperature: { label: 'Nhiệt độ đất (ERA5)', unit: '°C', color: 'hsl(28, 75%, 48%)', digits: 1 },
  soil_moisture: { label: 'Độ ẩm đất (ERA5)', unit: 'm³/m³', color: 'hsl(195, 70%, 40%)', digits: 3 },
  soil_temperature_0cm: { label: 'Nhiệt độ đất 0cm', unit: '°C', color: 'hsl(28, 75%, 48%)', digits: 1 },
  soil_moisture_0_to_1cm: { label: 'Độ ẩm đất 0–1cm', unit: 'm³/m³', color: 'hsl(195, 70%, 40%)', digits: 3 },
};

export function weatherVarLabel(key: string, withUnit = false): string {
  const i = WEATHER_VAR_INFO[key];
  if (!i) return key;
  return withUnit && i.unit ? `${i.label} (${i.unit})` : i.label;
}

export interface WeatherHourly {
  t: string;
  ts: number;
  [k: string]: number | string | undefined;
}

export interface WeatherDaily {
  t: string;
  ts: number;
  [k: string]: number | string | undefined;
}

export interface WeatherNext24h {
  precip_total_mm?: number;
  precip_prob_max?: number;
  rain_hours?: number;
  temp_min?: number;
  temp_max?: number;
  rh_mean?: number;
  et0_total_mm?: number;
  radiation_mean?: number;
}

export interface WeatherResponse {
  location?: { lat?: number; lon?: number; name?: string };
  timezone?: string;
  hourly: WeatherHourly[];
  daily: WeatherDaily[];
  current?: Record<string, number | string | undefined> & { t?: string; ts?: number };
  /** Tóm tắt 24h tới (chỉ /weather/current) */
  next24h?: WeatherNext24h;
  /** true nếu dữ liệu lấy từ cache cũ (Open-Meteo không truy cập được) */
  stale?: boolean;
  source?: string;
}

function parseTimeRows(x: unknown): WeatherHourly[] {
  return rowsFrom(x, 'data', 'rows', 'points')
    .map((r) => {
      const t = pickTime(r);
      const ts = toMs(t);
      if (ts === undefined) return null;
      const row: WeatherHourly = { t: str(t) ?? new Date(ts).toISOString(), ts };
      for (const [k, v] of Object.entries(r)) {
        if (['t', 'time', 'timestamp', 'ts', 'date', 'ds'].includes(k)) continue;
        const n = num(v);
        if (n !== undefined) row[k] = n;
        else if (typeof v === 'string') row[k] = v;
      }
      return row;
    })
    .filter((r): r is WeatherHourly => r !== null)
    .sort((a, b) => a.ts - b.ts);
}

export function parseWeather(raw: unknown): WeatherResponse {
  if (!isObj(raw)) {
    if (Array.isArray(raw)) return { hourly: parseTimeRows(raw), daily: [] };
    return { hourly: [], daily: [] };
  }
  const loc = isObj(raw.location) ? raw.location : undefined;
  let current: WeatherResponse['current'];
  if (isObj(raw.current)) {
    const c: Record<string, number | string | undefined> = {};
    for (const [k, v] of Object.entries(raw.current)) {
      const n = num(v);
      c[k] = n !== undefined ? n : typeof v === 'string' ? v : undefined;
    }
    const t = pickTime(raw.current);
    current = { ...c, t: str(t), ts: toMs(t) };
  }
  return {
    location: loc
      ? { lat: num(loc.lat ?? loc.latitude), lon: num(loc.lon ?? loc.longitude), name: str(loc.name) }
      : num(raw.latitude) !== undefined
        ? { lat: num(raw.latitude), lon: num(raw.longitude) }
        : undefined,
    timezone: str(raw.timezone),
    hourly: parseTimeRows(raw.hourly),
    daily: parseTimeRows(raw.daily),
    current,
    next24h: isObj(raw.next24h)
      ? {
          precip_total_mm: num(raw.next24h.precip_total_mm),
          precip_prob_max: num(raw.next24h.precip_prob_max),
          rain_hours: num(raw.next24h.rain_hours),
          temp_min: num(raw.next24h.temp_min),
          temp_max: num(raw.next24h.temp_max),
          rh_mean: num(raw.next24h.rh_mean),
          et0_total_mm: num(raw.next24h.et0_total_mm),
          radiation_mean: num(raw.next24h.radiation_mean),
        }
      : undefined,
    stale: bool(raw.stale),
    source: str(raw.source),
  };
}

// ---- Correlation ----

export interface CorrelationResponse {
  method: string;
  days?: number;
  variables_weather: string[];
  variables_sensor: string[];
  /** rows = weather, cols = sensor */
  matrix: (number | null)[][];
  lag?: { best_lag_h: (number | null)[][]; best_corr: (number | null)[][] };
  n?: number;
  max_lag_h?: number;
  pvalues?: (number | null)[][];
  /** Nhận định do backend sinh (tiếng Việt) */
  insights: string[];
}

function parseMatrix(x: unknown): (number | null)[][] {
  return arr(x).map((row) => arr(row).map(numOrNull));
}

export function parseCorrelation(raw: unknown): CorrelationResponse {
  if (!isObj(raw)) throw new BackendError('Invalid correlation', 200, 'parse', 'Phản hồi tương quan không hợp lệ');
  const vw = arr(raw.variables_weather ?? raw.weather_vars ?? raw.rows).map((v) => String(v));
  const vs = arr(raw.variables_sensor ?? raw.sensor_vars ?? raw.cols).map((v) => String(v));
  const lagRaw = isObj(raw.lag) ? raw.lag : undefined;
  return {
    method: str(raw.method) ?? 'pearson',
    days: num(raw.days),
    variables_weather: vw,
    variables_sensor: vs,
    matrix: parseMatrix(raw.matrix ?? raw.corr),
    lag: lagRaw
      ? { best_lag_h: parseMatrix(lagRaw.best_lag_h ?? lagRaw.lag_h), best_corr: parseMatrix(lagRaw.best_corr ?? lagRaw.corr) }
      : undefined,
    n: num(raw.n ?? raw.n_points),
    max_lag_h: num(raw.max_lag_h),
    pvalues: Array.isArray(raw.pvalues) ? parseMatrix(raw.pvalues) : undefined,
    insights: arr(raw.insights).filter((s): s is string => typeof s === 'string'),
  };
}

// ============================================================================
// Sensor history (InfluxDB)
// ============================================================================

export interface HistoryPoint {
  t: string;
  ts: number;
  [field: string]: number | string | undefined;
}

export interface HistoryResponse {
  every?: string;
  fields?: string[];
  points: HistoryPoint[];
}

export function parseHistory(raw: unknown): HistoryResponse {
  const points = parseTimeRows(
    isObj(raw) ? (raw.points ?? raw.data ?? raw.rows ?? raw.records ?? raw.values ?? raw) : raw,
  ) as HistoryPoint[];
  return {
    every: isObj(raw) ? str(raw.every) : undefined,
    fields: isObj(raw) && Array.isArray(raw.fields) ? raw.fields.map(String) : undefined,
    points,
  };
}

// ============================================================================
// Sync
// ============================================================================

export interface SyncStatus {
  [k: string]: unknown;
}

export interface SyncLogEntry {
  ts?: string;
  direction?: string;
  status?: string;
  n_records?: number;
  duration_ms?: number;
  range_start?: string;
  range_end?: string;
  error?: string;
  [k: string]: unknown;
}

function parseSyncLogs(raw: unknown): SyncLogEntry[] {
  return rowsFrom(raw, 'logs', 'rows', 'data', 'items').map((r) => ({
    ...r,
    ts: str(r.ts ?? r.time ?? r.t),
    direction: str(r.direction),
    status: str(r.status),
    n_records: num(r.n_records),
    duration_ms: num(r.duration_ms),
    range_start: str(r.range_start),
    range_end: str(r.range_end),
    error: str(r.error) ?? undefined,
  }));
}

// ============================================================================
// Fallback trực tiếp Open-Meteo + dữ liệu cảm biến khi Backend đang Cold Start / 503
// ============================================================================

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const OM_HOURLY_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'dew_point_2m',
  'precipitation',
  'rain',
  'cloud_cover',
  'shortwave_radiation',
  'et0_fao_evapotranspiration',
  'vapour_pressure_deficit',
  'wind_speed_10m',
  'surface_pressure',
];
const OM_CURRENT_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'precipitation',
  'rain',
  'cloud_cover',
  'wind_speed_10m',
  'wind_direction_10m',
  'weather_code',
  'is_day',
  'surface_pressure',
  'shortwave_radiation',
];
const OM_DAILY_VARS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'et0_fao_evapotranspiration',
  'shortwave_radiation_sum',
  'weather_code',
];

let cachedOpenMeteoPayload: { at: number; data: Obj } | null = null;

async function fetchOpenMeteoForecastRaw(signal?: AbortSignal): Promise<Obj> {
  if (cachedOpenMeteoPayload && Date.now() - cachedOpenMeteoPayload.at < 5 * 60_000) {
    return cachedOpenMeteoPayload.data;
  }
  const qs = new URLSearchParams({
    latitude: String(FARM_LOCATION.lat),
    longitude: String(FARM_LOCATION.lon),
    hourly: [...OM_HOURLY_VARS, 'soil_temperature_6cm', 'soil_moisture_3_to_9cm', 'precipitation_probability'].join(','),
    daily: OM_DAILY_VARS.join(','),
    current: OM_CURRENT_VARS.join(','),
    past_days: '92',
    forecast_days: '16',
    timezone: 'Asia/Ho_Chi_Minh',
  });
  const res = await fetch(`${OPEN_METEO_FORECAST_URL}?${qs.toString()}`, { signal });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = (await res.json()) as Obj;
  cachedOpenMeteoPayload = { at: Date.now(), data };
  return data;
}

function normalizeOpenMeteoHourly(hourlyObj: unknown): WeatherHourly[] {
  if (!isObj(hourlyObj)) return [];
  const normalized: Obj = { ...hourlyObj };
  if (normalized.soil_temperature_6cm && !normalized.soil_temperature) {
    normalized.soil_temperature = normalized.soil_temperature_6cm;
  }
  if (normalized.soil_moisture_3_to_9cm && !normalized.soil_moisture) {
    normalized.soil_moisture = normalized.soil_moisture_3_to_9cm;
  }
  if (normalized.soil_temperature_0_to_7cm && !normalized.soil_temperature) {
    normalized.soil_temperature = normalized.soil_temperature_0_to_7cm;
  }
  if (normalized.soil_moisture_0_to_7cm && !normalized.soil_moisture) {
    normalized.soil_moisture = normalized.soil_moisture_0_to_7cm;
  }
  return parseTimeRows(normalized);
}

function computeNext24hSummary(hourly: WeatherHourly[], nowMs: number): WeatherNext24h {
  const nxt = hourly.filter((r) => r.ts >= nowMs && r.ts < nowMs + 24 * 3600_000);
  if (!nxt.length) return {};
  const vals = (k: string) => nxt.map((r) => num(r[k])).filter((v): v is number => v !== undefined);
  const sum = (arrNum: number[]) => arrNum.reduce((a, b) => a + b, 0);
  const mean = (arrNum: number[]) => (arrNum.length ? sum(arrNum) / arrNum.length : undefined);
  const precip = vals('precipitation');
  const prob = vals('precipitation_probability');
  const temps = vals('temperature_2m');
  const rh = vals('relative_humidity_2m');
  const et0 = vals('et0_fao_evapotranspiration');
  const rad = vals('shortwave_radiation');
  return {
    precip_total_mm: precip.length ? Number(sum(precip).toFixed(1)) : undefined,
    precip_prob_max: prob.length ? Math.round(Math.max(...prob)) : undefined,
    rain_hours: precip.filter((p) => p > 0.1).length,
    temp_min: temps.length ? Number(Math.min(...temps).toFixed(1)) : undefined,
    temp_max: temps.length ? Number(Math.max(...temps).toFixed(1)) : undefined,
    rh_mean: rh.length ? Math.round(mean(rh)!) : undefined,
    et0_total_mm: et0.length ? Number(sum(et0).toFixed(2)) : undefined,
    radiation_mean: rad.length ? Math.round(mean(rad)!) : undefined,
  };
}

async function fallbackSensorHistory(p: { start: string; end: string; every?: string; fields?: string[] }): Promise<HistoryResponse> {
  const soil = await loadLocalSoilData();
  if (!soil) return { every: p.every ?? '1h', fields: p.fields, points: [] };
  const startMs = toMs(p.start) ?? 0;
  const endMs = toMs(p.end) ?? Date.now();
  const bucketMs = p.every === '1d' ? 86400_000 : p.every === '5m' ? 300_000 : 3600_000;
  const wantedFields = p.fields?.length ? p.fields : TARGETS.map((t) => t.key);

  const buckets = new Map<number, Record<string, { sum: number; n: number }>>();
  for (const [day, times] of Object.entries(soil)) {
    if (!times || typeof times !== 'object') continue;
    for (const [clock, rec] of Object.entries(times)) {
      const ts = toMs(`${day}T${clock.length === 5 ? `${clock}:00` : clock}+07:00`);
      if (ts === undefined || ts < startMs || ts > endMs) continue;
      const b = Math.floor(ts / bucketMs) * bucketMs;
      let bObj = buckets.get(b);
      if (!bObj) {
        bObj = {};
        buckets.set(b, bObj);
      }
      for (const f of wantedFields) {
        const v = num((rec as unknown as Obj)[f]);
        if (v !== undefined) {
          const stat = bObj[f] ?? { sum: 0, n: 0 };
          stat.sum += v;
          stat.n += 1;
          bObj[f] = stat;
        }
      }
    }
  }
  const points: HistoryPoint[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, statsObj]) => {
      const pt: HistoryPoint = { t: vnIsoString(ts), ts };
      for (const [f, st] of Object.entries(statsObj)) {
        if (st.n > 0) pt[f] = Number((st.sum / st.n).toFixed(2));
      }
      return pt;
    });
  return { every: p.every ?? '1h', fields: wantedFields, points };
}

function rankArray(vals: number[]): number[] {
  const indexed = vals.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(vals.length);
  for (let i = 0; i < indexed.length; i++) ranks[indexed[i].i] = i + 1;
  return ranks;
}

function pearsonCorr(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 24) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let numCov = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    numCov += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom > 1e-12 ? Number((numCov / denom).toFixed(4)) : null;
}

async function fallbackWeatherCorrelation(p: {
  days: number;
  method: 'pearson' | 'spearman';
  max_lag_h?: number;
}): Promise<CorrelationResponse> {
  const soil = await loadLocalSoilData();
  if (!soil) throw new BackendError('No sensor data', 404, 'not_found', 'Chưa có dữ liệu cảm biến');
  const dates = Object.keys(soil).sort();
  const lastDateStr = dates[dates.length - 1];
  const endMs = (toMs(`${lastDateStr}T23:59:59+07:00`) ?? Date.now());
  const startMs = endMs - p.days * 86400_000;
  const startDate = vnDateString(startMs);
  const endDate = vnDateString(endMs);

  const [weatherRes, sensorHist] = await Promise.all([
    backendAPI.getWeatherHistory({ start: startDate, end: endDate }),
    fallbackSensorHistory({ start: vnIsoString(startMs), end: vnIsoString(endMs), every: '1h' }),
  ]);

  const wVars = [
    'temperature_2m',
    'relative_humidity_2m',
    'precipitation',
    'cloud_cover',
    'shortwave_radiation',
    'et0_fao_evapotranspiration',
    'vapour_pressure_deficit',
    'wind_speed_10m',
    'soil_temperature',
    'soil_moisture',
  ];
  const sVars = TARGETS.map((t) => t.key);

  const wByHour = new Map<number, WeatherHourly>();
  for (const r of weatherRes.hourly) {
    wByHour.set(Math.floor(r.ts / 3600_000) * 3600_000, r);
  }
  const sByHour = new Map<number, HistoryPoint>();
  for (const pt of sensorHist.points) {
    sByHour.set(Math.floor(pt.ts / 3600_000) * 3600_000, pt);
  }

  const commonHours = [...sByHour.keys()].filter((h) => wByHour.has(h)).sort((a, b) => a - b);
  const maxLag = p.max_lag_h ?? 24;

  const computeR = (xs: number[], ys: number[]) =>
    p.method === 'spearman' ? pearsonCorr(rankArray(xs), rankArray(ys)) : pearsonCorr(xs, ys);

  const matrix: (number | null)[][] = [];
  const bestLagMat: (number | null)[][] = [];
  const bestCorrMat: (number | null)[][] = [];

  for (const w of wVars) {
    const row: (number | null)[] = [];
    const lrow: (number | null)[] = [];
    const crow: (number | null)[] = [];
    for (const s of sVars) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const h of commonHours) {
        const wv = num(wByHour.get(h)?.[w]);
        const sv = num(sByHour.get(h)?.[s]);
        if (wv !== undefined && sv !== undefined) {
          xs.push(wv);
          ys.push(sv);
        }
      }
      const r0 = computeR(xs, ys);
      row.push(r0);
      if (r0 === null) {
        lrow.push(null);
        crow.push(null);
        continue;
      }
      let bestL = 0;
      let bestC = r0;
      for (let lag = 1; lag <= maxLag; lag++) {
        const lxs: number[] = [];
        const lys: number[] = [];
        for (const h of commonHours) {
          const wv = num(wByHour.get(h)?.[w]);
          const sv = num(sByHour.get(h + lag * 3600_000)?.[s]);
          if (wv !== undefined && sv !== undefined) {
            lxs.push(wv);
            lys.push(sv);
          }
        }
        const rl = computeR(lxs, lys);
        if (rl !== null && Math.abs(rl) > Math.abs(bestC)) {
          bestL = lag;
          bestC = rl;
        }
      }
      lrow.push(bestL);
      crow.push(bestC);
    }
    matrix.push(row);
    bestLagMat.push(lrow);
    bestCorrMat.push(crow);
  }

  const insights: string[] = [];
  const rankedPairs: { abs: number; r: number; w: string; s: string; lag: number | null; rc: number | null }[] = [];
  for (let i = 0; i < wVars.length; i++) {
    for (let j = 0; j < sVars.length; j++) {
      const r = matrix[i][j];
      if (r !== null && Math.abs(r) >= 0.25) {
        rankedPairs.push({ abs: Math.abs(r), r, w: wVars[i], s: sVars[j], lag: bestLagMat[i][j], rc: bestCorrMat[i][j] });
      }
    }
  }
  rankedPairs.sort((a, b) => b.abs - a.abs);
  for (const item of rankedPairs.slice(0, 5)) {
    const dir = item.r > 0 ? 'thuận' : 'nghịch';
    const strength = item.abs >= 0.8 ? 'rất mạnh' : item.abs >= 0.6 ? 'mạnh' : item.abs >= 0.4 ? 'trung bình' : 'yếu';
    let txt = `${weatherVarLabel(item.w)} tương quan ${dir} ${strength} với ${targetLabel(item.s)} (r = ${item.r.toFixed(2)})`;
    if (item.lag && item.rc !== null && Math.abs(item.rc) > item.abs + 0.02) {
      txt += `; mạnh nhất khi trễ ${item.lag} giờ (r = ${item.rc.toFixed(2)})`;
    }
    insights.push(`${txt}.`);
  }

  return {
    method: p.method,
    days: p.days,
    variables_weather: wVars,
    variables_sensor: sVars,
    matrix,
    lag: { best_lag_h: bestLagMat, best_corr: bestCorrMat },
    n: commonHours.length,
    max_lag_h: maxLag,
    insights,
  };
}

// ============================================================================
// Public API functions
// ============================================================================

export const backendAPI = {
  // ---- Forecast ----
  async getModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    return parseModels(await get('/forecast/models', undefined, signal));
  },

  async getForecast(
    p: { target: string; horizon: string; model?: string },
    signal?: AbortSignal,
  ): Promise<ForecastResponse> {
    const model = p.model ?? 'best';
    const raw = await get('/forecast', { target: p.target, horizon: p.horizon, model }, signal);
    return parseForecast(raw, { target: p.target, horizon: p.horizon, model });
  },

  async getMetrics(p: { target?: string; horizon?: string; kind?: MetricKind } = {}, signal?: AbortSignal): Promise<MetricsResponse> {
    return parseMetrics(await get('/forecast/metrics', { target: p.target, horizon: p.horizon, kind: p.kind }, signal));
  },

  /** last_days: chỉ lấy N ngày cuối của tập test (mặc định 7 cho short, 30 cho long – dữ liệu đầy đủ rất lớn) */
  async getTestPredictions(
    p: { target: string; model?: string; group?: HorizonGroup; horizon?: string; last_days?: number },
    signal?: AbortSignal,
  ): Promise<TestPredictionsResponse> {
    const lastDays = p.last_days ?? (p.group === 'long' ? 30 : 7);
    const raw = await get(
      '/forecast/test-predictions',
      { target: p.target, model: p.model, group: p.group, horizon: p.horizon, last_days: lastDays },
      signal,
    );
    return parseTestPredictions(raw, { target: p.target, group: p.group });
  },

  async getRuntime(signal?: AbortSignal): Promise<RuntimeInfo> {
    return parseRuntime(await get('/forecast/runtime', undefined, signal));
  },

  async startTraining(quick: boolean): Promise<TrainStatus> {
    return parseTrainStatus(await post('/forecast/train', { quick }));
  },

  async getTrainStatus(signal?: AbortSignal): Promise<TrainStatus> {
    return parseTrainStatus(await get('/forecast/train/status', undefined, signal));
  },

  // ---- Weather ----
  async getWeatherCurrent(signal?: AbortSignal): Promise<WeatherResponse> {
    try {
      return parseWeather(await get('/weather/current', undefined, signal));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      const raw = await fetchOpenMeteoForecastRaw(signal);
      const hourlyAll = normalizeOpenMeteoHourly(raw.hourly);
      const nowMs = Date.now();
      const hourly = hourlyAll.filter((r) => r.ts >= nowMs - 12 * 3600_000 && r.ts <= nowMs + 48 * 3600_000);
      return parseWeather({
        ...raw,
        location: FARM_LOCATION,
        hourly,
        next24h: computeNext24hSummary(hourlyAll, nowMs),
      });
    }
  },

  /** start/end: 'YYYY-MM-DD' */
  async getWeatherHistory(p: { start: string; end: string }, signal?: AbortSignal): Promise<WeatherResponse> {
    try {
      return parseWeather(await get('/weather/history', { start: p.start, end: p.end }, signal));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      const startMs = toMs(p.start) ?? 0;
      const endMs = (toMs(p.end) ?? Date.now()) + 86400_000;
      const raw = await fetchOpenMeteoForecastRaw(signal);
      let hourly = normalizeOpenMeteoHourly(raw.hourly).filter((r) => r.ts >= startMs && r.ts < endMs && r.ts <= Date.now());
      if (!hourly.length) {
        const qs = new URLSearchParams({
          latitude: String(FARM_LOCATION.lat),
          longitude: String(FARM_LOCATION.lon),
          start_date: p.start,
          end_date: p.end,
          hourly: [...OM_HOURLY_VARS, 'soil_temperature_0_to_7cm', 'soil_moisture_0_to_7cm'].join(','),
          timezone: 'Asia/Ho_Chi_Minh',
        });
        const archRes = await fetch(`${OPEN_METEO_ARCHIVE_URL}?${qs.toString()}`, { signal });
        if (archRes.ok) {
          const archJson = (await archRes.json()) as Obj;
          hourly = normalizeOpenMeteoHourly(archJson.hourly);
        }
      }
      return { location: FARM_LOCATION, timezone: 'Asia/Ho_Chi_Minh', hourly, daily: [] };
    }
  },

  async getWeatherForecast(days: number, signal?: AbortSignal): Promise<WeatherResponse> {
    try {
      return parseWeather(await get('/weather/forecast', { days }, signal));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      const raw = await fetchOpenMeteoForecastRaw(signal);
      const nowMs = Math.floor(Date.now() / 3600_000) * 3600_000;
      const hourly = normalizeOpenMeteoHourly(raw.hourly).filter((r) => r.ts >= nowMs && r.ts < nowMs + days * 86400_000);
      const daily = parseTimeRows(raw.daily).filter((d) => d.ts >= nowMs - 86400_000).slice(0, days);
      return { location: FARM_LOCATION, timezone: 'Asia/Ho_Chi_Minh', hourly, daily };
    }
  },

  async getWeatherCorrelation(
    p: { days: number; method: 'pearson' | 'spearman'; max_lag_h?: number },
    signal?: AbortSignal,
  ): Promise<CorrelationResponse> {
    try {
      return parseCorrelation(
        await get('/weather/correlation', { days: p.days, method: p.method, max_lag_h: p.max_lag_h ?? 24 }, signal),
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      return fallbackWeatherCorrelation(p);
    }
  },

  // ---- Sensor history ----
  /** start/end: ISO 8601 (vd 2026-10-01T00:00:00+07:00); every: '5m' | '1h' | ...; fields: danh sách field */
  async getHistory(
    p: { start: string; end: string; every?: string; fields?: string[] },
    signal?: AbortSignal,
  ): Promise<HistoryResponse> {
    try {
      return parseHistory(
        await get(
          '/history',
          { start: p.start, end: p.end, every: p.every ?? '5m', fields: p.fields?.length ? p.fields.join(',') : undefined },
          signal,
        ),
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      return fallbackSensorHistory(p);
    }
  },

  // ---- Sync ----
  async getSyncStatus(signal?: AbortSignal): Promise<SyncStatus> {
    const raw = await get('/sync/status', undefined, signal);
    return isObj(raw) ? raw : {};
  },

  async getSyncLogs(p: { direction?: string; limit?: number } = {}, signal?: AbortSignal): Promise<SyncLogEntry[]> {
    return parseSyncLogs(await get('/sync/logs', { direction: p.direction, limit: p.limit ?? 200 }, signal));
  },
};

// ============================================================================
// TanStack Query keys & option factories
// ============================================================================

export const queryKeys = {
  models: ['forecast', 'models'] as const,
  forecast: (target: string, horizon: string, model: string) => ['forecast', 'predict', target, horizon, model] as const,
  metrics: (target?: string, horizon?: string, kind?: string) => ['forecast', 'metrics', target ?? 'all', horizon ?? 'all', kind ?? 'cum'] as const,
  runtime: ['forecast', 'runtime'] as const,
  testPredictions: (target: string, group?: string, model?: string, horizon?: string) =>
    ['forecast', 'test-predictions', target, group ?? 'all', model ?? 'all', horizon ?? 'all'] as const,
  trainStatus: ['forecast', 'train-status'] as const,
  weatherCurrent: ['weather', 'current'] as const,
  weatherHistory: (start: string, end: string) => ['weather', 'history', start, end] as const,
  weatherForecast: (days: number) => ['weather', 'forecast', days] as const,
  weatherCorrelation: (days: number, method: string, maxLag: number) => ['weather', 'correlation', days, method, maxLag] as const,
  history: (start: string, end: string, every: string, fields: string) => ['history', start, end, every, fields] as const,
  syncStatus: ['sync', 'status'] as const,
  syncLogs: (direction?: string, limit?: number) => ['sync', 'logs', direction ?? 'all', limit ?? 200] as const,
};

const FIVE_MIN = 5 * 60 * 1000;

export const forecastQuery = (target: string, horizon: string, model = 'best') => ({
  queryKey: queryKeys.forecast(target, horizon, model),
  queryFn: ({ signal }: { signal?: AbortSignal }) => backendAPI.getForecast({ target, horizon, model }, signal),
  refetchInterval: FIVE_MIN,
  staleTime: 60_000,
  retry: shouldRetry,
});

export const modelsQuery = () => ({
  queryKey: queryKeys.models,
  queryFn: ({ signal }: { signal?: AbortSignal }) => backendAPI.getModels(signal),
  staleTime: 60_000,
  retry: shouldRetry,
});

export const metricsQuery = (target?: string, horizon?: string, kind?: MetricKind) => ({
  queryKey: queryKeys.metrics(target, horizon, kind),
  queryFn: ({ signal }: { signal?: AbortSignal }) => backendAPI.getMetrics({ target, horizon, kind }, signal),
  staleTime: 5 * 60_000,
  retry: shouldRetry,
});

export const runtimeQuery = () => ({
  queryKey: queryKeys.runtime,
  queryFn: ({ signal }: { signal?: AbortSignal }) => backendAPI.getRuntime(signal),
  staleTime: 60_000,
  retry: shouldRetry,
});

// ============================================================================
// Date helpers (giờ Việt Nam, UTC+7)
// ============================================================================

const VN_OFFSET_MS = 7 * 3600 * 1000;

/** 'YYYY-MM-DD' theo giờ Việt Nam cho một mốc thời gian. */
export function vnDateString(d: Date | number): string {
  const ms = typeof d === 'number' ? d : d.getTime();
  return new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO 8601 với offset +07:00, vd '2026-10-29T12:00:00+07:00'. */
export function vnIsoString(d: Date | number): string {
  const ms = typeof d === 'number' ? d : d.getTime();
  return `${new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 19)}+07:00`;
}

/** Từ ngày lịch (Date của calendar picker – dùng năm/tháng/ngày theo giờ máy) → 'YYYY-MM-DD'. */
export function calendarDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
