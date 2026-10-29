import { useEffect, useMemo, useState } from 'react';
import { Download, CalendarDays, Database, CloudOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  flattenSensorData,
  type FirebaseSensorData,
  type FirebaseSensorReading,
  type SensorDataSource,
  type SensorDateRange,
} from '@/services/firebaseAPI';
import {
  dateKeyToLocalDate,
  diffDateKeys,
  formatDateKeyVi,
  formatEpochMsVi,
  localDateToDateKey,
  todayDateKey,
} from '@/lib/timeKeys';
import * as XLSX from 'xlsx';

const RANGE_PRESET_DAYS = [1, 3, 7, 30] as const;
const MAX_CUSTOM_RANGE_DAYS = 92;
/** Số điểm tối đa vẽ trên biểu đồ (gộp trung bình theo nhóm nếu nhiều hơn). */
const MAX_CHART_POINTS = 1500;

interface SensorChartProps {
  sensorData?: FirebaseSensorData | null;
  /** Khoảng ngày đang hiển thị */
  range?: SensorDateRange | null;
  /** Preset đang chọn (số ngày) hoặc null nếu là khoảng tùy chọn */
  rangeDays?: number | null;
  onPresetChange?: (days: number) => void;
  onCustomRangeChange?: (range: SensorDateRange) => void;
  source?: SensorDataSource;
  loading?: boolean;
}

type SensorKey = 'moisture' | 'soiltemp' | 'pH' | 'EC' | 'N' | 'P' | 'K' | 'temperature' | 'humidity';

const SENSOR_COLORS: Record<SensorKey, string> = {
  moisture: 'hsl(200, 85%, 55%)',
  soiltemp: 'hsl(38, 92%, 50%)',
  pH: 'hsl(195, 85%, 50%)',
  EC: 'hsl(30, 60%, 45%)',
  N: 'hsl(280, 70%, 55%)',
  P: 'hsl(152, 76%, 45%)',
  K: 'hsl(195, 85%, 50%)',
  temperature: 'hsl(0, 70%, 55%)',
  humidity: 'hsl(220, 70%, 55%)',
};

const SENSOR_LABELS: Record<SensorKey, string> = {
  moisture: 'Độ ẩm đất (%)',
  soiltemp: 'Nhiệt độ đất (°C)',
  pH: 'pH',
  EC: 'EC (mS/cm)',
  N: 'N (ppm)',
  P: 'P (ppm)',
  K: 'K (ppm)',
  temperature: 'Nhiệt độ KK (°C)',
  humidity: 'Độ ẩm KK (%)',
};

const SENSOR_KEYS = Object.keys(SENSOR_LABELS) as SensorKey[];

type ChartRow = { epochMs: number } & Partial<Record<SensorKey, number>>;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

const toRow = (epochMs: number, r: FirebaseSensorReading): ChartRow => {
  const row: ChartRow = { epochMs };
  for (const key of SENSOR_KEYS) {
    const v = num(r[key]);
    if (v !== undefined) row[key] = v;
  }
  return row;
};

/** Gộp trung bình theo nhóm liên tiếp để giữ số điểm vẽ <= maxPoints. */
const downsample = (rows: ChartRow[], maxPoints: number): ChartRow[] => {
  if (rows.length <= maxPoints) return rows;
  const bucketSize = Math.ceil(rows.length / maxPoints);
  const out: ChartRow[] = [];
  for (let i = 0; i < rows.length; i += bucketSize) {
    const bucket = rows.slice(i, i + bucketSize);
    const agg: ChartRow = { epochMs: bucket[Math.floor(bucket.length / 2)].epochMs };
    for (const key of SENSOR_KEYS) {
      let sum = 0;
      let count = 0;
      for (const row of bucket) {
        const v = row[key];
        if (v !== undefined) {
          sum += v;
          count += 1;
        }
      }
      if (count > 0) agg[key] = Number((sum / count).toFixed(3));
    }
    out.push(agg);
  }
  return out;
};

