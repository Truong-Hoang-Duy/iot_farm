import { CloudRain, Droplets, Gauge, MapPin, Sun, Thermometer, Sprout, Waves } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getSelectedWeatherLocation, type WeatherResponse } from '@/services/backendAPI';
import { ErrorState } from '@/components/forecast/StateViews';
import { fmtDateTime, fmtNum } from '@/components/forecast/chartUtils';
import { nearestRow, sumBetween, val, wmoDescription } from './weatherUtils';

interface Props {
  data?: WeatherResponse;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

function Stat({ icon: Icon, label, value, unit, color }: { icon: typeof Sun; label: string; value?: number; unit: string; color: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-secondary/40 px-3 py-2">
      <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center', color)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground truncate">{label}</p>
        <p className="font-semibold text-sm tabular-nums">
          {fmtNum(value, 1)} <span className="text-xs font-normal text-muted-foreground">{value !== undefined ? unit : ''}</span>
        </p>
      </div>
    </div>
  );
}

export function CurrentWeatherCard({ data, isLoading, error, onRetry, className }: Props) {
  const now = Date.now();
  const hourly = data?.hourly ?? [];
  const near = nearestRow(hourly, now);
  // Ưu tiên khối "current", thiếu trường nào thì lấy từ giờ gần nhất
  const pick = (k: string) => val(data?.current, k) ?? val(near, k);
  const temp = pick('temperature_2m');
  const code = pick('weather_code') ?? pick('weathercode');
  const wmo = wmoDescription(code);
  const rain24 = sumBetween(hourly, 'precipitation', now, now + 24 * 3600_000);
  const et024 = sumBetween(hourly, 'et0_fao_evapotranspiration', now, now + 24 * 3600_000);
  const obsTs = data?.current?.ts ?? near?.ts;
  const selLoc = getSelectedWeatherLocation();
  const lat = data?.location?.lat ?? selLoc.lat;
  const lon = data?.location?.lon ?? selLoc.lon;
  const locName = data?.location?.name ?? selLoc.name;
  const rainTotal24 = data?.next24h?.precip_total_mm ?? (rain24.n ? rain24.sum : undefined);
  const et0Total24 = data?.next24h?.et0_total_mm ?? (et024.n ? et024.sum : pick('et0_fao_evapotranspiration'));
  const waterBalance24 =
    rainTotal24 !== undefined && et0Total24 !== undefined ? rainTotal24 - et0Total24 : pick('water_balance_24h');

  return (
    <div className={cn('rounded-2xl border border-border bg-card p-4 sm:p-6', className)}>
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-16 w-40" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        </div>
      ) : error && !data ? (
        <ErrorState error={error} onRetry={onRetry} showTrainLink={false} className="py-8" />
      ) : (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="lg:w-64 shrink-0 space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1" title={`${locName} (${fmtNum(lat, 4)}, ${fmtNum(lon, 4)})`}>
              <MapPin className="h-3 w-3 shrink-0 text-primary" />
              <span className="truncate font-medium text-foreground">{locName}</span>
            </p>
            <p className="text-[11px] text-muted-foreground font-mono">
              ({fmtNum(lat, 4)}°N, {fmtNum(lon, 4)}°E) · Open-Meteo IFS + ERA5-Land
            </p>
            <div className="flex items-center gap-3">
              <span className="text-5xl">{wmo.emoji}</span>
              <div>
                <p className="font-display text-4xl font-bold tabular-nums">
                  {fmtNum(temp, 1)}
                  <span className="text-2xl text-muted-foreground">°C</span>
                </p>
                {wmo.text && <p className="text-sm text-muted-foreground">{wmo.text}</p>}
              </div>
            </div>
            {obsTs && <p className="text-xs text-muted-foreground">Cập nhật: {fmtDateTime(obsTs)}</p>}
            {data?.stale && <p className="text-xs text-warning">Dữ liệu từ bộ nhớ đệm (Open-Meteo tạm thời không truy cập được)</p>}
            {data?.next24h && (data.next24h.temp_min !== undefined || data.next24h.temp_max !== undefined) && (
              <p className="text-xs text-muted-foreground">
                24h tới: {fmtNum(data.next24h.temp_min, 0)}–{fmtNum(data.next24h.temp_max, 0)} °C
                {data.next24h.precip_prob_max !== undefined ? `, khả năng mưa tối đa ${fmtNum(data.next24h.precip_prob_max, 0)}%` : ''}
              </p>
            )}
          </div>
          <div className="grid flex-1 grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat icon={Droplets} label="Độ ẩm KK (2m)" value={pick('relative_humidity_2m')} unit="%" color="bg-water/15 text-water" />
            <Stat icon={Gauge} label="Áp suất hơi thiếu hụt (VPD)" value={pick('vapour_pressure_deficit')} unit="kPa" color="bg-purple-500/15 text-purple-600" />
            <Stat icon={Sun} label="Bức xạ mặt trời" value={pick('shortwave_radiation')} unit="W/m²" color="bg-warning/15 text-warning" />
            <Stat
              icon={Sprout}
              label="Bốc thoát hơi ET0 (24h)"
              value={et0Total24}
              unit="mm"
              color="bg-success/15 text-success"
            />
            <Stat
              icon={CloudRain}
              label="Tổng mưa 24h tới"
              value={rainTotal24}
              unit="mm"
              color="bg-blue-500/15 text-blue-600"
            />
            <Stat
              icon={Waves}
              label="Cân bằng nước 24h (P−ET0)"
              value={waterBalance24}
              unit="mm"
              color="bg-cyan-500/15 text-cyan-600"
            />
            <Stat
              icon={Thermometer}
              label="Nhiệt độ đất (ERA5)"
              value={pick('soil_temperature') ?? pick('soil_temperature_0cm')}
              unit="°C"
              color="bg-soil/15 text-soil"
            />
            <Stat
              icon={Droplets}
              label="Ẩm đất tầng rễ (ERA5)"
              value={
                pick('soil_moisture') !== undefined
                  ? (pick('soil_moisture') as number) <= 1
                    ? (pick('soil_moisture') as number) * 100
                    : pick('soil_moisture')
                  : undefined
              }
              unit="%"
              color="bg-emerald-500/15 text-emerald-600"
            />
          </div>
        </div>
      )}
    </div>
  );
}
