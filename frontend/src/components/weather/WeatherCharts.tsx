import { useMemo, type ReactNode } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import { WEATHER_VAR_INFO, type WeatherHourly } from '@/services/backendAPI';
import { EmptyState } from '@/components/forecast/StateViews';
import { axisProps, downsample, fmtDate, fmtDateTime, fmtNum, fmtWeekday, makeTimeTick, tooltipContentStyle } from '@/components/forecast/chartUtils';
import { aggregateDaily, val, wmoDescription } from './weatherUtils';

interface WeatherChartsProps {
  hourly: WeatherHourly[];
  /** Vạch "Hiện tại" */
  nowTs?: number;
  /** Gộp theo ngày khi khoảng > N ngày (mặc định 10) */
  dailyThresholdDays?: number;
  className?: string;
}

function ChartBox({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border p-3', className)}>
      <h4 className="text-sm font-medium mb-2">{title}</h4>
      <div className="h-56">{children}</div>
    </div>
  );
}

const info = (k: string) => WEATHER_VAR_INFO[k];

export function WeatherCharts({ hourly, nowTs, dailyThresholdDays = 10, className }: WeatherChartsProps) {
  const span = hourly.length > 1 ? hourly[hourly.length - 1].ts - hourly[0].ts : 0;
  const daily = span > dailyThresholdDays * 86400_000;

  const rows = useMemo(() => (daily ? aggregateDaily(hourly) : downsample(hourly, 1200)), [hourly, daily]);
  const tick = useMemo(() => (daily ? (ms: number) => fmtDate(ms).slice(0, 5) : makeTimeTick(span)), [daily, span]);
  const labelFmt = (l: number) => (daily ? fmtWeekday(l) : fmtDateTime(l));
  const has = (k: string) => rows.some((r) => val(r, k) !== undefined);

  if (!hourly.length) return <EmptyState message="Không có dữ liệu thời tiết cho khoảng này" className="h-64" />;

  const xAxis = (
    <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tick} minTickGap={30} {...axisProps} />
  );
  const nowLine =
    nowTs !== undefined && rows.length && nowTs >= rows[0].ts && nowTs <= rows[rows.length - 1].ts ? (
      <ReferenceLine
        x={nowTs}
        yAxisId="l"
        stroke="hsl(var(--muted-foreground))"
        strokeDasharray="3 3"
        label={{ value: 'Hiện tại', position: 'insideTopRight', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
      />
    ) : null;
  const fmt = (v: number, name: string) => {
    const k = name;
    const i = info(k);
    return [`${fmtNum(v, i?.digits ?? 1)} ${i?.unit ?? ''}`, i?.label ?? (k === 'temperature_2m_max' ? 'Nhiệt độ cao nhất' : k === 'temperature_2m_min' ? 'Nhiệt độ thấp nhất' : k)];
  };
  const legendFmt = (v: string) =>
    info(v)?.label ?? (v === 'temperature_2m_max' ? 'Cao nhất' : v === 'temperature_2m_min' ? 'Thấp nhất' : v);

  return (
    <div className={cn('grid gap-4 lg:grid-cols-2', className)}>
      {daily && (
        <p className="lg:col-span-2 text-xs text-muted-foreground -mb-2">Khoảng dài → dữ liệu được gộp theo ngày (mưa, ET0: tổng ngày; còn lại: trung bình).</p>
      )}
      <ChartBox title="Nhiệt độ & độ ẩm không khí" className="lg:col-span-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 5, right: 0, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            {xAxis}
            <YAxis yAxisId="l" domain={['auto', 'auto']} width={40} {...axisProps} unit="°" />
            <YAxis yAxisId="r" orientation="right" domain={[0, 100]} width={35} {...axisProps} unit="%" />
            <Tooltip contentStyle={tooltipContentStyle} labelFormatter={labelFmt} formatter={fmt} />
            <Legend wrapperStyle={{ fontSize: '11px' }} formatter={legendFmt} />
            {daily && has('temperature_2m_max') && (
              <Line yAxisId="l" type="monotone" dataKey="temperature_2m_max" stroke="hsl(0, 80%, 60%)" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
            )}
            {daily && has('temperature_2m_min') && (
              <Line yAxisId="l" type="monotone" dataKey="temperature_2m_min" stroke="hsl(200, 70%, 55%)" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
            )}
            <Line yAxisId="l" type="monotone" dataKey="temperature_2m" stroke={info('temperature_2m').color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line yAxisId="r" type="monotone" dataKey="relative_humidity_2m" stroke={info('relative_humidity_2m').color} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
            {nowLine}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartBox>

      <ChartBox title={daily ? 'Lượng mưa (tổng ngày) & mây' : 'Lượng mưa & mây che phủ'}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 5, right: 0, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            {xAxis}
            <YAxis yAxisId="l" width={40} {...axisProps} />
            <YAxis yAxisId="r" orientation="right" domain={[0, 100]} width={35} {...axisProps} unit="%" />
            <Tooltip contentStyle={tooltipContentStyle} labelFormatter={labelFmt} formatter={fmt} />
            <Legend wrapperStyle={{ fontSize: '11px' }} formatter={legendFmt} />
            {has('cloud_cover') && (
              <Area yAxisId="r" type="monotone" dataKey="cloud_cover" stroke="none" fill={info('cloud_cover').color} fillOpacity={0.15} isAnimationActive={false} />
            )}
            <Bar yAxisId="l" dataKey="precipitation" fill={info('precipitation').color} radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            {nowLine}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartBox>

      <ChartBox title={daily ? 'Bức xạ (TB ngày) & ET0 (tổng ngày)' : 'Bức xạ mặt trời & bốc thoát hơi ET0'}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 5, right: 0, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            {xAxis}
            <YAxis yAxisId="l" width={40} {...axisProps} />
            <YAxis yAxisId="r" orientation="right" width={35} {...axisProps} />
            <Tooltip contentStyle={tooltipContentStyle} labelFormatter={labelFmt} formatter={fmt} />
            <Legend wrapperStyle={{ fontSize: '11px' }} formatter={legendFmt} />
            <Area
              yAxisId="l"
              type="monotone"
              dataKey="shortwave_radiation"
              stroke={info('shortwave_radiation').color}
              fill={info('shortwave_radiation').color}
              fillOpacity={0.2}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              yAxisId="r"
              type="monotone"
              dataKey="et0_fao_evapotranspiration"
              stroke={info('et0_fao_evapotranspiration').color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            {nowLine}
          </ComposedChart>
        </ResponsiveContainer>
      </ChartBox>
    </div>
  );
}

/** Dải tóm tắt theo ngày (dùng cho tab Dự báo). Ưu tiên `daily` từ backend, thiếu thì gộp từ hourly. */
export function DailyStrip({ hourly, daily }: { hourly: WeatherHourly[]; daily?: WeatherHourly[] }) {
  const days = useMemo(() => (daily && daily.length ? daily : aggregateDaily(hourly)), [hourly, daily]);
  if (!days.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {days.map((d) => {
        const rain = val(d, 'precipitation_sum') ?? val(d, 'precipitation');
        const prob = val(d, 'precipitation_probability_max');
        const code = val(d, 'weather_code');
        const et0 = val(d, 'et0_fao_evapotranspiration') ?? val(d, 'et0_fao_evapotranspiration_sum');
        return (
          <div key={d.ts} className="min-w-[96px] rounded-xl border border-border bg-secondary/30 px-2.5 py-2 text-center text-xs space-y-0.5">
            <div className="font-medium">{fmtWeekday(d.ts)}</div>
            {code !== undefined && (
              <div className="text-lg leading-none" title={wmoDescription(code).text}>
                {wmoDescription(code).emoji}
              </div>
            )}
            <div className="tabular-nums">
              <span className="text-destructive font-semibold">{fmtNum(val(d, 'temperature_2m_max'), 0)}°</span>
              <span className="text-muted-foreground"> / </span>
              <span className="text-water font-semibold">{fmtNum(val(d, 'temperature_2m_min'), 0)}°</span>
            </div>
            <div className={cn('tabular-nums', rain !== undefined && rain >= 1 ? 'text-blue-600 font-medium' : 'text-muted-foreground')}>
              🌧 {fmtNum(rain, 1)} mm{prob !== undefined ? ` · ${fmtNum(prob, 0)}%` : ''}
            </div>
            <div className="text-muted-foreground tabular-nums">ET0 {fmtNum(et0, 1)}</div>
          </div>
        );
      })}
    </div>
  );
}
