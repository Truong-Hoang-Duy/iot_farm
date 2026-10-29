import { useState, useEffect, useMemo } from 'react';
import { Thermometer, Droplets, FlaskConical, Zap, Atom, Wind, CloudOff, Clock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SensorCard } from '@/components/dashboard/SensorCard';
import SensorChart from '@/components/dashboard/SensorChart';
import { DeviceStatusCard } from '@/components/dashboard/DeviceStatusCard';
import { ForecastPanel } from '@/components/forecast/ForecastPanel';
import {
  subscribeLatestReading,
  subscribeSensorDataRange,
  subscribeStreamingConfig,
  buildRangeEndingAt,
  DEFAULT_RANGE_DAYS,
  type LatestSensorReading,
  type SensorDateRange,
  type SensorRangeResult,
  type StreamingConfig,
} from '@/services/firebaseAPI';
import { useDeviceLive, useDeviceStatus } from '@/hooks/useDeviceStatus';
import { formatEpochMsVi, formatRelativeVi, todayDateKey } from '@/lib/timeKeys';
import { cn } from '@/lib/utils';

// Default thresholds as fallback
const defaultThresholds = {
  soil_temperature: { low: 18, high: 30 },
  soil_moisture: { low: 40, high: 80 },
  soil_ph: { low: 5.5, high: 7.0 },
  soil_ec: { low: 1.0, high: 2.5 },
  nitrogen: { low: 30, high: 500 },
  phosphorus: { low: 20, high: 1200 },
  potassium: { low: 40, high: 1200 },
};

const timeQualityLabel: Record<string, string> = {
  ntp: 'Giờ NTP',
  corrected: 'Giờ đã hiệu chỉnh',
  estimated: 'Giờ ước tính',
};

