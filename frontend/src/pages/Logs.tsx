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
  Database,
  Clock,
  ServerOff,
  Loader2,
  Layers,
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
  todayDateKey,
} from '@/lib/timeKeys';

type StatusFilter = 'all' | 'ok' | 'error' | 'noop';

// ---------- Small presentational helpers ----------

const statusConfig: Record<string, { label: string; className: string }> = {
  ok: { label: 'Thành công', className: 'bg-success/10 text-success border-success/20' },
  error: { label: 'Lỗi', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  noop: { label: 'Không có dữ liệu mới', className: 'bg-secondary text-muted-foreground border-border' },
};

function StatusPill({ status }: { status?: string }) {
  const cfg = (status && statusConfig[status]) || {
    label: status || '--',
    className: 'bg-secondary text-muted-foreground border-border',
  };
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', cfg.className)}>
      {cfg.label}
    </span>
  );
}

const directionConfig: Record<string, { label: string; className: string }> = {
  firebase_to_influx: { label: 'Firebase → InfluxDB', className: 'bg-water/10 text-water border-water/20' },
  influx_to_firebase: { label: 'InfluxDB → Firebase', className: 'bg-accent/10 text-accent border-accent/20' },
};

function DirectionPill({ direction }: { direction?: string }) {
  const cfg = (direction && directionConfig[direction]) || {
    label: direction || '--',
    className: 'bg-secondary text-muted-foreground border-border',
  };
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', cfg.className)}>
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
    success: 'text-success bg-success/10',
    destructive: 'text-destructive bg-destructive/10',
    warning: 'text-warning bg-warning/10',
    water: 'text-water bg-water/10',
  };
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="font-display text-xl sm:text-2xl font-bold truncate">{value}</p>
          {hint && <p className="text-xs text-muted-foreground mt-0.5 truncate">{hint}</p>}
        </div>
        <div className={cn('rounded-lg p-2 shrink-0', toneClass[tone])}>
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

