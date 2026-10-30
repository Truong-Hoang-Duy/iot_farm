import type { ReactNode } from 'react';
import {
  Cpu,
  Wifi,
  WifiOff,
  Clock,
  Database,
  Thermometer,
  Timer,
  Server,
  AlertTriangle,
  Activity,
  FlaskConical,
  Droplets,
  PlugZap,
  RefreshCw,
  Wind,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDeviceLive, useDeviceStatus, type DeviceLiveState } from '@/hooks/useDeviceStatus';
import { offlineThresholdMs, type SensorHealth } from '@/services/deviceAPI';
import { formatDurationVi, formatEpochMsVi, formatIntervalVi, formatRelativeVi } from '@/lib/timeKeys';

interface DeviceStatusCardProps {
  deviceId?: string;
  className?: string;
  liveState?: DeviceLiveState;
}

const liveSourceLabel: Record<string, string> = {
  manual: 'Đọc theo yêu cầu',
  heartbeat: 'Tự động ~15s',
  sample: 'Chu kỳ lưu mẫu',
};

const sensorHealthConfig: Record<SensorHealth, { label: string; className: string }> = {
  ok: { label: 'Hoạt động', className: 'bg-success/10 text-success border-success/20' },
  error: { label: 'Lỗi', className: 'bg-destructive/10 text-destructive border-destructive/20' },
  simulated: { label: 'Mô phỏng', className: 'bg-accent/10 text-accent border-accent/20' },
};

function SensorHealthBadge({ value, isOnline = true }: { value?: string; isOnline?: boolean }) {
  if (!isOnline) {
    return (
      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium bg-destructive/10 text-destructive border-destructive/20">
        Ngoại tuyến
      </span>
    );
  }
  const config = value && value in sensorHealthConfig ? sensorHealthConfig[value as SensorHealth] : null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        config ? config.className : 'bg-secondary text-muted-foreground border-border',
      )}
    >
      {config ? config.label : value || 'Không rõ'}
    </span>
  );
}

function InfoItem({ icon: Icon, label, children }: { icon: typeof Cpu; label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-secondary/40 p-3 min-w-0">
      <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </p>
      <div className="text-sm font-semibold truncate">{children}</div>
    </div>
  );
}

