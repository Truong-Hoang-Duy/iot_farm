import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ScrollText,
  CalendarIcon,
  RefreshCw,
  PlayCircle,
  Upload,
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Database,
  Clock,
  ServerOff,
  Loader2,
  Layers,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Info,
  ShieldCheck,
  Server,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  LOG_LIMIT,
  BackendUnavailableError,
  fetchSyncStatus,
  normalizeTs,
  runSyncNow,
  subscribeFirebaseWriteLogs,
  subscribeSyncLogs,
  type FirebaseWriteLog,
  type SyncLog,
  type SyncStatusPayload,
} from '@/services/logsAPI';
import {
  dateKeyToLocalDate,
  formatDateKeyVi,
  formatEpochMsVi,
  formatTimeOnlyVi,
  localDateToDateKey,
  parseTimeKey,
  todayDateKey,
} from '@/lib/timeKeys';

type StatusFilter = 'all' | 'ok' | 'error' | 'noop';

// ---------- Trình chuyển ngữ lỗi sang tiếng Việt thân thiện ----------
export function formatViError(rawError: unknown): string {
  if (!rawError) return '';
  const text = typeof rawError === 'string' ? rawError : (rawError as Error)?.message || JSON.stringify(rawError);

  if (text.includes('404') || text.includes('Not Found')) {
    return 'Lỗi 404 (Không tìm thấy): Đường dẫn API đồng bộ chưa được nạp trên máy chủ backend.';
  }
  if (text.includes('500') || text.includes('Internal Server Error')) {
    return 'Lỗi 500 (Máy chủ): Backend FastAPI gặp lỗi xử lý bên trong. Vui lòng kiểm tra log terminal.';
  }
  if (
    text.includes('502') ||
    text.includes('503') ||
    text.includes('504') ||
    text.includes('Failed to fetch') ||
    text.includes('NetworkError')
  ) {
    return 'Lỗi kết nối: Không thể liên lạc với máy chủ Backend FastAPI (Cổng 8000). Vui lòng kiểm tra terminal backend.';
  }
  if (text.includes('Connection refused') || text.includes('Errno 61')) {
    return 'Từ chối kết nối (Port chưa mở): Dịch vụ cục bộ chưa được khởi chạy hoặc cổng đang đóng.';
  }
  if (text.includes('timed out') || text.includes('Timeout') || text.includes('Errno 110')) {
    return 'Hết thời gian chờ (Timeout): Đường truyền mạng giữa thiết bị và cơ sở dữ liệu bị chậm hoặc ngắt quãng.';
  }
  if (text.includes('Network is unreachable') || text.includes('Errno 101')) {
    return 'Không có mạng: Thiết bị biên Jetson Nano đang bị mất kết nối Internet.';
  }
  if (text.includes('PERMISSION_DENIED') || text.includes('Permission denied')) {
    return 'Từ chối phân quyền (Permission Denied): Không đủ quyền ghi dữ liệu lên Firebase.';
  }
  if (text.includes('JSON.parse') || text.includes('SyntaxError')) {
    return 'Lỗi định dạng: Dữ liệu phản hồi từ máy chủ không đúng cú pháp JSON.';
  }
  return text;
}

// ---------- Thẻ trạng thái & nhãn trực quan ----------
const statusConfig: Record<string, { label: string; className: string }> = {
  ok: { label: 'Thành công', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  error: { label: 'Gặp lỗi', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  noop: { label: 'Không có dữ liệu mới', className: 'bg-secondary text-muted-foreground border-border' },
};

function StatusPill({ status }: { status?: string }) {
  const cfg = (status && statusConfig[status]) || {
    label: status || '--',
    className: 'bg-secondary text-muted-foreground border-border',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold', cfg.className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', status === 'ok' ? 'bg-emerald-500' : status === 'error' ? 'bg-destructive animate-pulse' : 'bg-muted-foreground')} />
      {cfg.label}
    </span>
  );
}

