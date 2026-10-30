import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Sprout,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  HORIZONS,
  HORIZON_MAP,
  TARGETS,
  TARGET_MAP,
  forecastQuery,
  type ForecastResponse,
} from '@/services/backendAPI';
import { ChartSkeleton, EmptyState, ErrorState } from './StateViews';
import {
  axisProps,
  downsample,
  fmtDateTime,
  fmtNum,
  makeTimeTick,
  tooltipContentStyle,
} from './chartUtils';

interface ChartRow {
  ts: number;
  obs?: number;
  yhat?: number;
  band?: [number, number];
}

interface OptimalRange {
  min: number;
  max: number;
  unit: string;
  lowAdvice: string;
  highAdvice: string;
  okAdvice: string;
}

const CHILI_OPTIMAL_RANGES: Record<string, OptimalRange> = {
  moisture: {
    min: 50,
    max: 70,
    unit: '%',
    lowAdvice: 'Độ ẩm đất có xu hướng giảm thấp, nên chủ động tưới bù nhỏ giọt để giữ ẩm vùng rễ ớt.',
    highAdvice: 'Độ ẩm đất dự báo vượt mức an toàn, nên tạm ngưng tưới và kiểm tra thoát nước luống.',
    okAdvice: 'Độ ẩm đất duy trì ổn định trong vùng tối ưu cho cây ớt hấp thu dinh dưỡng.',
  },
  soiltemp: {
    min: 20,
    max: 28,
    unit: '°C',
    lowAdvice: 'Nhiệt độ đất hạ thấp, hạn chế tưới nước lạnh vào sáng sớm hoặc chiều muộn.',
    highAdvice: 'Nhiệt độ đất tăng cao, nên phủ rơm giữ ẩm hoặc tưới làm mát nhẹ.',
    okAdvice: 'Nhiệt độ vùng rễ ổn định, thuận lợi cho bộ rễ cây ớt phát triển.',
  },
  pH: {
    min: 5.8,
    max: 6.5,
    unit: '',
    lowAdvice: 'Đất có xu hướng chua nhẹ, cân nhắc bổ sung vôi nông nghiệp hoặc hữu cơ vi sinh.',
    highAdvice: 'Độ pH đất hơi cao, nên điều chỉnh dung dịch tưới để tránh khóa vi lượng.',
    okAdvice: 'Độ pH đất cân bằng, giúp rễ ớt hấp thu tốt đa - trung - vi lượng.',
  },
  EC: {
    min: 1.0,
    max: 2.2,
    unit: 'mS/cm',
    lowAdvice: 'Nồng độ dinh dưỡng hòa tan thấp, nên bổ sung phân thúc NPK cân đối.',
    highAdvice: 'Nồng độ muối hòa tan cao, nên tưới nước trắng rửa nhẹ và giảm lượng phân bón.',
    okAdvice: 'Độ dẫn điện EC nằm trong ngưỡng an toàn cho hệ rễ cây ớt.',
  },
  N: {
    min: 50,
    max: 150,
    unit: 'mg/kg',
    lowAdvice: 'Hàm lượng đạm giảm thấp, cần bổ sung đạm dễ tiêu để duy trì đà sinh trưởng thân lá.',
    highAdvice: 'Hàm lượng đạm cao, nên hạn chế bón thêm đạm để tránh lốp lá và rụng hoa.',
    okAdvice: 'Hàm lượng đạm (N) duy trì cân đối cho cây ớt.',
  },
  P: {
    min: 80,
    max: 250,
    unit: 'mg/kg',
    lowAdvice: 'Hàm lượng lân thấp, nên bổ sung lân dễ tiêu để kích thích bộ rễ và phân hóa mầm hoa.',
    highAdvice: 'Hàm lượng lân đã cao, tạm ngưng bón thêm phân giàu lân.',
    okAdvice: 'Hàm lượng lân (P) ổn định, hỗ trợ tốt cho quá trình ra hoa và đậu quả.',
  },
  K: {
    min: 100,
    max: 300,
    unit: 'mg/kg',
    lowAdvice: 'Hàm lượng kali giảm, nên bổ sung kali để giúp cứng cây và nuôi trái ớt.',
    highAdvice: 'Hàm lượng kali vượt ngưỡng khuyến cáo, nên cân đối lại công thức phân thúc.',
    okAdvice: 'Hàm lượng kali (K) nằm trong ngưỡng tốt cho quá trình nuôi trái.',
  },
  temperature: {
    min: 22,
    max: 32,
    unit: '°C',
    lowAdvice: 'Nhiệt độ không khí hạ thấp, cần theo dõi độ ẩm mặt lá vào ban đêm.',
    highAdvice: 'Nhiệt độ không khí cao, nên tưới giữ ẩm sớm để giảm sốc nhiệt cho hoa ớt.',
    okAdvice: 'Nhiệt độ không khí thuận lợi cho quá trình quang hợp và thụ phấn.',
  },
  humidity: {
    min: 60,
    max: 80,
    unit: '%',
    lowAdvice: 'Không khí khô, cần duy trì đủ ẩm đất và lưu ý phòng bọ trĩ, nhện đỏ.',
    highAdvice: 'Độ ẩm không khí cao, nên tỉa thông thoáng tán lá để phòng nấm thán thư.',
    okAdvice: 'Độ ẩm không khí ổn định, cân bằng tốt cho sinh trưởng của cây ớt.',
  },
};