/** Hiển thị JSON bất kỳ của /api/sync/status dưới dạng key–value. */
function KeyValueView({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null || data === undefined) return <span className="text-muted-foreground">--</span>;
  if (typeof data !== 'object') {
    if (typeof data === 'boolean') {
      return <span className={data ? 'text-success' : 'text-destructive'}>{data ? 'Có' : 'Không'}</span>;
    }
    return <span className="break-all">{String(data)}</span>;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-muted-foreground">[]</span>;
    if (depth >= 2) return <code className="text-xs break-all">{JSON.stringify(data)}</code>;
    return (
      <div className="space-y-1">
        {data.slice(0, 10).map((item, i) => (
          <div key={i} className="rounded-md bg-background/60 p-2">
            <KeyValueView data={item} depth={depth + 1} />
          </div>
        ))}
        {data.length > 10 && <p className="text-xs text-muted-foreground">… và {data.length - 10} mục khác</p>}
      </div>
    );
  }
  const entries = Object.entries(data as Record<string, unknown>);
  if (depth >= 2) return <code className="text-xs break-all">{JSON.stringify(data)}</code>;
  return (
    <dl className={cn('grid gap-x-4 gap-y-1.5', depth === 0 ? 'sm:grid-cols-2' : 'grid-cols-1')}>
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0 text-sm">
          <dt className="text-xs text-muted-foreground">{key}</dt>
          <dd className="font-medium min-w-0">
            <KeyValueView data={value} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- Page ----------

export default function LogsPage() {
  const { toast } = useToast();
  const [dateKey, setDateKey] = useState<string>(todayDateKey());
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const [writeLogs, setWriteLogs] = useState<FirebaseWriteLog[]>([]);
  const [writeLoading, setWriteLoading] = useState(true);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writeFilter, setWriteFilter] = useState<StatusFilter>('all');

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

  // Realtime logs theo ngày
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
        result && typeof result === 'object' && 'message' in result ? String(result.message) : 'Đã gửi yêu cầu đồng bộ 2 chiều.';
      toast({ title: 'Đồng bộ thành công', description: summary });
      loadBackendStatus();
    } catch (error) {
      toast({
        title: 'Không thể chạy đồng bộ',
        description:
          error instanceof BackendUnavailableError
            ? 'Backend (FastAPI :8000) chưa chạy hoặc không truy cập được.'
            : (error as Error)?.message ?? String(error),
        variant: 'destructive',
      });
    } finally {
      setIsRunningSync(false);
    }
  };

  // ----- Summary stats -----
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

  const filteredWrites = useMemo(
    () => (writeFilter === 'all' ? writeLogs : writeLogs.filter((l) => l.status === writeFilter)),
    [writeLogs, writeFilter],
  );
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
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold flex items-center gap-3">
            <ScrollText className="h-7 w-7 text-primary" />
            Nhật ký đồng bộ
          </h1>
          <p className="text-muted-foreground mt-1">
            Theo dõi các lô dữ liệu Jetson ghi lên Firebase và quá trình đồng bộ Firebase ↔ InfluxDB
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-2 min-w-[150px] justify-start">
                <CalendarIcon className="h-4 w-4 text-primary" />
                {formatDateKeyVi(dateKey)}
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
            <Button variant="ghost" size="sm" onClick={() => setDateKey(todayDateKey())}>
              Hôm nay
            </Button>
          )}
        </div>
      </div>

      {/* Backend sync status */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h3 className="font-display text-lg sm:text-xl font-semibold flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-accent" />
            Trạng thái đồng bộ (Backend)
          </h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => loadBackendStatus()}
              disabled={backendState === 'loading'}
            >
              <RefreshCw className={cn('h-4 w-4', backendState === 'loading' && 'animate-spin')} />
              Làm mới
            </Button>
            <Button size="sm" className="gap-2" onClick={handleRunSync} disabled={isRunningSync}>
              {isRunningSync ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              {isRunningSync ? 'Đang đồng bộ…' : 'Chạy đồng bộ ngay'}
            </Button>
          </div>
        </div>

        {backendState === 'loading' && !backendStatus && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Đang kết nối backend…
          </p>
        )}
        {backendState === 'down' && (
          <div className="flex items-start gap-3 rounded-xl bg-secondary/50 p-4 text-sm">
            <ServerOff className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <p className="font-medium">Không kết nối được backend</p>
              <p className="text-muted-foreground">
                FastAPI (cổng 8000) chưa chạy. Nhật ký bên dưới vẫn được đọc trực tiếp từ Firebase.
              </p>
            </div>
          </div>
        )}
        {backendState === 'error' && (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
            <XCircle className="h-5 w-5 text-destructive shrink-0" />
            <div className="min-w-0">
              <p className="font-medium text-destructive">Backend trả về lỗi</p>
              <p className="text-muted-foreground break-words">{backendError}</p>
            </div>
          </div>
        )}
        {backendStatus && (
          <div className="rounded-xl bg-secondary/40 p-4">
            <KeyValueView data={backendStatus} />
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="writes" className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="writes" className="gap-2">
            <Upload className="h-4 w-4" />
            Ghi lên Firebase (Jetson)
          </TabsTrigger>
          <TabsTrigger value="sync" className="gap-2">
            <ArrowLeftRight className="h-4 w-4" />
            Đồng bộ Firebase ↔ InfluxDB
          </TabsTrigger>
        </TabsList>

        {/* ---- Firebase writes ---- */}
        <TabsContent value="writes" className="space-y-4">
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Database}
              label={`Bản ghi đã ghi ${dayLabel}`}
              value={fmtNum(writeStats.totalRecords)}
              hint={`${fmtNum(writeStats.batches)} lô · ${fmtNum(writeStats.backlog)} từ backlog`}
              tone="success"
            />
            <StatCard
              icon={XCircle}
              label="Số lô lỗi"
              value={fmtNum(writeStats.errors)}
              tone={writeStats.errors > 0 ? 'destructive' : 'primary'}
            />
            <StatCard
              icon={CheckCircle2}
              label="Lần thành công gần nhất"
              value={writeStats.lastOk !== null ? formatTimeOnlyVi(writeStats.lastOk) : '--'}
              hint={writeStats.lastOk !== null ? formatEpochMsVi(writeStats.lastOk, { day: '2-digit', month: '2-digit', year: 'numeric' }) : undefined}
              tone="water"
            />
            <StatCard
              icon={Layers}
              label="Hàng đợi (lô mới nhất)"
              value={writeStats.latest ? fmtNum(writeStats.latest.queue_pending) : '--'}
              hint="bản ghi chờ gửi trên Jetson"
              tone={(writeStats.latest?.queue_pending ?? 0) > 0 ? 'warning' : 'primary'}
            />
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
              <div>
                <h3 className="font-display text-lg font-semibold">Lô upload từ Jetson</h3>
                <p className="text-xs text-muted-foreground">
                  logs/firebase_writes/{dateKey} · tối đa {LOG_LIMIT} mục gần nhất · cập nhật realtime
                </p>
              </div>
              <Select value={writeFilter} onValueChange={(v) => setWriteFilter(v as StatusFilter)}>
                <SelectTrigger className="w-[180px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả trạng thái</SelectItem>
                  <SelectItem value="ok">Thành công</SelectItem>
                  <SelectItem value="error">Lỗi</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <LogTableShell loading={writeLoading} error={writeError} empty={filteredWrites.length === 0} dayLabel={dayLabel}>
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary/10">
                    <TableHead className="font-semibold text-primary whitespace-nowrap">Thời gian</TableHead>
                    <TableHead className="font-semibold text-primary">Trạng thái</TableHead>
                    <TableHead className="font-semibold text-primary text-right whitespace-nowrap">Số bản ghi</TableHead>
                    <TableHead className="font-semibold text-primary whitespace-nowrap">Khoảng key</TableHead>
                    <TableHead className="font-semibold text-primary text-right">HTTP</TableHead>
                    <TableHead className="font-semibold text-primary text-right whitespace-nowrap">Thời lượng</TableHead>
                    <TableHead className="font-semibold text-primary text-right whitespace-nowrap">Hàng đợi</TableHead>
                    <TableHead className="font-semibold text-primary whitespace-nowrap">Backlog</TableHead>
                    <TableHead className="font-semibold text-primary">Lỗi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredWrites.map((log) => (
                    <TableRow key={log.id} className={cn(log.status === 'error' && 'bg-destructive/5')}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{fmtTs(log.ts)}</TableCell>
                      <TableCell>
                        <StatusPill status={log.status} />
                      </TableCell>
                      <TableCell className="text-right font-medium">{fmtNum(log.n_records)}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {log.first_key || '--'}
                        {log.last_key && log.last_key !== log.first_key ? ` → ${log.last_key}` : ''}
                      </TableCell>
                      <TableCell className="text-right text-xs">{log.http_status ?? '--'}</TableCell>
                      <TableCell className="text-right text-xs whitespace-nowrap">{fmtDuration(log.duration_ms)}</TableCell>
                      <TableCell className="text-right text-xs">{fmtNum(log.queue_pending)}</TableCell>
                      <TableCell>
                        {log.from_backlog ? (
                          <span className="inline-flex rounded-full bg-warning/10 text-warning border border-warning/20 px-2 py-0.5 text-xs font-medium whitespace-nowrap">
                            Backlog
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Trực tiếp</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-destructive max-w-[280px] break-words">{log.error || ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </LogTableShell>
          </div>
        </TabsContent>

        {/* ---- Sync logs ---- */}
        <TabsContent value="sync" className="space-y-4">
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <StatCard
              icon={Upload}
              label={`Firebase → InfluxDB ${dayLabel}`}
              value={fmtNum(syncStats.toInflux)}
              hint="bản ghi"
              tone="water"
            />
            <StatCard
              icon={Database}
              label={`InfluxDB → Firebase ${dayLabel}`}
              value={fmtNum(syncStats.toFirebase)}
              hint="bản ghi (backfill)"
              tone="success"
            />
            <StatCard
              icon={XCircle}
              label="Số lần lỗi"
              value={fmtNum(syncStats.errors)}
              hint={`${fmtNum(syncStats.runs)} lần chạy`}
              tone={syncStats.errors > 0 ? 'destructive' : 'primary'}
            />
            <StatCard
              icon={Clock}
              label="Lần thành công gần nhất"
              value={syncStats.lastOk !== null ? formatTimeOnlyVi(syncStats.lastOk) : '--'}
              hint={syncStats.lastOk !== null ? formatEpochMsVi(syncStats.lastOk, { day: '2-digit', month: '2-digit', year: 'numeric' }) : undefined}
              tone="primary"
            />
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
              <div>
                <h3 className="font-display text-lg font-semibold">Lịch sử đồng bộ</h3>
                <p className="text-xs text-muted-foreground">
                  logs/sync/{dateKey} · tối đa {LOG_LIMIT} mục gần nhất · cập nhật realtime
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Select value={directionFilter} onValueChange={(v) => setDirectionFilter(v as typeof directionFilter)}>
                  <SelectTrigger className="w-[190px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Cả hai chiều</SelectItem>
                    <SelectItem value="firebase_to_influx">Firebase → InfluxDB</SelectItem>
                    <SelectItem value="influx_to_firebase">InfluxDB → Firebase</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={syncFilter} onValueChange={(v) => setSyncFilter(v as StatusFilter)}>
                  <SelectTrigger className="w-[170px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả trạng thái</SelectItem>
                    <SelectItem value="ok">Thành công</SelectItem>
                    <SelectItem value="noop">Không có dữ liệu mới</SelectItem>
                    <SelectItem value="error">Lỗi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <LogTableShell loading={syncLoading} error={syncError} empty={filteredSync.length === 0} dayLabel={dayLabel}>
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary/10">
                    <TableHead className="font-semibold text-primary whitespace-nowrap">Thời gian</TableHead>
                    <TableHead className="font-semibold text-primary">Chiều</TableHead>
                    <TableHead className="font-semibold text-primary">Trạng thái</TableHead>
                    <TableHead className="font-semibold text-primary text-right whitespace-nowrap">Số bản ghi</TableHead>
                    <TableHead className="font-semibold text-primary whitespace-nowrap">Khoảng dữ liệu</TableHead>
                    <TableHead className="font-semibold text-primary text-right whitespace-nowrap">Thời lượng</TableHead>
                    <TableHead className="font-semibold text-primary">Lỗi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSync.map((log) => (
                    <TableRow key={log.id} className={cn(log.status === 'error' && 'bg-destructive/5')}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{fmtTs(log.ts)}</TableCell>
                      <TableCell>
                        <DirectionPill direction={log.direction} />
                      </TableCell>
                      <TableCell>
                        <StatusPill status={log.status} />
                      </TableCell>
                      <TableCell className="text-right font-medium">{fmtNum(log.n_records)}</TableCell>
                      <TableCell className="text-xs font-mono">
                        {fmtRangeValue(log.range_start)}
                        {log.range_end !== undefined && log.range_end !== null && log.range_end !== '' && (
                          <> → {fmtRangeValue(log.range_end)}</>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs whitespace-nowrap">{fmtDuration(log.duration_ms)}</TableCell>
                      <TableCell className="text-xs text-destructive max-w-[280px] break-words">{log.error || ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
      <div className="h-40 flex items-center justify-center text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Đang tải nhật ký…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
        <XCircle className="h-5 w-5 text-destructive shrink-0" />
        <div className="min-w-0">
          <p className="font-medium text-destructive">Không đọc được nhật ký từ Firebase</p>
          <p className="text-muted-foreground break-words">{error}</p>
        </div>
      </div>
    );
  }
  if (empty) {
    return (
      <div className="h-40 flex flex-col items-center justify-center text-muted-foreground gap-2">
        <ScrollText className="h-8 w-8 opacity-50" />
        <span>Không có nhật ký nào {dayLabel}</span>
      </div>
    );
  }
  return <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">{children}</div>;
}