const directionConfig: Record<string, { label: string; className: string }> = {
  firebase_to_influx: { label: 'Firebase → InfluxDB', className: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20' },
  influx_to_firebase: { label: 'InfluxDB → Firebase', className: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' },
};

function DirectionPill({ direction }: { direction?: string }) {
  const cfg = (direction && directionConfig[direction]) || {
    label: direction || '--',
    className: 'bg-secondary text-muted-foreground border-border',
  };
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium', cfg.className)}>
      {cfg.label}
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'primary',
}: {
  icon: typeof Database;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'primary' | 'success' | 'destructive' | 'warning' | 'water';
}) {
  const toneClass: Record<string, string> = {
    primary: 'text-primary bg-primary/10',
    success: 'text-emerald-500 bg-emerald-500/10',
    destructive: 'text-destructive bg-destructive/10',
    warning: 'text-amber-500 bg-amber-500/10',
    water: 'text-sky-500 bg-sky-500/10',
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-3.5 sm:p-5 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground font-medium leading-snug">{label}</p>
          <p className="font-display text-xl sm:text-2xl font-bold truncate mt-1">{value}</p>
          {hint && <p className="text-[11px] text-muted-foreground mt-1 truncate">{hint}</p>}
        </div>
        <div className={cn('rounded-xl p-2.5 shrink-0', toneClass[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

const fmtTs = (ts: unknown) => {
  const ms = normalizeTs(ts);
  return ms !== null ? formatTimeOnlyVi(ms) : '--';
};

const fmtNum = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('vi-VN') : '--');

const fmtDuration = (ms: unknown) => {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '--';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
};

const fmtRangeValue = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '--';
  if (typeof v === 'number') {
    const ms = normalizeTs(v);
    return ms !== null ? formatEpochMsVi(ms) : String(v);
  }
  return String(v);
};

const pad2 = (n: number) => String(n).padStart(2, '0');

function getLogHour(log: FirebaseWriteLog): number | null {
  if (log.first_key) {
    const parts = log.first_key.split('/');
    const timePart = parts[parts.length - 1];
    const parsed = parseTimeKey(timePart);
    if (parsed) return parsed.hour;
  }
  const ms = normalizeTs(log.ts);
  if (ms !== null) {
    const d = new Date(ms + 7 * 60 * 60 * 1000);
    return d.getUTCHours();
  }
  return null;
}

// ---------- Khối hiển thị trạng thái đồng bộ Backend hoàn chỉnh ----------
function BackendStatusDisplay({
  status,
  state,
  error,
  onRefresh,
  onRunSync,
  isRunningSync,
}: {
  status: SyncStatusPayload | null;
  state: 'loading' | 'ok' | 'down' | 'error';
  error: string | null;
  onRefresh: () => void;
  onRunSync: () => void;
  isRunningSync: boolean;
}) {
  const cfg = (status?.config as Record<string, unknown>) || {};
  const fb = (status?.firebase as Record<string, unknown>) || {};
  const influx = (status?.influx as Record<string, unknown>) || {};
  const isInfluxOk = Boolean(influx.ok);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-4">
      {/* Tiêu đề & Nút thao tác (Fully Responsive) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-border/60">
        <div>
          <h2 className="font-display text-lg sm:text-xl font-bold flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
            Trạng thái đồng bộ hệ thống (Backend &amp; dữ liệu)
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Giám sát dịch vụ đồng bộ 2 chiều giữa Firebase Realtime Database và hệ thống lưu trữ
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-initial h-9 text-xs gap-1.5"
            onClick={onRefresh}
            disabled={state === 'loading'}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', state === 'loading' && 'animate-spin')} />
            Làm mới
          </Button>
          <Button
            size="sm"
            className="flex-1 sm:flex-initial h-9 text-xs gap-1.5 shadow-xs"
            onClick={onRunSync}
            disabled={isRunningSync || state === 'down'}
          >
            {isRunningSync ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
            {isRunningSync ? 'Đang đồng bộ…' : 'Chạy đồng bộ ngay'}
          </Button>
        </div>
      </div>

      {/* Thông báo trạng thái kết nối */}
      {state === 'loading' && !status && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/50 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>Đang kết nối và kiểm tra trạng thái máy chủ Backend FastAPI...</span>
        </div>
      )}

      {state === 'down' && (
        <div className="flex items-start gap-3 rounded-xl bg-amber-500/10 border border-amber-500/20 p-4 text-sm text-amber-800 dark:text-amber-300">
          <ServerOff className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold">Chưa kết nối được máy chủ Backend FastAPI (Cổng 8000)</p>
            <p className="text-xs mt-1 opacity-90 leading-relaxed">
              Dịch vụ backend có thể đang tạm dừng hoặc đang khởi động lại. Hệ thống Web Dashboard vẫn đang đọc trực tiếp và cập nhật nhật ký thời gian thực từ Firebase Realtime Database.
            </p>
          </div>
        </div>
      )}

      {state === 'error' && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
          <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold text-destructive">Backend phản hồi lỗi</p>
            <p className="text-xs text-muted-foreground mt-1 break-words leading-relaxed">
              {formatViError(error)}
            </p>
          </div>
        </div>
      )}

      {/* Lưới 4 Thẻ trạng thái trực quan rõ ràng */}
      {status && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Card 1: Firebase RTDB */}
            <div className="rounded-xl border border-border/80 bg-secondary/30 p-3.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-primary" />
                  Firebase RTDB
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Trực tuyến
                </span>
              </div>
              <p className="text-xs font-semibold truncate" title={String(fb.db_url || 'Firebase Default')}>
                {String(fb.db_url ? 'asia-southeast1 (Cloud)' : 'Đã kết nối')}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                Nguồn lưu trữ chính thức
              </p>
            </div>

            {/* Card 2: InfluxDB phụ trợ */}
            <div className="rounded-xl border border-border/80 bg-secondary/30 p-3.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-accent" />
                  InfluxDB (Tùy chọn)
                </span>
                {isInfluxOk ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Đang chạy
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary text-muted-foreground border border-border px-2 py-0.5 text-[11px] font-medium" title="Cơ sở dữ liệu phụ trợ chưa mở cổng 18181; không ảnh hưởng vận hành">
                    <Info className="h-3 w-3 text-muted-foreground" />
                    Chưa mở cổng local
                  </span>
                )}
              </div>
              <p className="text-xs font-semibold truncate">
                {isInfluxOk ? 'Cổng 18181 (Hoạt động)' : 'Cổng 18181 (Chưa bật)'}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {isInfluxOk ? 'Đồng bộ InfluxDB sẵn sàng' : 'Không bắt buộc (Firebase chạy chính)'}
              </p>
            </div>

            {/* Card 3: Chu kỳ đồng bộ */}
            <div className="rounded-xl border border-border/80 bg-secondary/30 p-3.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-sky-500" />
                  Chu kỳ tự động
                </span>
                <span className="inline-flex items-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 px-2 py-0.5 text-[11px] font-medium">
                  {status.enabled ? 'Đang bật' : 'Tắt'}
                </span>
              </div>
              <p className="text-xs font-semibold truncate">
                Mỗi {cfg.sync_interval_sec ?? 60}s (nhanh)
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                Đối soát: {Math.round(Number(cfg.audit_interval_sec ?? 1800) / 60)} phút / lần
              </p>
            </div>

            {/* Card 4: Thiết bị & Tiến trình */}
            <div className="rounded-xl border border-border/80 bg-secondary/30 p-3.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                  <Server className="h-3.5 w-3.5 text-indigo-500" />
                  Mã thiết bị
                </span>
                <span className="text-[11px] font-mono font-medium text-foreground bg-background px-1.5 py-0.5 rounded border border-border">
                  {String(status.device_id || 'jetson-nano-01')}
                </span>
              </div>
              <p className="text-xs font-semibold truncate">
                {status.running ? 'Đang thực hiện chu kỳ đồng bộ' : 'Đang chờ chu kỳ tiếp theo'}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                {status.last_fast ? `Vừa chạy: ${String(status.last_fast)}` : 'Chưa ghi nhận lần chạy gần nhất'}
              </p>
            </div>
          </div>

          {/* Chi tiết kỹ thuật dạng Collapsible */}
          <details className="group rounded-xl border border-border/60 bg-secondary/20 p-3 text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground flex items-center justify-between select-none">
              <span className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
                Xem phản hồi cấu hình chi tiết (JSON kỹ thuật)
              </span>
              <span className="text-[11px] opacity-70">Nhấn để mở / đóng</span>
            </summary>
            <div className="mt-3 pt-3 border-t border-border/50">
              <pre className="overflow-x-auto p-3 rounded-lg bg-background font-mono text-[11px] text-foreground/90 max-h-56">
                {JSON.stringify(status, null, 2)}
              </pre>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

// ---------- Component chính ----------
export default function LogsPage() {
  const { toast } = useToast();
  const [dateKey, setDateKey] = useState<string>(todayDateKey());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [tableDatePickerOpen, setTableDatePickerOpen] = useState(false);

  const [writeLogs, setWriteLogs] = useState<FirebaseWriteLog[]>([]);
  const [writeLoading, setWriteLoading] = useState(true);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writeFilter, setWriteFilter] = useState<StatusFilter>('all');
  const [writeHourFilter, setWriteHourFilter] = useState<'all' | number>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [syncLoading, setSyncLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncFilter, setSyncFilter] = useState<StatusFilter>('all');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'firebase_to_influx' | 'influx_to_firebase'>('all');

  const [backendStatus, setBackendStatus] = useState<SyncStatusPayload | null>(null);
  const [backendState, setBackendState] = useState<'loading' | 'ok' | 'down' | 'error'>('loading');
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isRunningSync, setIsRunningSync] = useState(false);

  const isToday = dateKey === todayDateKey();

  // Lắng nghe Realtime logs theo ngày
  useEffect(() => {
    setWriteLoading(true);
    setWriteError(null);
    const unsubscribe = subscribeFirebaseWriteLogs(
      dateKey,
      (items) => {
        setWriteLogs(items);
        setWriteLoading(false);
      },
      (err) => {
        setWriteError(err.message);
        setWriteLoading(false);
      },
    );
    return unsubscribe;
  }, [dateKey]);

  useEffect(() => {
    setSyncLoading(true);
    setSyncError(null);
    const unsubscribe = subscribeSyncLogs(
      dateKey,
      (items) => {
        setSyncLogs(items);
        setSyncLoading(false);
      },
      (err) => {
        setSyncError(err.message);
        setSyncLoading(false);
      },
    );
    return unsubscribe;
  }, [dateKey]);

  const loadBackendStatus = useCallback(async (signal?: AbortSignal) => {
    setBackendState('loading');
    try {
      const status = await fetchSyncStatus(signal);
      setBackendStatus(status);
      setBackendState('ok');
      setBackendError(null);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      setBackendStatus(null);
      if (error instanceof BackendUnavailableError) {
        setBackendState('down');
      } else {
        setBackendState('error');
        setBackendError((error as Error)?.message ?? String(error));
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadBackendStatus(controller.signal);
    return () => controller.abort();
  }, [loadBackendStatus]);

  const handleRunSync = async () => {
    setIsRunningSync(true);
    try {
      const result = await runSyncNow('both');
      const summary =
        result && typeof result === 'object' && 'message' in result ? String(result.message) : 'Đã gửi yêu cầu đồng bộ 2 chiều thành công.';
      toast({ title: 'Đồng bộ hoàn tất', description: summary });
      loadBackendStatus();
    } catch (error) {
      toast({
        title: 'Không thể kích hoạt đồng bộ',
        description:
          error instanceof BackendUnavailableError
            ? 'Backend (FastAPI :8000) chưa chạy hoặc không truy cập được.'
            : formatViError(error),
        variant: 'destructive',
      });
    } finally {
      setIsRunningSync(false);
    }
  };

  // Thống kê nhanh
  const writeStats = useMemo(() => {
    const ok = writeLogs.filter((l) => l.status === 'ok');
    const errors = writeLogs.filter((l) => l.status === 'error');
    const totalRecords = ok.reduce((sum, l) => sum + (typeof l.n_records === 'number' ? l.n_records : 0), 0);
    const lastOk = ok.reduce<number | null>((max, l) => {
      const ms = normalizeTs(l.ts);
      return ms !== null && (max === null || ms > max) ? ms : max;
    }, null);
    const latest = writeLogs[0];
    const backlog = ok.filter((l) => l.from_backlog).reduce((s, l) => s + (l.n_records ?? 0), 0);
    return { totalRecords, batches: writeLogs.length, errors: errors.length, lastOk, latest, backlog };
  }, [writeLogs]);

  const syncStats = useMemo(() => {
    const ok = syncLogs.filter((l) => l.status === 'ok');
    const sumDir = (dir: string) =>
      ok.filter((l) => l.direction === dir).reduce((s, l) => s + (typeof l.n_records === 'number' ? l.n_records : 0), 0);
    const lastOk = ok.reduce<number | null>((max, l) => {
      const ms = normalizeTs(l.ts);
      return ms !== null && (max === null || ms > max) ? ms : max;
    }, null);
    return {
      toInflux: sumDir('firebase_to_influx'),
      toFirebase: sumDir('influx_to_firebase'),
      errors: syncLogs.filter((l) => l.status === 'error').length,
      runs: syncLogs.length,
      lastOk,
    };
  }, [syncLogs]);

  const hourCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const l of writeLogs) {
      const h = getLogHour(l);
      if (h !== null) {
        counts[h] = (counts[h] || 0) + 1;
      }
    }
    return counts;
  }, [writeLogs]);

  const filteredWrites = useMemo(
    () =>
      writeLogs.filter((l) => {
        if (writeFilter !== 'all' && l.status !== writeFilter) return false;
        if (writeHourFilter !== 'all') {
          const h = getLogHour(l);
          if (h !== writeHourFilter) return false;
        }
        return true;
      }),
    [writeLogs, writeFilter, writeHourFilter],
  );

  useEffect(() => {
    setPage(1);
  }, [dateKey, writeFilter, writeHourFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredWrites.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredWrites.length);
  const pagedWrites = useMemo(
    () => filteredWrites.slice(startIndex, endIndex),
    [filteredWrites, startIndex, endIndex],
  );

  const paginationPages = useMemo(() => {
    const current = safePage;
    const total = totalPages;
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    if (current <= 4) {
      return [1, 2, 3, 4, 5, 'ellipsis', total] as (number | 'ellipsis')[];
    }
    if (current >= total - 3) {
      return [1, 'ellipsis', total - 4, total - 3, total - 2, total - 1, total] as (number | 'ellipsis')[];
    }
    return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total] as (number | 'ellipsis')[];
  }, [safePage, totalPages]);
  const filteredSync = useMemo(
    () =>
      syncLogs.filter(
        (l) =>
          (syncFilter === 'all' || l.status === syncFilter) &&
          (directionFilter === 'all' || l.direction === directionFilter),
      ),
    [syncLogs, syncFilter, directionFilter],
  );

  const dayLabel = isToday ? 'hôm nay' : `ngày ${formatDateKeyVi(dateKey)}`;
  const today = dateKeyToLocalDate(todayDateKey());

  return (
    <div className="space-y-6 animate-fade-in max-w-7xl mx-auto">
      {/* Header trang (Responsive) */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold flex items-center gap-3">
            <ScrollText className="h-7 w-7 text-primary shrink-0" />
            <span>Nhật ký đồng bộ</span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Theo dõi các lô dữ liệu Jetson Nano gửi lên Firebase và quá trình đồng bộ 2 chiều
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-2 flex-1 sm:flex-initial min-w-[150px] justify-start text-xs sm:text-sm">
                <CalendarIcon className="h-4 w-4 text-primary shrink-0" />
                <span>{formatDateKeyVi(dateKey)}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={dateKeyToLocalDate(dateKey)}
                onSelect={(d) => {
                  if (d) {
                    setDateKey(localDateToDateKey(d));
                    setDatePickerOpen(false);
                  }
                }}
                disabled={(d) => d > today}
                defaultMonth={dateKeyToLocalDate(dateKey)}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          {!isToday && (
            <Button variant="ghost" size="sm" className="h-9 text-xs sm:text-sm shrink-0" onClick={() => setDateKey(todayDateKey())}>
              Hôm nay
            </Button>
          )}
        </div>
      </div>

      {/* Khối trạng thái đồng bộ Backend */}
      <BackendStatusDisplay
        status={backendStatus}
        state={backendState}
        error={backendError}
        onRefresh={() => loadBackendStatus()}
        onRunSync={handleRunSync}
        isRunningSync={isRunningSync}
      />

      {/* Tabs danh mục nhật ký */}
      <Tabs defaultValue="writes" className="space-y-4">
        <TabsList className="w-full sm:w-auto grid grid-cols-2 sm:inline-flex h-auto p-1 bg-secondary/60 rounded-xl">
          <TabsTrigger value="writes" className="gap-2 py-2 text-xs sm:text-sm">
            <Upload className="h-4 w-4 shrink-0" />
            <span>Ghi lên Firebase (Jetson)</span>
          </TabsTrigger>
          <TabsTrigger value="sync" className="gap-2 py-2 text-xs sm:text-sm">
            <ArrowLeftRight className="h-4 w-4 shrink-0" />
            <span>Đồng bộ 2 chiều</span>
          </TabsTrigger>
        </TabsList>

        {/* ---- TAB 1: Ghi lên Firebase từ Jetson ---- */}
        <TabsContent value="writes" className="space-y-4">
          <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Database}
              label={`Bản ghi đã nhận ${dayLabel}`}
              value={fmtNum(writeStats.totalRecords)}
              hint={`${fmtNum(writeStats.batches)} lô · ${fmtNum(writeStats.backlog)} từ đệm offline`}
              tone="success"
            />
            <StatCard
              icon={XCircle}
              label="Số lô báo lỗi"
              value={fmtNum(writeStats.errors)}
              hint={writeStats.errors === 0 ? 'Tất cả bình thường' : 'Cần kiểm tra chi tiết'}
              tone={writeStats.errors > 0 ? 'destructive' : 'primary'}
            />
            <StatCard
              icon={CheckCircle2}
              label="Thành công gần nhất"
              value={writeStats.lastOk !== null ? formatTimeOnlyVi(writeStats.lastOk) : '--'}
              hint={writeStats.lastOk !== null ? formatEpochMsVi(writeStats.lastOk, { day: '2-digit', month: '2-digit', year: 'numeric' }) : undefined}
              tone="water"
            />
            <StatCard
              icon={Layers}
              label="Hàng đợi tồn trên Jetson"
              value={writeStats.latest ? fmtNum(writeStats.latest.queue_pending) : '--'}
              hint="bản ghi chờ gửi"
              tone={(writeStats.latest?.queue_pending ?? 0) > 0 ? 'warning' : 'primary'}
            />
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
              <div>
                <h3 className="font-display text-base sm:text-lg font-bold">Danh sách log từ Jetson Nano</h3>
              </div>

              {/* Bộ lọc thanh công cụ: Ngày, Giờ, Trạng thái, Đặt lại */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Lọc theo ngày */}
                <Popover open={tableDatePickerOpen} onOpenChange={setTableDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 px-3 gap-1.5 text-xs font-normal"
                      title="Chọn ngày ghi nhận log"
                    >
                      <CalendarIcon className="h-3.5 w-3.5 text-primary" />
                      <span>{formatDateKeyVi(dateKey)}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dateKeyToLocalDate(dateKey)}
                      onSelect={(d) => {
                        if (d) {
                          setDateKey(localDateToDateKey(d));
                          setTableDatePickerOpen(false);
                        }
                      }}
                      disabled={(d) => d > today}
                      defaultMonth={dateKeyToLocalDate(dateKey)}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>

                {/* Lọc theo giờ */}
                <Select
                  value={String(writeHourFilter)}
                  onValueChange={(v) => {
                    setWriteHourFilter(v === 'all' ? 'all' : Number(v));
                  }}
                >
                  <SelectTrigger className="w-[155px] sm:w-[170px] h-9 text-xs">
                    <Clock className="h-3.5 w-3.5 mr-1 text-muted-foreground shrink-0" />
                    <SelectValue placeholder="Lọc theo giờ" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="all">Tất cả các giờ</SelectItem>
                    {Array.from({ length: 24 }, (_, i) => i).map((h) => {
                      const count = hourCounts[h] || 0;
                      return (
                        <SelectItem key={h} value={String(h)}>
                          {pad2(h)}:00 - {pad2(h)}:59 {count > 0 ? `(${count})` : ''}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>

                {/* Lọc trạng thái */}
                <Select
                  value={writeFilter}
                  onValueChange={(v) => {
                    setWriteFilter(v as StatusFilter);
                  }}
                >
                  <SelectTrigger className="w-[145px] sm:w-[160px] h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả trạng thái</SelectItem>
                    <SelectItem value="ok">Chỉ mục thành công</SelectItem>
                    <SelectItem value="error">Chỉ mục có lỗi</SelectItem>
                  </SelectContent>
                </Select>

                {/* Nút đặt lại khi có bộ lọc hoạt động */}
                {(writeHourFilter !== 'all' || writeFilter !== 'all' || !isToday) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1"
                    onClick={() => {
                      setWriteHourFilter('all');
                      setWriteFilter('all');
                      setDateKey(todayDateKey());
                    }}
                    title="Đặt lại toàn bộ bộ lọc về mặc định"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Đặt lại</span>
                  </Button>
                )}
              </div>
            </div>

            <LogTableShell
              loading={writeLoading}
              error={writeError}
              empty={filteredWrites.length === 0}
              dayLabel={writeHourFilter !== 'all' ? `${pad2(writeHourFilter)}:00 - ${pad2(writeHourFilter)}:59 (${dayLabel})` : dayLabel}
            >
              {/* Desktop Table View (≥ md) */}
              <div className="hidden md:block rounded-xl border border-border overflow-hidden">
                <div className="overflow-x-auto overflow-y-auto max-h-[520px]">
                  <Table className="min-w-[880px]">
                    <TableHeader className="sticky top-0 z-10 bg-secondary/95 backdrop-blur-xs shadow-2xs">
                      <TableRow className="text-xs border-b border-border/80">
                        <TableHead className="font-semibold text-foreground whitespace-nowrap py-3">Thời gian</TableHead>
                        <TableHead className="font-semibold text-foreground py-3">Trạng thái</TableHead>
                        <TableHead className="font-semibold text-foreground text-right whitespace-nowrap py-3">Số bản ghi</TableHead>
                        <TableHead className="font-semibold text-foreground whitespace-nowrap py-3">Khoảng mốc giờ</TableHead>
                        <TableHead className="font-semibold text-foreground text-right py-3">HTTP</TableHead>
                        <TableHead className="font-semibold text-foreground text-right whitespace-nowrap py-3">Thời lượng</TableHead>
                        <TableHead className="font-semibold text-foreground text-right whitespace-nowrap py-3">Hàng đợi</TableHead>
                        <TableHead className="font-semibold text-foreground whitespace-nowrap py-3">Nguồn</TableHead>
                        <TableHead className="font-semibold text-foreground py-3">Chi tiết / Thông báo lỗi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedWrites.map((log) => (
                        <TableRow key={log.id} className={cn('text-xs hover:bg-secondary/20 transition-colors', log.status === 'error' && 'bg-destructive/5')}>
                          <TableCell className="whitespace-nowrap font-mono">{fmtTs(log.ts)}</TableCell>
                          <TableCell>
                            <StatusPill status={log.status} />
                          </TableCell>
                          <TableCell className="text-right font-semibold">{fmtNum(log.n_records)}</TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-[11px]">
                            {log.first_key || '--'}
                            {log.last_key && log.last_key !== log.first_key ? ` → ${log.last_key}` : ''}
                          </TableCell>
                          <TableCell className="text-right font-mono text-[11px]">{log.http_status ?? '--'}</TableCell>
                          <TableCell className="text-right whitespace-nowrap text-muted-foreground">{fmtDuration(log.duration_ms)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{fmtNum(log.queue_pending)}</TableCell>
                          <TableCell>
                            {log.from_backlog ? (
                              <span className="inline-flex rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap">
                                Đệm offline
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground">Trực tiếp</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs max-w-[280px]">
                            {log.error ? (
                              <span className="text-destructive font-medium break-words">
                                {formatViError(log.error)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Mobile Card View (< md) */}
              <div className="block md:hidden space-y-3">
                {pagedWrites.map((log) => (
                  <div
                    key={log.id}
                    className={cn(
                      'rounded-xl border border-border p-3.5 bg-card/80 space-y-2.5 shadow-2xs',
                      log.status === 'error' && 'border-destructive/40 bg-destructive/5',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-foreground">
                        <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                        {fmtTs(log.ts)}
                      </div>
                      <StatusPill status={log.status} />
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-border/50">
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Số bản ghi</span>
                        <span className="font-semibold text-sm">{fmtNum(log.n_records)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Nguồn dữ liệu</span>
                        <span className="font-medium text-[11px]">
                          {log.from_backlog ? '📦 Đệm offline' : '⚡ Trực tiếp'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Khoảng mốc giờ</span>
                        <span className="font-mono text-[11px] block truncate">
                          {log.first_key || '--'} {log.last_key && log.last_key !== log.first_key ? `→ ${log.last_key}` : ''}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Thời lượng / HTTP</span>
                        <span className="text-[11px] text-muted-foreground">
                          {fmtDuration(log.duration_ms)} · {log.http_status ?? '--'}
                        </span>
                      </div>
                    </div>

                    {log.error && (
                      <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-2 text-xs text-destructive flex items-start gap-1.5">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span className="break-words leading-tight">{formatViError(log.error)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Phân trang điều hướng 1, 2, 3, 4... */}
              {filteredWrites.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 mt-3 border-t border-border/60 text-xs">
                  <div className="text-muted-foreground text-center sm:text-left order-2 sm:order-1">
                    Hiển thị <span className="font-semibold text-foreground">{startIndex + 1}</span>–<span className="font-semibold text-foreground">{endIndex}</span> trong số <span className="font-semibold text-foreground">{filteredWrites.length}</span> lô
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-1.5 order-1 sm:order-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 text-xs"
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      title="Trang trước"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span className="sr-only">Trang trước</span>
                    </Button>

                    {paginationPages.map((item, idx) =>
                      item === 'ellipsis' ? (
                        <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground select-none">
                          …
                        </span>
                      ) : (
                        <Button
                          key={item}
                          variant={item === safePage ? 'default' : 'outline'}
                          size="sm"
                          className={cn('h-8 min-w-[32px] px-2 text-xs font-medium', item === safePage && 'shadow-xs')}
                          onClick={() => setPage(item)}
                        >
                          {item}
                        </Button>
                      ),
                    )}

                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 text-xs"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      title="Trang sau"
                    >
                      <ChevronRight className="h-4 w-4" />
                      <span className="sr-only">Trang sau</span>
                    </Button>

                    <div className="flex items-center gap-1.5 ml-1 sm:ml-2">
                      <Select
                        value={String(pageSize)}
                        onValueChange={(v) => {
                          setPageSize(Number(v));
                          setPage(1);
                        }}
                      >
                        <SelectTrigger className="h-8 w-[105px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="10">10 / trang</SelectItem>
                          <SelectItem value="15">15 / trang</SelectItem>
                          <SelectItem value="25">25 / trang</SelectItem>
                          <SelectItem value="50">50 / trang</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}
            </LogTableShell>
          </div>
        </TabsContent>

        {/* ---- TAB 2: Đồng bộ Firebase ↔ InfluxDB ---- */}
        <TabsContent value="sync" className="space-y-4">
          <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Upload}
              label={`Firebase → InfluxDB ${dayLabel}`}
              value={fmtNum(syncStats.toInflux)}
              hint="bản ghi đẩy vào Influx"
              tone="water"
            />
            <StatCard
              icon={Database}
              label={`InfluxDB → Firebase ${dayLabel}`}
              value={fmtNum(syncStats.toFirebase)}
              hint="bản ghi bù (backfill)"
              tone="success"
            />
            <StatCard
              icon={XCircle}
              label="Số lần đồng bộ lỗi"
              value={fmtNum(syncStats.errors)}
              hint={`${fmtNum(syncStats.runs)} lượt chạy`}
              tone={syncStats.errors > 0 ? 'destructive' : 'primary'}
            />
            <StatCard
              icon={Clock}
              label="Thành công gần nhất"
              value={syncStats.lastOk !== null ? formatTimeOnlyVi(syncStats.lastOk) : '--'}
              hint={syncStats.lastOk !== null ? formatEpochMsVi(syncStats.lastOk, { day: '2-digit', month: '2-digit', year: 'numeric' }) : undefined}
              tone="primary"
            />
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
              <div>
                <h3 className="font-display text-base sm:text-lg font-bold">Lịch sử các phiên đồng bộ</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Đường dẫn: logs/sync/{dateKey} · Tối đa {LOG_LIMIT} mục gần nhất · Tự động cập nhật realtime
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Select value={directionFilter} onValueChange={(v) => setDirectionFilter(v as typeof directionFilter)}>
                  <SelectTrigger className="w-full sm:w-[190px] h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Cả hai chiều đồng bộ</SelectItem>
                    <SelectItem value="firebase_to_influx">Firebase → InfluxDB</SelectItem>
                    <SelectItem value="influx_to_firebase">InfluxDB → Firebase</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={syncFilter} onValueChange={(v) => setSyncFilter(v as StatusFilter)}>
                  <SelectTrigger className="w-full sm:w-[170px] h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả trạng thái</SelectItem>
                    <SelectItem value="ok">Thành công</SelectItem>
                    <SelectItem value="noop">Không có dữ liệu mới</SelectItem>
                    <SelectItem value="error">Gặp lỗi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <LogTableShell loading={syncLoading} error={syncError} empty={filteredSync.length === 0} dayLabel={dayLabel}>
              {/* Desktop Table View (≥ md) */}
              <div className="hidden md:block overflow-x-auto rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/40 text-xs">
                      <TableHead className="font-semibold text-foreground whitespace-nowrap py-3">Thời gian</TableHead>
                      <TableHead className="font-semibold text-foreground py-3">Chiều đồng bộ</TableHead>
                      <TableHead className="font-semibold text-foreground py-3">Trạng thái</TableHead>
                      <TableHead className="font-semibold text-foreground text-right whitespace-nowrap py-3">Số bản ghi</TableHead>
                      <TableHead className="font-semibold text-foreground whitespace-nowrap py-3">Khoảng dữ liệu</TableHead>
                      <TableHead className="font-semibold text-foreground text-right whitespace-nowrap py-3">Thời lượng</TableHead>
                      <TableHead className="font-semibold text-foreground py-3">Chi tiết / Thông báo lỗi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSync.map((log) => (
                      <TableRow key={log.id} className={cn('text-xs hover:bg-secondary/20 transition-colors', log.status === 'error' && 'bg-destructive/5')}>
                        <TableCell className="whitespace-nowrap font-mono">{fmtTs(log.ts)}</TableCell>
                        <TableCell>
                          <DirectionPill direction={log.direction} />
                        </TableCell>
                        <TableCell>
                          <StatusPill status={log.status} />
                        </TableCell>
                        <TableCell className="text-right font-semibold">{fmtNum(log.n_records)}</TableCell>
                        <TableCell className="text-[11px] font-mono whitespace-nowrap">
                          {fmtRangeValue(log.range_start)}
                          {log.range_end !== undefined && log.range_end !== null && log.range_end !== '' && (
                            <> → {fmtRangeValue(log.range_end)}</>
                          )}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap text-muted-foreground">{fmtDuration(log.duration_ms)}</TableCell>
                        <TableCell className="text-xs max-w-[280px]">
                          {log.error ? (
                            <span className="text-destructive font-medium break-words">
                              {formatViError(log.error)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Card View (< md) */}
              <div className="block md:hidden space-y-3">
                {filteredSync.map((log) => (
                  <div
                    key={log.id}
                    className={cn(
                      'rounded-xl border border-border p-3.5 bg-card/80 space-y-2.5 shadow-2xs',
                      log.status === 'error' && 'border-destructive/40 bg-destructive/5',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-foreground">
                        <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                        {fmtTs(log.ts)}
                      </div>
                      <StatusPill status={log.status} />
                    </div>

                    <div className="pt-1 border-t border-border/50 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground text-[11px]">Chiều đồng bộ:</span>
                        <DirectionPill direction={log.direction} />
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Số bản ghi</span>
                          <span className="font-semibold text-sm">{fmtNum(log.n_records)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-[11px]">Thời lượng</span>
                          <span className="text-[11px] text-muted-foreground">{fmtDuration(log.duration_ms)}</span>
                        </div>
                      </div>

                      <div>
                        <span className="text-muted-foreground block text-[11px]">Khoảng dữ liệu</span>
                        <span className="font-mono text-[11px] block truncate">
                          {fmtRangeValue(log.range_start)} {log.range_end ? `→ ${fmtRangeValue(log.range_end)}` : ''}
                        </span>
                      </div>
                    </div>

                    {log.error && (
                      <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-2 text-xs text-destructive flex items-start gap-1.5">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span className="break-words leading-tight">{formatViError(log.error)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </LogTableShell>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LogTableShell({
  loading,
  error,
  empty,
  dayLabel,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
  dayLabel: string;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="h-40 flex items-center justify-center text-muted-foreground gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span>Đang nạp dữ liệu nhật ký...</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
        <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold text-destructive">Không đọc được nhật ký từ Firebase</p>
          <p className="text-xs text-muted-foreground mt-1 break-words leading-relaxed">
            {formatViError(error)}
          </p>
        </div>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="h-40 flex flex-col items-center justify-center text-muted-foreground gap-2 text-center p-4">
        <ScrollText className="h-8 w-8 opacity-40 text-muted-foreground" />
        <span className="text-sm font-medium">Chưa ghi nhận nhật ký nào trong {dayLabel}</span>
        <span className="text-xs opacity-75">Dữ liệu sẽ tự động xuất hiện ngay khi có phiên gửi từ Jetson hoặc backend.</span>
      </div>
    );
  }
  return <div>{children}</div>;
}