const SHORT_HORIZONS = HORIZONS.filter((h) => h.group === 'short');
const LONG_HORIZONS = HORIZONS.filter((h) => h.group === 'long');

function buildChartData(
  data: ForecastResponse,
  horizonMinutes: number,
): { rows: ChartRow[]; nowTs?: number; hasBand: boolean } {
  const hist = data.history.filter((p) => p.v !== undefined);
  const lastHist = hist[hist.length - 1];
  const nowTs = data.last_observation_ts ?? lastHist?.ts ?? data.issued_ts;

  const minWindow = data.group === 'long' ? 3 * 86400_000 : 3 * 3600_000;
  const windowMs = Math.max(horizonMinutes * 60_000 * 3.5, minWindow);
  const refTs = lastHist?.ts ?? nowTs ?? Date.now();
  const visibleHist = downsample(
    hist.filter((p) => p.ts >= refTs - windowMs),
    400,
  );

  const map = new Map<number, ChartRow>();
  for (const p of visibleHist) map.set(p.ts, { ts: p.ts, obs: p.v });

  const hasBand = data.forecast.some((p) => p.lo !== undefined && p.hi !== undefined);

  if (lastHist && lastHist.v !== undefined) {
    const row = map.get(lastHist.ts) ?? { ts: lastHist.ts, obs: lastHist.v };
    row.yhat = lastHist.v;
    if (hasBand) row.band = [lastHist.v, lastHist.v];
    map.set(lastHist.ts, row);
  }

  for (const p of downsample(data.forecast, 320)) {
    if (p.yhat === undefined) continue;
    const row = map.get(p.ts) ?? { ts: p.ts };
    row.yhat = p.yhat;
    if (p.lo !== undefined && p.hi !== undefined) {
      row.band = [Math.min(p.lo, p.hi), Math.max(p.lo, p.hi)];
    }
    map.set(p.ts, row);
  }

  return { rows: [...map.values()].sort((a, b) => a.ts - b.ts), nowTs, hasBand };
}

function EndUserForecastTooltip({
  active,
  payload,
  label,
  unit,
  digits,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: unknown; payload?: ChartRow }>;
  label?: number;
  unit: string;
  digits: number;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div style={tooltipContentStyle} className="px-3 py-2 shadow-md space-y-1">
      <p className="font-medium">{fmtDateTime(label ?? row.ts)}</p>
      {row.obs !== undefined && (
        <p className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3.5 bg-foreground" /> Thực tế:{' '}
          <b>{fmtNum(row.obs, digits)}</b> {unit}
        </p>
      )}
      {row.yhat !== undefined && row.obs === undefined && (
        <p className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3.5 border-t-2 border-dashed border-primary" /> Dự báo:{' '}
          <b>{fmtNum(row.yhat, digits)}</b> {unit}
        </p>
      )}
      {row.band && row.obs === undefined && (
        <p className="text-muted-foreground">
          Khoảng dự kiến: {fmtNum(row.band[0], digits)} – {fmtNum(row.band[1], digits)} {unit}
        </p>
      )}
    </div>
  );
}

