import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CloudSun, Compass, History, MapPin, Navigation, Radar, RefreshCw, Sigma, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  backendAPI,
  calendarDateString,
  FARM_LOCATION_PRESETS,
  getSelectedWeatherLocation,
  queryKeys,
  setSelectedWeatherLocation,
  shouldRetry,
  vnDateString,
  type FarmLocationConfig,
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
const CORR_DAYS = [30, 90, 260];

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
  const [corrDays, setCorrDays] = useState(90);
  const [method, setMethod] = useState<'pearson' | 'spearman'>('pearson');
  const [location, setLocation] = useState<FarmLocationConfig>(() => getSelectedWeatherLocation());
  const [latInput, setLatInput] = useState(() => String(getSelectedWeatherLocation().lat));
  const [lonInput, setLonInput] = useState(() => String(getSelectedWeatherLocation().lon));
  const [locating, setLocating] = useState(false);

  const coordKey = `${location.lat.toFixed(4)},${location.lon.toFixed(4)}`;

  const applyLocation = (next: FarmLocationConfig) => {
    const saved = setSelectedWeatherLocation(next);
    setLocation(saved);
    setLatInput(String(saved.lat));
    setLonInput(String(saved.lon));
  };

  const handleApplyCustomCoords = () => {
    const lat = Number(latInput);
    const lon = Number(lonInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
    const matched = FARM_LOCATION_PRESETS.find(
      (p) => Math.abs(p.lat - lat) < 0.0005 && Math.abs(p.lon - lon) < 0.0005,
    );
    applyLocation(
      matched ?? {
        id: 'custom',
        name: `Tọa độ tùy chỉnh (${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E)`,
        lat: Number(lat.toFixed(4)),
        lon: Number(lon.toFixed(4)),
      },
    );
  };

  const handleUseBrowserGps = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(4));
        const lon = Number(pos.coords.longitude.toFixed(4));
        applyLocation({
          id: 'gps',
          name: `Vị trí GPS thiết bị (${lat}°N, ${lon}°E)`,
          lat,
          lon,
        });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const now = Date.now();

  // ---- Hiện tại ----
  const currentQ = useQuery({
    queryKey: [...queryKeys.weatherCurrent, coordKey],
    queryFn: ({ signal }) => backendAPI.getWeatherCurrent(signal, location),
    refetchInterval: 10 * 60_000,
    staleTime: 5 * 60_000,
    retry: shouldRetry,
  });
  const currentHourly = currentQ.data?.hourly ?? [];
  const currentHasFuture = currentHourly.filter((r) => r.ts > now).length >= 24;

  // /current thường không kèm chuỗi giờ → bổ sung: tương lai từ /forecast?days=3, quá khứ gần từ /history (hôm qua → hôm nay)
  const nearQ = useQuery({
    queryKey: [...queryKeys.weatherForecast(3), coordKey],
    queryFn: ({ signal }) => backendAPI.getWeatherForecast(3, signal, location),
    enabled: !currentQ.isLoading && !currentHasFuture,
    staleTime: 10 * 60_000,
    retry: shouldRetry,
  });
  const pastStart = vnDateString(now - 86400_000);
  const pastEnd = vnDateString(now);
  const pastQ = useQuery({
    queryKey: [...queryKeys.weatherHistory(pastStart, pastEnd), coordKey],
    queryFn: ({ signal }) => backendAPI.getWeatherHistory({ start: pastStart, end: pastEnd }, signal, location),
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
    queryKey: [...queryKeys.weatherHistory(hStart, hEnd), coordKey],
    queryFn: ({ signal }) => backendAPI.getWeatherHistory({ start: hStart, end: hEnd }, signal, location),
    enabled: tab === 'history',
    staleTime: 10 * 60_000,
    retry: shouldRetry,
  });

  // ---- Dự báo ----
  const forecastQ = useQuery({
    queryKey: [...queryKeys.weatherForecast(fcDays), coordKey],
    queryFn: ({ signal }) => backendAPI.getWeatherForecast(fcDays, signal, location),
    enabled: tab === 'forecast',
    staleTime: 10 * 60_000,
    retry: shouldRetry,
  });

  // ---- Tương quan ----
  const corrQ = useQuery({
    queryKey: [...queryKeys.weatherCorrelation(corrDays, method, 24), coordKey],
    queryFn: ({ signal }) => backendAPI.getWeatherCorrelation({ days: corrDays, method, max_lag_h: 24 }, signal, location),
    staleTime: 10 * 60_000,
    retry: shouldRetry,
  });

  const insights = useMemo(() => generateInsights(nearAll, corrQ.data, now, currentQ.data?.next24h), [nearAll, corrQ.data, now, currentQ.data?.next24h]);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header & Bộ chọn tọa độ GPS */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold flex items-center gap-3">
              <CloudSun className="h-8 w-8 text-primary" />
              Thời tiết &amp; Tương quan Nông – Khí tượng
            </h1>
            <p className="text-muted-foreground mt-1">
              10 đặc trưng khí tượng chọn lọc từ Open-Meteo (ECMWF IFS + ERA5-Land) theo đúng tọa độ GPS đã chọn và mức ảnh hưởng tới 9 thông số cảm biến cốt lõi
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 w-fit"
            onClick={() => {
              currentQ.refetch();
              nearQ.refetch();
              pastQ.refetch();
              historyQ.refetch();
              forecastQ.refetch();
              corrQ.refetch();
            }}
            disabled={currentQ.isFetching}
          >
            <RefreshCw className={cn('h-4 w-4', currentQ.isFetching && 'animate-spin')} />
            Làm mới
          </Button>
        </div>

        {/* Thanh chọn tọa độ địa lý trên giao diện */}
        <div className="rounded-2xl border border-border bg-card/80 p-3.5 sm:p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <MapPin className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Vị trí tọa độ trạm khảo sát khí tượng</p>
              <p className="text-sm font-semibold">
                {location.name}{' '}
                <span className="font-mono text-xs font-normal text-muted-foreground">
                  ({location.lat.toFixed(4)}°N, {location.lon.toFixed(4)}°E)
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Chọn vùng trồng mẫu"
              value={FARM_LOCATION_PRESETS.some((p) => p.id === location.id) ? location.id : 'custom'}
              onChange={(e) => {
                const found = FARM_LOCATION_PRESETS.find((p) => p.id === e.target.value);
                if (found) applyLocation(found);
              }}
              className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {FARM_LOCATION_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.lat.toFixed(4)}, {p.lon.toFixed(4)})
                </option>
              ))}
              {!FARM_LOCATION_PRESETS.some((p) => p.id === location.id) && (
                <option value="custom">Tọa độ tùy chỉnh ({location.lat.toFixed(4)}, {location.lon.toFixed(4)})</option>
              )}
            </select>

            <div className="flex items-center gap-1.5">
              <input
                type="number"
                step="0.0001"
                value={latInput}
                onChange={(e) => setLatInput(e.target.value)}
                placeholder="Vĩ độ (Lat)"
                className="h-8 w-24 rounded-lg border border-border bg-background px-2 text-xs font-mono"
                title="Vĩ độ (Latitude)"
              />
              <input
                type="number"
                step="0.0001"
                value={lonInput}
                onChange={(e) => setLonInput(e.target.value)}
                placeholder="Kinh độ (Lon)"
                className="h-8 w-24 rounded-lg border border-border bg-background px-2 text-xs font-mono"
                title="Kinh độ (Longitude)"
              />
              <Button variant="secondary" size="sm" className="h-8 text-xs gap-1 px-2.5" onClick={handleApplyCustomCoords}>
                <Compass className="h-3.5 w-3.5" />
                Áp dụng tọa độ
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1 px-2.5"
                onClick={handleUseBrowserGps}
                disabled={locating}
                title="Lấy tọa độ GPS hiện tại từ trình duyệt"
              >
                <Navigation className="h-3.5 w-3.5" />
                {locating ? 'Đang định vị...' : 'GPS hiện tại'}
              </Button>
            </div>
          </div>
        </div>
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

      <OverlayChart location={location} />

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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-xl border border-border/70 bg-secondary/20 p-3.5 text-xs">
              <div className="space-y-1">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  1. Khí quyển &amp; Bức xạ (T2m, RH2m, VPD, Bức xạ, ET0)
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Tác động tức thời (0h) rất mạnh lên <b>Nhiệt độ KK</b> (<span className="font-mono">r ≈ +0.70</span>) và <b>Độ ẩm KK</b> (<span className="font-mono">r ≈ +0.86</span> với RH2m, <span className="font-mono">-0.85</span> với VPD), đồng thời truyền nhiệt xuống <b>Nhiệt độ đất</b> với <b>độ trễ +5h → +7h</b> (<span className="font-mono">r ≈ +0.75</span>).
                </p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                  2. Tích lũy Mưa &amp; Cân bằng nước (Mưa 24h/72h, P−ET0)
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Mưa 1h đơn lẻ nhiễu cao, nhưng <b>Tổng mưa 24h</b> và <b>Cân bằng nước (P − ET0)</b> quyết định trực tiếp <b>Độ ẩm đất</b> (<span className="font-mono">r ≈ +0.62</span>) và giảm <b>pH đất</b> (<span className="font-mono">r ≈ -0.45</span>). <b>Tổng mưa 72h</b> phản ánh rõ hiện tượng rửa trôi dinh dưỡng <b>EC, N, P, K</b> (<span className="font-mono">r ≈ -0.23 → -0.33</span>).
                </p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                  3. Mô hình Đất ERA5-Land (Nhiệt độ &amp; Ẩm đất 0–7cm)
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Đóng vai trò biến cầu nối vật lý có tương quan cao nhất với cả 6 thông số dưới mặt đất: <b>Nhiệt độ đất</b> (<span className="font-mono">r = +0.76</span>), <b>Độ ẩm đất</b> (<span className="font-mono">r = +0.55</span>), <b>pH</b> (<span className="font-mono">-0.49</span>) và nhóm khoáng <b>EC, N, P, K</b> (<span className="font-mono">r ≈ -0.33 → -0.42</span>).
                </p>
              </div>
            </div>
            <CorrelationHeatmap data={corrQ.data} />
            <LagTable data={corrQ.data} />
            <p className="text-[11px] text-muted-foreground">
              Pearson đo quan hệ tuyến tính; Spearman đo quan hệ đơn điệu (dựa trên thứ hạng, ít nhạy với ngoại lai). Đã loại bỏ các biến thời tiết nhiễu thấp (Mây che phủ, Gió 10m, Mưa 1h rời rạc) để tập trung vào 10 đặc trưng nông – khí tượng cốt lõi.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
