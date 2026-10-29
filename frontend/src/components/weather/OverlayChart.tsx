import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Layers } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  TARGETS,
  TARGET_MAP,
  WEATHER_VARS,
  WEATHER_VAR_INFO,
  backendAPI,
  queryKeys,
  shouldRetry,
  vnDateString,
  vnIsoString,
} from '@/services/backendAPI';
import { ChartSkeleton, EmptyState, ErrorState } from '@/components/forecast/StateViews';
import { axisProps, fmtDateTime, fmtNum, makeTimeTick, tooltipContentStyle } from '@/components/forecast/chartUtils';
import { val } from './weatherUtils';

const RANGES = [3, 7, 14, 30];
const HOUR = 3600_000;

/** Biểu đồ chồng: 1 biến thời tiết + 1 biến cảm biến (gộp theo giờ), 2 trục Y. */
export function OverlayChart({ className }: { className?: string }) {
  const [wVar, setWVar] = useState<string>('temperature_2m');
  const [sVar, setSVar] = useState<string>('moisture');
  const [days, setDays] = useState(7);

  // Làm tròn mốc thời gian theo giờ để queryKey ổn định
  const endMs = Math.ceil(Date.now() / HOUR) * HOUR;
  const startMs = endMs - days * 86400_000;
  const startDate = vnDateString(startMs);
  const endDate = vnDateString(endMs);
  const startIso = vnIsoString(startMs);
  const endIso = vnIsoString(endMs);

  const weatherQ = useQuery({
    queryKey: queryKeys.weatherHistory(startDate, endDate),
    queryFn: ({ signal }) => backendAPI.getWeatherHistory({ start: startDate, end: endDate }, signal),
    staleTime: 10 * 60_000,
    retry: shouldRetry,
  });
  const sensorQ = useQuery({
    queryKey: queryKeys.history(startIso, endIso, '1h', sVar),
    queryFn: ({ signal }) => backendAPI.getHistory({ start: startIso, end: endIso, every: '1h', fields: [sVar] }, signal),
    staleTime: 5 * 60_000,
    retry: shouldRetry,
  });

  const rows = useMemo(() => {
    const map = new Map<number, { ts: number; w?: number; s?: number }>();
    for (const r of weatherQ.data?.hourly ?? []) {
      if (r.ts < startMs || r.ts > endMs) continue;
      const k = Math.floor(r.ts / HOUR) * HOUR;
      const row = map.get(k) ?? { ts: k };
      row.w = val(r, wVar);
      map.set(k, row);
    }
    // Nếu backend trả nhiều điểm trong 1 giờ → trung bình
    const acc = new Map<number, { sum: number; n: number }>();
    for (const p of sensorQ.data?.points ?? []) {
      const v = val(p, sVar);
      if (v === undefined) continue;
      const k = Math.floor(p.ts / HOUR) * HOUR;
      const a = acc.get(k) ?? { sum: 0, n: 0 };
      a.sum += v;
      a.n++;
      acc.set(k, a);
    }
    for (const [k, a] of acc) {
      const row = map.get(k) ?? { ts: k };
      row.s = a.sum / a.n;
      map.set(k, row);
    }
    return [...map.values()].sort((a, b) => a.ts - b.ts);
  }, [weatherQ.data, sensorQ.data, wVar, sVar, startMs, endMs]);

  const wInfo = WEATHER_VAR_INFO[wVar];
  const sInfo = TARGET_MAP[sVar];
  const isBar = wVar === 'precipitation' || wVar === 'rain';
  const tick = useMemo(() => makeTimeTick(days * 86400_000), [days]);
  const hasW = rows.some((r) => r.w !== undefined);
  const hasS = rows.some((r) => r.s !== undefined);
  const loading = weatherQ.isLoading || sensorQ.isLoading;
  const bothError = weatherQ.isError && sensorQ.isError;

  return (
    <div className={cn('rounded-2xl border border-border bg-card p-4 sm:p-6 space-y-4', className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h2 className="font-display text-lg sm:text-xl font-semibold flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          So sánh thời tiết ↔ cảm biến
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={wVar} onValueChange={setWVar}>
            <SelectTrigger className="h-8 w-[200px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEATHER_VARS.map((k) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {WEATHER_VAR_INFO[k].label} ({WEATHER_VAR_INFO[k].unit})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">vs</span>
          <Select value={sVar} onValueChange={setSVar}>
            <SelectTrigger className="h-8 w-[170px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TARGETS.map((t) => (
                <SelectItem key={t.key} value={t.key} className="text-xs">
                  {t.label}
                  {t.unit ? ` (${t.unit})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex rounded-lg border border-border p-0.5 bg-secondary/50">
            {RANGES.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={cn(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                  days === d ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {d} ngày
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="h-72">
        {loading ? (
          <ChartSkeleton className="h-full" />
        ) : bothError ? (
          <ErrorState error={weatherQ.error} onRetry={() => { weatherQ.refetch(); sensorQ.refetch(); }} className="h-full" showTrainLink={false} />
        ) : !hasW && !hasS ? (
          <EmptyState message="Không có dữ liệu cho khoảng thời gian này" className="h-full" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 5, right: 0, left: -5, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tick} minTickGap={30} {...axisProps} />
              <YAxis
                yAxisId="w"
                domain={['auto', 'auto']}
                width={45}
                {...axisProps}
                stroke={wInfo?.color}
                tickFormatter={(v: number) => fmtNum(v, wInfo?.digits ?? 1)}
              />
              <YAxis
                yAxisId="s"
                orientation="right"
                domain={['auto', 'auto']}
                width={45}
                {...axisProps}
                stroke={sInfo?.color}
                tickFormatter={(v: number) => fmtNum(v, sInfo?.digits ?? 1)}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelFormatter={(l: number) => fmtDateTime(l)}
                formatter={(v: number, name: string) =>
                  name === 'w'
                    ? [`${fmtNum(v, (wInfo?.digits ?? 1) + 1)} ${wInfo?.unit ?? ''}`, `${wInfo?.label ?? wVar} (Open-Meteo)`]
                    : [`${fmtNum(v, (sInfo?.digits ?? 1) + 1)} ${sInfo?.unit ?? ''}`, `${sInfo?.label ?? sVar} (cảm biến)`]
                }
              />
              <Legend
                wrapperStyle={{ fontSize: '11px' }}
                formatter={(v: string) => (v === 'w' ? `${wInfo?.label} (${wInfo?.unit}) – trục trái` : `${sInfo?.label}${sInfo?.unit ? ` (${sInfo.unit})` : ''} – trục phải`)}
              />
              {isBar ? (
                <Bar yAxisId="w" dataKey="w" name="w" fill={wInfo?.color} maxBarSize={10} isAnimationActive={false} />
              ) : (
                <Line yAxisId="w" type="monotone" dataKey="w" name="w" stroke={wInfo?.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              )}
              <Line yAxisId="s" type="monotone" dataKey="s" name="s" stroke={sInfo?.color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>Dữ liệu cảm biến: InfluxDB (gộp trung bình theo giờ). Thời tiết: Open-Meteo hourly tại vị trí trang trại.</span>
        {weatherQ.isError && !bothError && <span className="text-warning">Không tải được dữ liệu thời tiết.</span>}
        {sensorQ.isError && !bothError && <span className="text-warning">Không tải được dữ liệu cảm biến.</span>}
      </div>
    </div>
  );
}