export function UserForecastSection() {
  const [mode, setMode] = useState<'short' | 'long'>('short');
  const [target, setTarget] = useState<string>('moisture');
  const [shortHorizon, setShortHorizon] = useState<string>('6h');
  const [longHorizon, setLongHorizon] = useState<string>('3d');

  const horizon = mode === 'short' ? shortHorizon : longHorizon;

  const q = useQuery({
    ...forecastQuery(target, horizon, 'xgboost'),
    placeholderData: keepPreviousData,
  });

  const tDef = TARGET_MAP[target];
  const hDef = HORIZON_MAP[horizon];
  const optimal = CHILI_OPTIMAL_RANGES[target];
  const data = q.data;
  const isStale = !!data && (data.target !== target || data.horizon !== horizon);

  const chart = useMemo(
    () => (data ? buildChartData(data, HORIZON_MAP[data.horizon]?.minutes ?? hDef?.minutes ?? 360) : null),
    [data, hDef?.minutes],
  );
  const span =
    chart && chart.rows.length > 1 ? chart.rows[chart.rows.length - 1].ts - chart.rows[0].ts : 86400_000;
  const tick = useMemo(() => makeTimeTick(span), [span]);

  const summary = useMemo(() => {
    if (!data) return null;
    const hist = data.history.filter((p) => p.v !== undefined);
    const fc = data.forecast.filter((p) => p.yhat !== undefined);
    const lastObs = hist.length ? hist[hist.length - 1] : undefined;
    const endFc = fc.length ? fc[fc.length - 1] : undefined;
    if (!lastObs || !endFc || lastObs.v === undefined || endFc.yhat === undefined) return null;

    const delta = endFc.yhat - lastObs.v;
    const yhats = fc.map((p) => p.yhat as number);
    const minPred = Math.min(...yhats);
    const maxPred = Math.max(...yhats);

    let status: 'ok' | 'warn' = 'ok';
    let advice = optimal?.okAdvice ?? 'Chỉ số dự báo ổn định trong ngưỡng an toàn.';
    if (optimal) {
      if (endFc.yhat < optimal.min || minPred < optimal.min) {
        status = 'warn';
        advice = optimal.lowAdvice;
      } else if (endFc.yhat > optimal.max || maxPred > optimal.max) {
        status = 'warn';
        advice = optimal.highAdvice;
      }
    }

    return {
      lastObs,
      endFc,
      delta,
      status,
      advice,
    };
  }, [data, optimal]);

  const activeHorizons = mode === 'short' ? SHORT_HORIZONS : LONG_HORIZONS;

  return (
    <Card className="rounded-2xl border-border shadow-xs">
      <CardHeader className="p-4 sm:p-5 pb-3 border-b border-border/60">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Tiêu đề gọn + Chọn chỉ số cảm biến */}
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="font-display text-base sm:text-lg font-semibold flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <TrendingUp className="h-4 w-4" />
              </div>
              Dự báo xu hướng
            </CardTitle>

            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="h-9 w-[190px] rounded-xl text-xs font-medium bg-secondary/40 border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGETS.map((t) => (
                  <SelectItem key={t.key} value={t.key} className="text-xs">
                    {t.label} {t.unit ? `(${t.unit})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Thanh chuyển đổi Ngắn hạn / Dài hạn + Mốc thời gian trên 1 hàng gọn */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-border bg-secondary/50 p-0.5">
              <button
                type="button"
                onClick={() => setMode('short')}
                className={cn(
                  'rounded-lg px-3 py-1 text-xs font-medium transition-all',
                  mode === 'short'
                    ? 'bg-primary text-primary-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Ngắn hạn
              </button>
              <button
                type="button"
                onClick={() => setMode('long')}
                className={cn(
                  'rounded-lg px-3 py-1 text-xs font-medium transition-all',
                  mode === 'long'
                    ? 'bg-primary text-primary-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Dài hạn
              </button>
            </div>

            <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card p-0.5">
              {activeHorizons.map((h) => {
                const active = h.key === horizon;
                return (
                  <button
                    key={h.key}
                    type="button"
                    onClick={() => (mode === 'short' ? setShortHorizon(h.key) : setLongHorizon(h.key))}
                    className={cn(
                      'rounded-lg px-2.5 py-1 text-xs font-medium transition-all',
                      active
                        ? 'bg-primary/15 text-primary font-semibold'
                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
                    )}
                  >
                    {h.label}
                  </button>
                );
              })}
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
              onClick={() => q.refetch()}
              disabled={q.isFetching}
              title="Làm mới dự báo"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', q.isFetching && 'animate-spin')} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5 space-y-4">
        {/* Dải 3 thẻ KPI + Khuyến nghị ngắn gọn */}
        {summary && !isStale && (
          <div className="grid gap-3 sm:grid-cols-12">
            <div className="sm:col-span-3 rounded-xl border border-border/80 bg-secondary/25 px-3.5 py-3 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">Số liệu gần nhất</span>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-display text-2xl font-bold text-foreground">
                  {fmtNum(summary.lastObs.v, tDef?.digits ?? 1)}
                </span>
                <span className="text-xs text-muted-foreground">{tDef?.unit}</span>
              </div>
              <span className="mt-1 text-[11px] text-muted-foreground truncate">
                {fmtDateTime(summary.lastObs.ts)}
              </span>
            </div>

            <div className="sm:col-span-3 rounded-xl border border-border/80 bg-secondary/25 px-3.5 py-3 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">
                Dự báo sau {hDef?.label ?? horizon}
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-2xl font-bold text-primary">
                  {fmtNum(summary.endFc.yhat, (tDef?.digits ?? 1) + 1)}
                </span>
                <span className="text-xs text-muted-foreground">{tDef?.unit}</span>
                <span
                  className={cn(
                    'ml-auto inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
                    Math.abs(summary.delta) < 0.05
                      ? 'bg-muted text-muted-foreground'
                      : summary.delta > 0
                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      : 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
                  )}
                >
                  {Math.abs(summary.delta) < 0.05 ? (
                    <Minus className="h-3 w-3" />
                  ) : summary.delta > 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {summary.delta > 0 ? '+' : ''}
                  {fmtNum(summary.delta, tDef?.digits ?? 1)}
                </span>
              </div>
              <span className="mt-1 text-[11px] text-muted-foreground truncate">
                {summary.endFc.lo !== undefined && summary.endFc.hi !== undefined
                  ? `Khoảng: ${fmtNum(summary.endFc.lo, tDef?.digits ?? 1)} – ${fmtNum(summary.endFc.hi, tDef?.digits ?? 1)} ${tDef?.unit ?? ''}`
                  : fmtDateTime(summary.endFc.ts)}
              </span>
            </div>

            <div
              className={cn(
                'sm:col-span-6 rounded-xl border px-4 py-3 flex items-center gap-3',
                summary.status === 'ok'
                  ? 'border-emerald-500/25 bg-emerald-500/[0.04]'
                  : 'border-amber-500/35 bg-amber-500/[0.06]',
              )}
            >
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                  summary.status === 'ok'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                )}
              >
                {summary.status === 'ok' ? (
                  <Sprout className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">Đề xuất chăm sóc</span>
                  {optimal && (
                    <span className="rounded-md bg-background/80 border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground">
                      Ngưỡng chuẩn: {optimal.min}–{optimal.max} {optimal.unit}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{summary.advice}</p>
              </div>
            </div>
          </div>
        )}

        {/* Biểu đồ dự báo tinh gọn */}
        <div className={cn('h-64 sm:h-72 relative', isStale && 'opacity-60 transition-opacity')}>
          {q.isLoading ? (
            <ChartSkeleton className="h-full" />
          ) : q.isError && (!data || !q.isFetching) ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} className="h-full" />
          ) : !chart || chart.rows.length === 0 ? (
            <EmptyState message="Chưa có dữ liệu dự báo cho thông số này" className="h-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart.rows} margin={{ top: 8, right: 10, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="userFcBand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={tick}
                  minTickGap={35}
                  {...axisProps}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  width={44}
                  {...axisProps}
                  tickFormatter={(v: number) => fmtNum(v, tDef?.digits ?? 1)}
                />
                <RTooltip
                  content={
                    <EndUserForecastTooltip unit={tDef?.unit ?? ''} digits={(tDef?.digits ?? 1) + 1} />
                  }
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {chart.hasBand && (
                  <Area
                    type="monotone"
                    dataKey="band"
                    name="Khoảng dự kiến"
                    stroke="none"
                    fill="url(#userFcBand)"
                    isAnimationActive={false}
                    connectNulls
                    activeDot={false}
                  />
                )}
                {optimal && (
                  <>
                    <ReferenceLine
                      y={optimal.min}
                      stroke="hsl(var(--warning))"
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                    />
                    <ReferenceLine
                      y={optimal.max}
                      stroke="hsl(var(--warning))"
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                    />
                  </>
                )}
                <Line
                  type="monotone"
                  dataKey="obs"
                  name="Thực tế"
                  stroke={tDef?.color ?? 'hsl(var(--foreground))'}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="yhat"
                  name="Dự báo"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.25}
                  strokeDasharray="6 4"
                  dot={chart.rows.filter((r) => r.obs === undefined).length <= 3 ? { r: 3 } : false}
                  isAnimationActive={false}
                  connectNulls
                />
                {chart.nowTs !== undefined && (
                  <ReferenceLine
                    x={chart.nowTs}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="3 3"
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default UserForecastSection;
