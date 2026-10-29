import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CloudSun, History, Radar, RefreshCw, Sigma } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  backendAPI,
  calendarDateString,
  queryKeys,
  shouldRetry,
  vnDateString,
  type WeatherHourly,
} from '@/services/backendAPI';
import { ChartSkeleton, ErrorState } from '@/components/forecast/StateViews';
import { fmtDate } from '@/components/forecast/chartUtils';
import { CurrentWeatherCard } from '@/components/weather/CurrentWeatherCard';
import { DailyStrip, WeatherCharts } from '@/components/weather/WeatherCharts';
import { DateRangePicker, presetRange, type DateRange } from '@/components/weather/DateRangePicker';
import { OverlayChart } from '@/components/weather/OverlayChart';
import { CorrelationHeatmap, LagTable } from '@/components/weather/CorrelationHeatmap';
import { InsightsList, generateInsights } from '@/components/weather/WeatherInsights';

const H = 3600_000;
const FORECAST_DAYS = [7, 14, 16];
const CORR_DAYS = [7, 30, 90];

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  render,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  render: (v: T) => string;
}) {
  return (
    <div className="flex rounded-lg border border-border p-0.5 bg-secondary/50">
      {options.map((o) => (
        <button
          key={String(o)}
          onClick={() => onChange(o)}
          className={cn(
            'px-3 py-1 text-xs font-medium rounded-md transition-all',
            value === o ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

export default function Weather() {
  const [tab, setTab] = useState('now');
  const [range, setRange] = useState<DateRange>(() => presetRange(7));
  const [fcDays, setFcDays] = useState(7);
  const [corrDays, setCorrDays] = useState(30);
  const [method, setMethod] = useState<'pearson' | 'spearman'>('pearson');

  const now = Date.now();

  // ---- Hiện tại ----
  const currentQ = useQuery({
    queryKey: queryKeys.weatherCurrent,
    queryFn: ({ signal }) => backendAPI.getWeatherCurrent(signal),
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
    retry: shouldRetry,
  });
  const currentHourly = currentQ.data?.hourly ?? [];
  const currentHasFuture = currentHourly.filter((r) => r.ts > now).length >= 24;

  // /current thường không kèm chuỗi giờ → bổ sung: tương lai từ /forecast?days=3, quá khứ gần từ /history (hôm qua → hôm nay)
  const nearQ = useQuery({
    queryKey: queryKeys.weatherForecast(3),
    queryFn: ({ signal }) => backendAPI.getWeatherForecast(3, signal),
    enabled: !currentQ.isLoading && !currentHasFuture,
    staleTime: 10 * 60_000,
    retry: shouldRetry,
  });
  const pastStart = vnDateString(now - 86400_000);
  const pastEnd = vnDateString(now);
  const pastQ = useQuery({
    queryKey: queryKeys.weatherHistory(pastStart, pastEnd),
    queryFn: ({ signal }) => backendAPI.getWeatherHistory({ start: pastStart, end: pastEnd }, signal),
    enabled: !currentQ.isLoading && !currentHasFuture,
    staleTime: 10 * 60_000,
    retry: shouldRetry,
  });
  const nearAll = useMemo(() => {
    if (currentHasFuture) return currentHourly;
    const map = new Map<number, WeatherHourly>();
    for (const r of currentHourly) map.set(r.ts, r);
    for (const r of pastQ.data?.hourly ?? []) if (r.ts <= now) map.set(r.ts, r);
    for (const r of nearQ.data?.hourly ?? []) if (r.ts > now || !map.has(r.ts)) map.set(r.ts, r);
    return [...map.values()].sort((a, b) => a.ts - b.ts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHasFuture, currentQ.data, pastQ.data, nearQ.data]);
  const near48 = useMemo(() => nearAll.filter((r) => r.ts >= now - 12 * H && r.ts <= now + 48 * H), [nearAll, now]);

  // ---- Lịch sử ----
  const hStart = calendarDateString(range.from);
  const hEnd = calendarDateString(range.to);
  const historyQ = useQuery({
    queryKey: queryKeys.weatherHistory(hStart, hEnd),
    queryFn: ({ signal }) => backendAPI.getWeatherHistory({ start: hStart, end: hEnd }, signal),
    enabled: tab === 'history',
    staleTime: 10 * 60_000,
    retry: shouldRetry,
  });

  // ---- Dự báo ----
  const forecastQ = useQuery({
    queryKey: queryKeys.weatherForecast(fcDays),
    queryFn: ({ signal }) => backendAPI.getWeatherForecast(fcDays, signal),
    enabled: tab === 'forecast',
    staleTime: 10 * 60_000,
    retry: shouldRetry,
  });

  // ---- Tương quan ----
  const corrQ = useQuery({
    queryKey: queryKeys.weatherCorrelation(corrDays, method, 24),
    queryFn: ({ signal }) => backendAPI.getWeatherCorrelation({ days: corrDays, method, max_lag_h: 24 }, signal),
    staleTime: 10 * 60_000,
    retry: shouldRetry,
  });

  const insights = useMemo(() => generateInsights(nearAll, corrQ.data, now, currentQ.data?.next24h), [nearAll, corrQ.data, now, currentQ.data?.next24h]);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold flex items-center gap-3">
            <CloudSun className="h-8 w-8 text-primary" />
            Thời tiết &amp; Tương quan
          </h1>
          <p className="text-muted-foreground mt-1">Dữ liệu Open-Meteo tại trang trại và mối liên hệ với số liệu cảm biến</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 w-fit"
          onClick={() => {
            currentQ.refetch();
            corrQ.refetch();
          }}
          disabled={currentQ.isFetching}
        >
          <RefreshCw className={cn('h-4 w-4', currentQ.isFetching && 'animate-spin')} />
          Làm mới
        </Button>
      </div>

      <CurrentWeatherCard data={currentQ.data} isLoading={currentQ.isLoading} error={currentQ.error} onRetry={() => currentQ.refetch()} />

      <InsightsList insights={insights} />

      {/* Tabs */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <TabsList>
              <TabsTrigger value="history" className="gap-1.5 text-xs sm:text-sm">
                <History className="h-4 w-4" /> Lịch sử
              </TabsTrigger>
              <TabsTrigger value="now" className="gap-1.5 text-xs sm:text-sm">
                <CloudSun className="h-4 w-4" /> Hiện tại &amp; 48h
              </TabsTrigger>
              <TabsTrigger value="forecast" className="gap-1.5 text-xs sm:text-sm">
                <Radar className="h-4 w-4" /> Dự báo
              </TabsTrigger>
            </TabsList>
            {tab === 'history' && <DateRangePicker value={range} onChange={setRange} />}
            {tab === 'forecast' && <Segmented<number> options={FORECAST_DAYS} value={fcDays} onChange={setFcDays} render={(d) => `${d} ngày`} />}
          </div>

          <TabsContent value="history" className="mt-0">
            <p className="text-xs text-muted-foreground mb-3">
              {fmtDate(range.from.getTime())} → {fmtDate(range.to.getTime())} · dữ liệu lưu trữ ERA5 (bù bằng dự báo cho vài ngày gần nhất)
            </p>
            {historyQ.isLoading ? (
              <ChartSkeleton className="h-72" />
            ) : historyQ.isError ? (
              <ErrorState error={historyQ.error} onRetry={() => historyQ.refetch()} className="h-64" showTrainLink={false} />
            ) : (
              <WeatherCharts hourly={historyQ.data?.hourly ?? []} />
            )}
          </TabsContent>

          <TabsContent value="now" className="mt-0">
            {currentQ.isLoading || (nearQ.isLoading && nearQ.fetchStatus !== 'idle') || (pastQ.isLoading && pastQ.fetchStatus !== 'idle') ? (
              <ChartSkeleton className="h-72" />
            ) : !near48.length && (currentQ.isError || nearQ.isError) ? (
              <ErrorState error={currentQ.error ?? nearQ.error} onRetry={() => currentQ.refetch()} className="h-64" showTrainLink={false} />
            ) : (
              <WeatherCharts hourly={near48} nowTs={now} />
            )}
          </TabsContent>

          <TabsContent value="forecast" className="mt-0 space-y-4">
            {forecastQ.isLoading ? (
              <ChartSkeleton className="h-72" />
            ) : forecastQ.isError ? (
              <ErrorState error={forecastQ.error} onRetry={() => forecastQ.refetch()} className="h-64" showTrainLink={false} />
            ) : (
              <>
                <DailyStrip hourly={forecastQ.data?.hourly ?? []} daily={forecastQ.data?.daily} />
                <WeatherCharts hourly={forecastQ.data?.hourly ?? []} nowTs={now} dailyThresholdDays={20} />
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <OverlayChart />

      {/* Correlation */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-display text-lg sm:text-xl font-semibold flex items-center gap-2">
            <Sigma className="h-5 w-5 text-primary" />
            Tương quan thời tiết ↔ cảm biến
          </h2>
          <div className="flex flex-wrap gap-2">
            <Segmented<'pearson' | 'spearman'>
              options={['pearson', 'spearman'] as ('pearson' | 'spearman')[]}
              value={method}
              onChange={setMethod}
              render={(m) => (m === 'pearson' ? 'Pearson' : 'Spearman')}
            />
            <Segmented<number> options={CORR_DAYS} value={corrDays} onChange={setCorrDays} render={(d) => `${d} ngày`} />
          </div>
        </div>
        {corrQ.isLoading ? (
          <ChartSkeleton className="h-64" />
        ) : corrQ.isError ? (
          <ErrorState error={corrQ.error} onRetry={() => corrQ.refetch()} className="h-56" showTrainLink={false} />
        ) : corrQ.data ? (
          <>
            <CorrelationHeatmap data={corrQ.data} />
            <LagTable data={corrQ.data} />
            <p className="text-[11px] text-muted-foreground">
              Pearson đo quan hệ tuyến tính; Spearman đo quan hệ đơn điệu (dựa trên thứ hạng, ít nhạy với ngoại lai). Tương quan không đồng nghĩa nhân
              quả.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