export default function Dashboard() {
  const [latest, setLatest] = useState<LatestSensorReading | null>(null);
  const [latestLoaded, setLatestLoaded] = useState(false);
  const [thresholds, setThresholds] = useState(defaultThresholds);

  // Khoảng thời gian biểu đồ: preset N ngày (tính từ ngày có dữ liệu mới nhất) hoặc tùy chọn
  const [rangeDays, setRangeDays] = useState<number | null>(DEFAULT_RANGE_DAYS);
  const [customRange, setCustomRange] = useState<SensorDateRange | null>(null);
  const [chartResult, setChartResult] = useState<SensorRangeResult | null>(null);
  const [chartLoading, setChartLoading] = useState(true);

  const device = useDeviceStatus();
  const liveState = useDeviceLive(device.deviceId, device.serverNow);
  const { live, sinceLiveMs, readingNow, triggerReadNow } = liveState;

  // Bản ghi mới nhất (realtime, chỉ tải ngày mới nhất)
  useEffect(() => {
    const unsubscribe = subscribeLatestReading((value) => {
      setLatest(value);
      setLatestLoaded(true);
    });
    return unsubscribe;
  }, []);

  // Ngưỡng từ streaming config
  useEffect(() => {
    const unsubscribeConfig = subscribeStreamingConfig((config: StreamingConfig | null) => {
      if (config?.config?.threshold) {
        const t = config.config.threshold;
        setThresholds({
          soil_temperature: t.soil_temperature || defaultThresholds.soil_temperature,
          soil_moisture: t.soil_moisture || defaultThresholds.soil_moisture,
          soil_ph: t.soil_ph || defaultThresholds.soil_ph,
          soil_ec: t.soil_ec || defaultThresholds.soil_ec,
          nitrogen: t.nitrogen || defaultThresholds.nitrogen,
          phosphorus: t.phosphorus || defaultThresholds.phosphorus,
          potassium: t.potassium || defaultThresholds.potassium,
        });
      }
    });
    return unsubscribeConfig;
  }, []);

  // Ngày neo cho preset: ngày mới nhất có dữ liệu (tự dịch khi có ngày mới)
  const anchorDate = latest?.dateKey ?? (latestLoaded ? todayDateKey() : null);
  const range = useMemo<SensorDateRange | null>(() => {
    if (rangeDays === null) return customRange;
    return anchorDate ? buildRangeEndingAt(anchorDate, rangeDays) : null;
  }, [rangeDays, customRange, anchorDate]);

  const rangeStart = range?.startDate;
  const rangeEnd = range?.endDate;

  // Dữ liệu biểu đồ theo khoảng ngày (query orderByKey + startAt/endAt)
  useEffect(() => {
    if (!rangeStart || !rangeEnd) return;
    setChartLoading(true);
    const unsubscribe = subscribeSensorDataRange({ startDate: rangeStart, endDate: rangeEnd }, (result) => {
      setChartResult(result);
      setChartLoading(false);
    });
    return unsubscribe;
  }, [rangeStart, rangeEnd]);

  const handlePresetChange = (days: number) => {
    setRangeDays(days);
  };

  const handleCustomRangeChange = (r: SensorDateRange) => {
    setCustomRange(r);
    setRangeDays(null);
  };

  if (!latestLoaded) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const isLiveNewer = Boolean(
    live &&
      typeof live.updated_at === 'number' &&
      (latest?.epochMs == null || live.updated_at >= latest.epochMs),
  );
  const latestReading = isLiveNewer && live ? { ...(latest?.reading ?? {}), ...live } : (latest?.reading ?? null);

  // Calculate NPK status
  const getNPKStatus = (value: number, low: number, high: number) => {
    if (value < low) return { status: 'low', color: 'text-destructive', bg: 'bg-destructive/10' };
    if (value > high) return { status: 'high', color: 'text-warning', bg: 'bg-warning/10' };
    return { status: 'optimal', color: 'text-success', bg: 'bg-success/10' };
  };

  const nStatus = getNPKStatus(latestReading?.N ?? 0, thresholds.nitrogen.low, thresholds.nitrogen.high);
  const pStatus = getNPKStatus(latestReading?.P ?? 0, thresholds.phosphorus.low, thresholds.phosphorus.high);
  const kStatus = getNPKStatus(latestReading?.K ?? 0, thresholds.potassium.low, thresholds.potassium.high);

  const chartSection = (
    <>
      {/* Time Series Chart */}
      <SensorChart
        sensorData={chartResult?.data ?? null}
        range={range}
        rangeDays={rangeDays}
        onPresetChange={handlePresetChange}
        onCustomRangeChange={handleCustomRangeChange}
        source={chartResult?.source}
        loading={chartLoading}
      />

      {/* Dự báo (backend ML) */}
      <ForecastPanel defaultTarget="moisture" />
    </>
  );

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Theo dõi thông số môi trường thời gian thực
          </p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                device.online ? 'bg-success animate-pulse' : device.exists ? 'bg-destructive' : 'bg-muted-foreground',
              )}
            />
            <span>Jetson: {device.online ? 'Trực tuyến' : device.exists ? 'Ngoại tuyến' : 'Chưa kết nối'}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!device.online || readingNow}
              onClick={() => void triggerReadNow()}
              title={
                device.online
                  ? 'Yêu cầu Jetson đọc cảm biến ngay lập tức (không làm bẩn bảng lịch sử /data)'
                  : 'Cần Jetson trực tuyến để đọc cảm biến tức thời'
              }
              className="h-7 px-2.5 text-xs gap-1.5"
            >
              <RefreshCw className={cn('h-3 w-3', readingNow && 'animate-spin')} />
              {readingNow ? 'Đang đọc...' : 'Đọc ngay'}
            </Button>
          </div>
          {isLiveNewer && live?.updated_at && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-success/10 text-success border border-success/20 px-2 py-0.5 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Live trực tiếp: {sinceLiveMs !== null ? formatRelativeVi(sinceLiveMs) : formatEpochMsVi(live.updated_at)}
              </span>
              <span>({formatEpochMsVi(live.updated_at)})</span>
            </div>
          )}
          {latest && (
            <div className="flex items-center gap-2 flex-wrap">
              <Clock className="h-3.5 w-3.5" />
              Bản ghi lịch sử: {latest.epochMs !== null ? formatEpochMsVi(latest.epochMs) : latest.timestamp}
              {latest.reading.tq && latest.reading.tq !== 'ntp' && (
                <span className="rounded-full bg-warning/10 text-warning px-2 py-0.5 text-xs font-medium">
                  {timeQualityLabel[latest.reading.tq] ?? latest.reading.tq}
                </span>
              )}
              {latest.source === 'local' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 text-warning px-2 py-0.5 text-xs font-medium">
                  <CloudOff className="h-3 w-3" /> Dữ liệu cục bộ
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Device status */}
      <DeviceStatusCard liveState={liveState} />

      {!latestReading ? (
        <>
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-muted-foreground">
            Chưa có dữ liệu cảm biến trên Firebase. Dữ liệu sẽ xuất hiện khi Jetson gửi bản ghi đầu tiên.
          </div>
          {chartSection}
        </>
      ) : (
        <>
          {/* Main Sensors */}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <SensorCard
              title="Nhiệt độ đất"
              value={Number((latestReading.soiltemp ?? 0).toFixed(1))}
              unit="°C"
              icon={Thermometer}
              color="warning"
              min={thresholds.soil_temperature.low}
              max={thresholds.soil_temperature.high}
            />
            <SensorCard
              title="Độ ẩm đất"
              value={Number((latestReading.moisture ?? 0).toFixed(0))}
              unit="%"
              icon={Droplets}
              color="water"
              min={thresholds.soil_moisture.low}
              max={thresholds.soil_moisture.high}
            />
            <SensorCard
              title="Độ pH"
              value={Number((latestReading.pH ?? 0).toFixed(1))}
              unit=""
              icon={FlaskConical}
              color="accent"
              min={thresholds.soil_ph.low}
              max={thresholds.soil_ph.high}
            />
            <SensorCard
              title="Độ mặn EC"
              value={Number((latestReading.EC ?? 0).toFixed(2))}
              unit="mS/cm"
              icon={Zap}
              color="soil"
              min={thresholds.soil_ec.low}
              max={thresholds.soil_ec.high}
            />
          </div>

          {/* Environment Sensors */}
          <div className="grid gap-6 sm:grid-cols-2">
            <SensorCard
              title="Nhiệt độ không khí"
              value={Number((latestReading.temperature ?? 0).toFixed(1))}
              unit="°C"
              icon={Thermometer}
              color="primary"
            />
            <SensorCard
              title="Độ ẩm không khí"
              value={Number((latestReading.humidity ?? 0).toFixed(1))}
              unit="%"
              icon={Wind}
              color="water"
            />
          </div>

          {/* NPK Section - Redesigned Compact */}
          <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
            <h2 className="font-display text-lg sm:text-xl font-semibold mb-4 flex items-center gap-2">
              <Atom className="h-5 w-5 text-nutrient" />
              Dinh dưỡng NPK
            </h2>

            {/* Compact NPK Cards with inline gauge */}
            <div className="grid gap-4 sm:grid-cols-3">
              {/* Nitrogen */}
              <div className={`rounded-xl border p-4 ${nStatus.bg} border-blue-500/20`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                      <span className="font-bold text-blue-600">N</span>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Đạm</p>
                      <p className="font-display text-xl font-bold">{latestReading.N ?? 0}</p>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">ppm</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Ngưỡng: {thresholds.nitrogen.low} - {thresholds.nitrogen.high}</span>
                    <span className={`font-medium ${nStatus.color}`}>
                      {nStatus.status === 'optimal' ? '✓ Tốt' : nStatus.status === 'low' ? '↓ Thấp' : '↑ Cao'}
                    </span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, ((latestReading.N ?? 0) / thresholds.nitrogen.high) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Phosphorus */}
              <div className={`rounded-xl border p-4 ${pStatus.bg} border-orange-500/20`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
                      <span className="font-bold text-orange-600">P</span>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Lân</p>
                      <p className="font-display text-xl font-bold">{latestReading.P ?? 0}</p>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">ppm</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Ngưỡng: {thresholds.phosphorus.low} - {thresholds.phosphorus.high}</span>
                    <span className={`font-medium ${pStatus.color}`}>
                      {pStatus.status === 'optimal' ? '✓ Tốt' : pStatus.status === 'low' ? '↓ Thấp' : '↑ Cao'}
                    </span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, ((latestReading.P ?? 0) / thresholds.phosphorus.high) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Potassium */}
              <div className={`rounded-xl border p-4 ${kStatus.bg} border-purple-500/20`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                      <span className="font-bold text-purple-600">K</span>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Kali</p>
                      <p className="font-display text-xl font-bold">{latestReading.K ?? 0}</p>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">ppm</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Ngưỡng: {thresholds.potassium.low} - {thresholds.potassium.high}</span>
                    <span className={`font-medium ${kStatus.color}`}>
                      {kStatus.status === 'optimal' ? '✓ Tốt' : kStatus.status === 'low' ? '↓ Thấp' : '↑ Cao'}
                    </span>
                  </div>
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, ((latestReading.K ?? 0) / thresholds.potassium.high) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {chartSection}
        </>
      )}
    </div>
  );
}