export default function SensorChart({
  sensorData,
  range,
  rangeDays,
  onPresetChange,
  onCustomRangeChange,
  source,
  loading,
}: SensorChartProps) {
  const [isRangePickerOpen, setIsRangePickerOpen] = useState(false);
  const [pendingRange, setPendingRange] = useState<{ from?: Date; to?: Date }>({});
  const [visibleSensors, setVisibleSensors] = useState<Set<SensorKey>>(new Set(['moisture', 'soiltemp', 'pH']));

  // Khi mở picker, đồng bộ lựa chọn với khoảng hiện tại
  useEffect(() => {
    if (isRangePickerOpen && range) {
      setPendingRange({ from: dateKeyToLocalDate(range.startDate), to: dateKeyToLocalDate(range.endDate) });
    }
  }, [isRangePickerOpen, range]);

  const points = useMemo(() => flattenSensorData(sensorData), [sensorData]);
  const fullRows = useMemo(() => points.map((p) => toRow(p.epochMs, p.reading)), [points]);
  const chartData = useMemo(() => downsample(fullRows, MAX_CHART_POINTS), [fullRows]);
  const hasLight = useMemo(() => points.some((p) => num(p.reading.light) !== undefined), [points]);

  const spanMs = chartData.length > 1 ? chartData[chartData.length - 1].epochMs - chartData[0].epochMs : 0;
  const multiDay = spanMs > 26 * 3600 * 1000;

  const formatTick = (ms: number) =>
    formatEpochMsVi(
      ms,
      multiDay
        ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
        : { hour: '2-digit', minute: '2-digit', hour12: false },
    );

  const toggleSensor = (sensor: SensorKey) => {
    const next = new Set(visibleSensors);
    if (next.has(sensor)) next.delete(sensor);
    else next.add(sensor);
    setVisibleSensors(next);
  };

  const handleDownload = () => {
    if (points.length === 0) return;
    const fileName = range
      ? range.startDate === range.endDate
        ? `sensor-data-${range.startDate}.xlsx`
        : `sensor-data-${range.startDate}-to-${range.endDate}.xlsx`
      : 'sensor-data.xlsx';

    const excelData = points.map(({ dateKey, timeKey, reading }) => {
      const row: Record<string, string | number | undefined> = {
        'Ngày': dateKey,
        'Giờ': timeKey,
        'Độ ẩm đất (%)': reading.moisture,
        'Nhiệt độ đất (°C)': reading.soiltemp,
        'pH': reading.pH,
        'EC (mS/cm)': reading.EC,
        'N (ppm)': reading.N,
        'P (ppm)': reading.P,
        'K (ppm)': reading.K,
        'Nhiệt độ KK (°C)': reading.temperature,
        'Độ ẩm KK (%)': reading.humidity,
      };
      if (hasLight) row['Ánh sáng'] = reading.light;
      if (reading.tq) row['Chất lượng thời gian'] = reading.tq;
      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sensor Data');
    worksheet['!cols'] = Object.keys(excelData[0] || {}).map((key) => ({ wch: Math.max(key.length + 2, 12) }));
    XLSX.writeFile(workbook, fileName);
  };

  const pendingDays =
    pendingRange.from
      ? diffDateKeys(localDateToDateKey(pendingRange.from), localDateToDateKey(pendingRange.to ?? pendingRange.from)) + 1
      : 0;
  const pendingTooLong = pendingDays > MAX_CUSTOM_RANGE_DAYS;

  const confirmCustomRange = () => {
    if (!pendingRange.from || pendingTooLong) return;
    const startDate = localDateToDateKey(pendingRange.from);
    const endDate = localDateToDateKey(pendingRange.to ?? pendingRange.from);
    onCustomRangeChange?.({ startDate, endDate });
    setIsRangePickerOpen(false);
  };

  const today = dateKeyToLocalDate(todayDateKey());

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h3 className="font-display text-lg sm:text-xl font-semibold flex items-center gap-2">
            Biểu đồ cảm biến
            {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </h3>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Range presets */}
            <div className="flex rounded-lg border border-border p-0.5 bg-secondary/50">
              {RANGE_PRESET_DAYS.map((days) => (
                <button
                  key={days}
                  onClick={() => onPresetChange?.(days)}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded-md transition-all',
                    rangeDays === days
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {days} ngày
                </button>
              ))}
            </div>

            {/* Custom range picker */}
            <Popover open={isRangePickerOpen} onOpenChange={setIsRangePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    'h-8 text-xs sm:text-sm gap-2 border-primary/20 hover:border-primary/40',
                    rangeDays === null && 'bg-primary/10 text-primary',
                  )}
                >
                  <CalendarDays className="h-4 w-4 text-primary" />
                  Tùy chọn
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3 shadow-xl border-primary/10" align="end" sideOffset={8}>
                <Calendar
                  mode="range"
                  selected={pendingRange.from ? { from: pendingRange.from, to: pendingRange.to } : undefined}
                  onSelect={(r) => setPendingRange({ from: r?.from, to: r?.to })}
                  disabled={(date) => date > today}
                  defaultMonth={pendingRange.from}
                  numberOfMonths={1}
                  className="pointer-events-auto"
                />
                <div className="mt-3 pt-3 border-t border-border flex items-center justify-between gap-3 text-xs">
                  <span className={cn('text-muted-foreground', pendingTooLong && 'text-destructive')}>
                    {pendingRange.from
                      ? pendingTooLong
                        ? `Tối đa ${MAX_CUSTOM_RANGE_DAYS} ngày (đang chọn ${pendingDays})`
                        : `${pendingDays} ngày`
                      : 'Chọn ngày bắt đầu và kết thúc'}
                  </span>
                  <Button
                    size="sm"
                    className="h-7 text-xs px-3"
                    disabled={!pendingRange.from || pendingTooLong}
                    onClick={confirmCustomRange}
                  >
                    Xác nhận
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={points.length === 0}
              className="gap-1 sm:gap-2 h-8 text-xs sm:text-sm px-2 sm:px-3"
            >
              <Download className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Tải Excel</span>
            </Button>
          </div>
        </div>

        {/* Range info */}
        {range && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground bg-secondary/30 rounded-lg px-3 py-2">
            <CalendarDays className="h-3.5 w-3.5 text-primary" />
            <span>
              Hiển thị dữ liệu từ <span className="font-medium text-foreground">{formatDateKeyVi(range.startDate)}</span>{' '}
              đến <span className="font-medium text-foreground">{formatDateKeyVi(range.endDate)}</span>
            </span>
            {points.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                {points.length.toLocaleString('vi-VN')} điểm
                {chartData.length < points.length && ` (vẽ ${chartData.length.toLocaleString('vi-VN')})`}
              </span>
            )}
            {source === 'firebase' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-success/10 text-success font-medium">
                <Database className="h-3 w-3" /> Firebase realtime
              </span>
            )}
            {source === 'local' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-warning/10 text-warning font-medium">
                <CloudOff className="h-3 w-3" /> Dữ liệu cục bộ (dự phòng)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Sensor Toggles */}
      <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-4">
        {SENSOR_KEYS.map((sensor) => (
          <button
            key={sensor}
            onClick={() => toggleSensor(sensor)}
            className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-medium transition-all ${
              visibleSensors.has(sensor) ? 'text-white' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
            }`}
            style={{ backgroundColor: visibleSensors.has(sensor) ? SENSOR_COLORS[sensor] : undefined }}
          >
            {SENSOR_LABELS[sensor]}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="h-64 sm:h-80">
        {chartData.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
            {loading ? (
              <Loader2 className="h-8 w-8 animate-spin opacity-50" />
            ) : (
              <>
                <CalendarDays className="h-8 w-8 opacity-50" />
                <span>Không có dữ liệu trong khoảng thời gian đã chọn</span>
              </>
            )}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="epochMs"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                tickFormatter={formatTick}
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tick={{ fontSize: 9 }}
                minTickGap={24}
              />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tick={{ fontSize: 9 }} width={35} />
              <Tooltip
                labelFormatter={(label) => (typeof label === 'number' ? formatEpochMsVi(label) : String(label))}
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '10px' }} />
              {SENSOR_KEYS.map((sensor) =>
                visibleSensors.has(sensor) ? (
                  <Line
                    key={sensor}
                    type="monotone"
                    dataKey={sensor}
                    name={SENSOR_LABELS[sensor]}
                    stroke={SENSOR_COLORS[sensor]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    connectNulls
                    isAnimationActive={chartData.length < 500}
                  />
                ) : null,
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