export function DeviceStatusCard({ deviceId, className, liveState }: DeviceStatusCardProps) {
  const { status, loaded, exists, online, serverNow, sinceLastSeenMs, error, deviceId: id } = useDeviceStatus(deviceId);
  const internalLive = useDeviceLive(id, serverNow);
  const { live, sinceLiveMs, readingNow, triggerReadNow } = liveState ?? internalLive;

  const wrapper = cn('rounded-2xl border border-border bg-card p-4 sm:p-6', className);

  if (!loaded) {
    return (
      <div className={wrapper}>
        <div className="flex items-center gap-3 animate-pulse">
          <div className="h-10 w-10 rounded-xl bg-secondary" />
          <div className="space-y-2 flex-1">
            <div className="h-4 w-48 rounded bg-secondary" />
            <div className="h-3 w-32 rounded bg-secondary" />
          </div>
        </div>
      </div>
    );
  }

  if (!exists || !status) {
    return (
      <div className={wrapper}>
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-secondary flex items-center justify-center shrink-0">
            <PlugZap className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold">Chưa có thiết bị kết nối</h3>
            <p className="text-sm text-muted-foreground">
              {error
                ? `Không đọc được trạng thái thiết bị: ${error}`
                : `Chưa nhận được heartbeat từ "${id}". Hãy khởi động farm-agent trên Jetson Nano.`}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const lastSeen = typeof status.last_seen === 'number' ? status.last_seen : null;
  const thresholdSec = Math.round(offlineThresholdMs(status) / 1000);
  const offsetMs = typeof status.clock_offset_ms === 'number' ? status.clock_offset_ms : null;

  return (
    <div className={cn(wrapper, !online && 'border-destructive/30')}>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              'h-12 w-12 rounded-xl flex items-center justify-center shrink-0',
              online ? 'bg-success/15 text-success' : 'bg-destructive/10 text-destructive',
            )}
          >
            <Cpu className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-lg sm:text-xl font-semibold truncate">Thiết bị biên – Jetson Nano</h3>
            <p className="text-xs text-muted-foreground truncate">
              {id}
              {status.fw_version ? ` · firmware ${status.fw_version}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!online || readingNow}
            onClick={() => void triggerReadNow()}
            title={online ? 'Yêu cầu Jetson đọc cảm biến ngay (không làm bẩn lịch sử /data)' : 'Cần Jetson trực tuyến để đọc tức thời'}
            className="h-8 gap-1.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', readingNow && 'animate-spin')} />
            {readingNow ? 'Đang đọc...' : 'Đọc ngay'}
          </Button>
          {status.simulate && (
            <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
              Chế độ mô phỏng
            </span>
          )}
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium',
              online
                ? 'bg-success/10 text-success border-success/20'
                : 'bg-destructive/10 text-destructive border-destructive/20',
            )}
          >
            <span className={cn('mr-2 h-2 w-2 rounded-full', online ? 'bg-success animate-pulse' : 'bg-destructive')} />
            {online ? 'Trực tuyến' : 'Ngoại tuyến'}
          </span>
        </div>
      </div>

      <p className="text-sm text-muted-foreground mb-4 flex items-center gap-1.5 flex-wrap">
        <Clock className="h-4 w-4" />
        Lần cuối liên lạc:{' '}
        <span className="font-medium text-foreground">
          {sinceLastSeenMs !== null ? formatRelativeVi(sinceLastSeenMs) : '--'}
        </span>
        {lastSeen !== null && <span>({formatEpochMsVi(lastSeen)})</span>}
        {!online && (
          <span className="text-destructive font-medium">
            {status.online === false
              ? '· Thiết bị đã ngắt kết nối / dừng hoạt động'
              : `· Ngoại tuyến do quá ${thresholdSec} giây không có heartbeat`}
          </span>
        )}
      </p>

      <div className={cn('grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5', !online && 'opacity-85')}>
        <InfoItem icon={Server} label="Hostname / IP">
          {status.hostname || '--'}
          <span className="block text-xs font-normal text-muted-foreground truncate">{status.ip || '--'}</span>
        </InfoItem>
        <InfoItem icon={Timer} label="Chu kỳ lấy mẫu">
          {formatIntervalVi(status.interval_sec)}
          <span className="block text-xs font-normal text-muted-foreground">
            Heartbeat {formatIntervalVi(status.heartbeat_sec)}
          </span>
        </InfoItem>
        <InfoItem icon={Database} label="Hàng đợi offline">
          <span className={cn((status.queue_pending ?? 0) > 0 && 'text-warning')}>
            {typeof status.queue_pending === 'number' ? `${status.queue_pending} bản ghi` : '--'}
          </span>
          <span className="block text-xs font-normal text-muted-foreground">
            {!online ? 'lưu cục bộ trên thiết bị' : 'chờ gửi lên Firebase'}
          </span>
        </InfoItem>
        <InfoItem icon={Clock} label="Đồng bộ giờ NTP">
          <span className={!online ? 'text-destructive' : status.ntp_synced ? 'text-success' : 'text-warning'}>
            {!online
              ? 'Mất đồng bộ'
              : status.ntp_synced === undefined
              ? '--'
              : status.ntp_synced
              ? 'Đã đồng bộ'
              : 'Chưa đồng bộ'}
          </span>
          <span className="block text-xs font-normal text-muted-foreground">
            {!online
              ? (offsetMs !== null ? `Lệch trước đó: ${offsetMs.toFixed(0)} ms` : 'Ngoại tuyến')
              : (offsetMs !== null ? `Lệch: ${offsetMs.toFixed(0)} ms` : '--')}
          </span>
        </InfoItem>
        <InfoItem icon={!online || status.network_ok === false ? WifiOff : Wifi} label="Mạng">
          <span className={!online || status.network_ok === false ? 'text-destructive' : 'text-success'}>
            {!online
              ? 'Mất kết nối'
              : status.network_ok === undefined
              ? '--'
              : status.network_ok
              ? 'Kết nối tốt'
              : 'Mất kết nối'}
          </span>
          {!online && (
            <span className="block text-xs font-normal text-muted-foreground">Thiết bị ngoại tuyến</span>
          )}
        </InfoItem>
        <InfoItem icon={FlaskConical} label="Cảm biến đất (CWT 7in1)">
          <SensorHealthBadge value={status.sensors?.soil} isOnline={online} />
          {!online && status.sensors?.soil && (
            <span className="block text-xs font-normal text-muted-foreground">
              (Trước đó: {sensorHealthConfig[status.sensors.soil as SensorHealth]?.label ?? status.sensors.soil})
            </span>
          )}
        </InfoItem>
        <InfoItem icon={Droplets} label="Cảm biến DHT20">
          <SensorHealthBadge value={status.sensors?.dht20} isOnline={online} />
          {!online && status.sensors?.dht20 && (
            <span className="block text-xs font-normal text-muted-foreground">
              (Trước đó: {sensorHealthConfig[status.sensors.dht20 as SensorHealth]?.label ?? status.sensors.dht20})
            </span>
          )}
        </InfoItem>
        <InfoItem icon={Thermometer} label="Nhiệt độ CPU">
          <span className={cn((status.cpu_temp_c ?? 0) >= 70 && 'text-destructive')}>
            {typeof status.cpu_temp_c === 'number' ? `${status.cpu_temp_c.toFixed(1)} °C` : '--'}
          </span>
          {!online && typeof status.cpu_temp_c === 'number' && (
            <span className="block text-xs font-normal text-muted-foreground">(khi ngắt)</span>
          )}
        </InfoItem>
        <InfoItem icon={Activity} label="Thời gian chạy">
          {typeof status.uptime_s === 'number' ? formatDurationVi(status.uptime_s) : '--'}
          {!online && typeof status.uptime_s === 'number' && (
            <span className="block text-xs font-normal text-muted-foreground">(khi ngắt)</span>
          )}
        </InfoItem>
        <InfoItem icon={Clock} label="Giờ trên thiết bị">
          {typeof status.device_time === 'number' ? formatEpochMsVi(status.device_time * 1000) : '--'}
          {!online && typeof status.device_time === 'number' && (
            <span className="block text-xs font-normal text-muted-foreground">(thời điểm ngắt)</span>
          )}
        </InfoItem>
      </div>

      {live && (
        <div
          className={cn(
            'mt-4 rounded-xl border p-3 transition-colors',
            online
              ? 'border-primary/20 bg-primary/5'
              : 'border-destructive/20 bg-destructive/5 opacity-85',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground mb-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 font-medium',
                online ? 'text-primary' : 'text-destructive',
              )}
            >
              <Wind className="h-3.5 w-3.5" />
              Thông số trực tiếp từ mạch {online ? '(Live)' : '(Tạm dừng – Thiết bị ngoại tuyến)'}
            </span>
            <div className="flex items-center gap-2">
              {!online && (
                <span className="inline-flex items-center rounded-full bg-destructive/10 text-destructive border border-destructive/20 px-2 py-0.5 text-[11px] font-medium">
                  Dữ liệu đo lần cuối
                </span>
              )}
              <span>
                {online && live.source ? `${liveSourceLabel[live.source] ?? live.source} · ` : ''}
                {sinceLiveMs !== null ? formatRelativeVi(sinceLiveMs) : '--'}
                {typeof live.updated_at === 'number' ? ` (${formatEpochMsVi(live.updated_at)})` : ''}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-sm">
            <div className="rounded-lg bg-background/80 px-2.5 py-1.5">
              <span className="text-xs text-muted-foreground block">Nhiệt độ KK</span>
              <span className={cn('font-semibold', !online && 'text-muted-foreground')}>
                {typeof live.temperature === 'number' ? `${live.temperature.toFixed(1)} °C` : '--'}
              </span>
            </div>
            <div className="rounded-lg bg-background/80 px-2.5 py-1.5">
              <span className="text-xs text-muted-foreground block">Độ ẩm KK</span>
              <span className={cn('font-semibold', !online && 'text-muted-foreground')}>
                {typeof live.humidity === 'number' ? `${live.humidity.toFixed(1)} %` : '--'}
              </span>
            </div>
            <div className="rounded-lg bg-background/80 px-2.5 py-1.5">
              <span className="text-xs text-muted-foreground block">Nhiệt độ đất</span>
              <span className={cn('font-semibold', !online && 'text-muted-foreground')}>
                {typeof live.soiltemp === 'number' ? `${live.soiltemp.toFixed(1)} °C` : '--'}
              </span>
            </div>
            <div className="rounded-lg bg-background/80 px-2.5 py-1.5">
              <span className="text-xs text-muted-foreground block">Độ ẩm đất</span>
              <span className={cn('font-semibold', !online && 'text-muted-foreground')}>
                {typeof live.moisture === 'number' ? `${live.moisture.toFixed(1)} %` : '--'}
              </span>
            </div>
            <div className="rounded-lg bg-background/80 px-2.5 py-1.5">
              <span className="text-xs text-muted-foreground block">Độ pH</span>
              <span className={cn('font-semibold', !online && 'text-muted-foreground')}>
                {typeof live.pH === 'number' ? live.pH.toFixed(2) : '--'}
              </span>
            </div>
            <div className="rounded-lg bg-background/80 px-2.5 py-1.5">
              <span className="text-xs text-muted-foreground block">EC / N-P-K</span>
              <span className={cn('font-semibold', !online && 'text-muted-foreground')}>
                {typeof live.EC === 'number' ? `${live.EC.toFixed(2)} mS` : '--'}
              </span>
            </div>
          </div>
        </div>
      )}

      {status.last_error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-medium text-destructive">Lỗi gần nhất</p>
            <p className="text-muted-foreground break-words">{status.last_error}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default DeviceStatusCard;
