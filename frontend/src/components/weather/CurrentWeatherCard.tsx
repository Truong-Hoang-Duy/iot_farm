import { CloudRain, Cloud, Droplets, Gauge, MapPin, Sun, Thermometer, Wind, Sprout } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { FARM_LOCATION, type WeatherResponse } from '@/services/backendAPI';
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
  const lat = data?.location?.lat ?? FARM_LOCATION.lat;
  const lon = data?.location?.lon ?? FARM_LOCATION.lon;

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
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {fmtNum(lat, 4)}, {fmtNum(lon, 4)} · Open-Meteo
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
            <Stat icon={Droplets} label="Độ ẩm KK" value={pick('relative_humidity_2m')} unit="%" color="bg-water/15 text-water" />
            <Stat icon={CloudRain} label="Mưa (giờ này)" value={pick('precipitation')} unit="mm" color="bg-blue-500/15 text-blue-600" />
            <Stat icon={Cloud} label="Mây che phủ" value={pick('cloud_cover')} unit="%" color="bg-slate-500/15 text-slate-600" />
            <Stat icon={Wind} label="Gió 10m" value={pick('wind_speed_10m')} unit="km/h" color="bg-teal-500/15 text-teal-600" />
            <Stat icon={Sun} label="Bức xạ" value={pick('shortwave_radiation')} unit="W/m²" color="bg-warning/15 text-warning" />
            <Stat icon={Gauge} label="VPD" value={pick('vapour_pressure_deficit')} unit="kPa" color="bg-purple-500/15 text-purple-600" />
            <Stat
              icon={CloudRain}
              label="Mưa 24h tới"
              value={data?.next24h?.precip_total_mm ?? (rain24.n ? rain24.sum : undefined)}
              unit="mm"
              color="bg-blue-500/15 text-blue-600"
            />
            <Stat
              icon={Sprout}
              label="ET0 24h tới"
              value={data?.next24h?.et0_total_mm ?? (et024.n ? et024.sum : pick('et0_fao_evapotranspiration'))}
              unit="mm"
              color="bg-success/15 text-success"
            />
            {(pick('soil_temperature') ?? pick('soil_temperature_0cm')) !== undefined && (
              <Stat icon={Thermometer} label="Nhiệt độ đất" value={pick('soil_temperature') ?? pick('soil_temperature_0cm')} unit="°C" color="bg-soil/15 text-soil" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
