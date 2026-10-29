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
import { BrainCircuit, Clock, Cpu, Info, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  HORIZONS,
  HORIZON_MAP,
  MODELS,
  TARGETS,
  TARGET_MAP,
  forecastQuery,
  modelLabel,
  modelsQuery,
  type ForecastResponse,
  type HorizonMetrics,
} from '@/services/backendAPI';
import { ChartSkeleton, EmptyState, ErrorState } from './StateViews';
import { axisProps, downsample, fmtDateTime, fmtNum, fmtRelative, makeTimeTick, tooltipContentStyle } from './chartUtils';

export interface ForecastPanelProps {
  defaultTarget?: string;
  className?: string;
}

interface ChartRow {
  ts: number;
  obs?: number;
  yhat?: number;
  band?: [number, number];
}

const SHORT_HORIZONS = HORIZONS.filter((h) => h.group === 'short');
const LONG_HORIZONS = HORIZONS.filter((h) => h.group === 'long');

function buildChartData(data: ForecastResponse, horizonMinutes: number): { rows: ChartRow[]; nowTs?: number; hasBand: boolean } {
  const hist = data.history.filter((p) => p.v !== undefined);
  const lastHist = hist[hist.length - 1];
  const nowTs = data.last_observation_ts ?? lastHist?.ts ?? data.issued_ts;

  // Cửa sổ lịch sử hiển thị: gấp 4 lần horizon, tối thiểu 3h (ngắn hạn) / 3 ngày (dài hạn)
  const minWindow = data.group === 'long' ? 3 * 86400_000 : 3 * 3600_000;
  const windowMs = Math.max(horizonMinutes * 60_000 * 4, minWindow);
  const refTs = lastHist?.ts ?? nowTs ?? Date.now();
  const visibleHist = downsample(
    hist.filter((p) => p.ts >= refTs - windowMs),
    500,
  );

  const map = new Map<number, ChartRow>();
  for (const p of visibleHist) map.set(p.ts, { ts: p.ts, obs: p.v });

  const hasBand = data.forecast.some((p) => p.lo !== undefined && p.hi !== undefined);

  // Điểm nối: forecast bắt đầu từ quan sát cuối cùng
  if (lastHist && lastHist.v !== undefined) {
    const row = map.get(lastHist.ts) ?? { ts: lastHist.ts, obs: lastHist.v };
    row.yhat = lastHist.v;
    if (hasBand) row.band = [lastHist.v, lastHist.v];
    map.set(lastHist.ts, row);
  }

  for (const p of downsample(data.forecast, 400)) {
    if (p.yhat === undefined) continue;
    const row = map.get(p.ts) ?? { ts: p.ts };
    row.yhat = p.yhat;
    if (p.lo !== undefined && p.hi !== undefined) row.band = [Math.min(p.lo, p.hi), Math.max(p.lo, p.hi)];
    map.set(p.ts, row);
  }

  return { rows: [...map.values()].sort((a, b) => a.ts - b.ts), nowTs, hasBand };
}

function ForecastTooltip({
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
          <span className="inline-block h-0.5 w-4 bg-foreground" /> Thực tế: <b>{fmtNum(row.obs, digits)}</b> {unit}
        </p>
      )}
      {row.yhat !== undefined && row.obs === undefined && (
        <p className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-primary" /> Dự báo:{' '}
          <b>{fmtNum(row.yhat, digits)}</b> {unit}
        </p>
      )}
      {row.band && row.obs === undefined && (
        <p className="text-muted-foreground">
          Khoảng 80%: {fmtNum(row.band[0], digits)} – {fmtNum(row.band[1], digits)} {unit}
        </p>
      )}
    </div>
  );
}

function MetricPill({ label, value, unit, hint, tone }: { label: string; value?: number; unit?: string; hint: string; tone?: 'good' | 'bad' }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs cursor-help',
            tone === 'good' && 'border-success/30 bg-success/10',
            tone === 'bad' && 'border-warning/30 bg-warning/10',
            !tone && 'border-border bg-secondary/40',
          )}
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="font-semibold">{fmtNum(value, 3)}</span>
          {unit && value !== undefined && <span className="text-muted-foreground">{unit}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}

function MetricsRow({ m, unit }: { m?: HorizonMetrics; unit: string }) {
  if (!m) return <span className="text-xs text-muted-foreground">Chưa có chỉ số đánh giá cho horizon này</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-muted-foreground" title="Chỉ số trên tập test, tính trung bình sai số của các bước 1..k (k = horizon)">
        Sai số test (bước 1..k):
      </span>
      <MetricPill label="MAE" value={m.mae} unit={unit} hint="Sai số tuyệt đối trung bình trên tập test (đúng đơn vị đo). Càng nhỏ càng tốt." />
      <MetricPill label="RMSE" value={m.rmse} unit={unit} hint="Căn bậc hai của sai số bình phương trung bình – phạt nặng các sai số lớn." />
      <MetricPill
        label="MASE"
        value={m.mase}
        tone={m.mase === undefined ? undefined : m.mase < 1 ? 'good' : 'bad'}
        hint="MASE = MAE của mô hình ÷ MAE của Seasonal Naive (chu kỳ 1 ngày). MASE < 1 nghĩa là tốt hơn baseline; > 1 là kém hơn baseline (Hyndman & Koehler, 2006)."
      />
      {m.coverage80 !== undefined && (
        <MetricPill
          label="Cov80"
          value={m.coverage80}
          hint="Tỷ lệ giá trị thật rơi vào khoảng dự báo 80%. Lý tưởng ≈ 0,8."
        />
      )}
    </div>
  );
}

export function ForecastPanel({ defaultTarget = 'moisture', className }: ForecastPanelProps) {
  const [target, setTarget] = useState(TARGET_MAP[defaultTarget] ? defaultTarget : 'moisture');
  const [horizon, setHorizon] = useState('6h');
  const [model, setModel] = useState('best');

  const q = useQuery({ ...forecastQuery(target, horizon, model), placeholderData: keepPreviousData });
  const modelsQ = useQuery(modelsQuery());

  const tDef = TARGET_MAP[target];
  const hDef = HORIZON_MAP[horizon];
  const data = q.data;
  const isStale = !!data && (data.target !== target || data.horizon !== horizon);

  const chart = useMemo(() => (data ? buildChartData(data, HORIZON_MAP[data.horizon]?.minutes ?? hDef.minutes) : null), [data, hDef.minutes]);
  const span = chart && chart.rows.length > 1 ? chart.rows[chart.rows.length - 1].ts - chart.rows[0].ts : 86400_000;
  const tick = useMemo(() => makeTimeTick(span), [span]);

  const availability = useMemo(() => {
    const m = new Map<string, boolean | undefined>();
    for (const x of modelsQ.data ?? []) m.set(x.key, x.available);
    return m;
  }, [modelsQ.data]);

  const chosenLabel = data ? data.model_label ?? modelLabel(data.model) : undefined;
  const lastForecast = useMemo(() => {
    const f = data?.forecast.filter((p) => p.yhat !== undefined) ?? [];
    return f.length ? f[f.length - 1] : undefined;
  }, [data]);

  return (
    <TooltipProvider delayDuration={150}>
      <Card className={cn('rounded-2xl', className)}>
        <CardHeader className="p-4 sm:p-6 pb-3 sm:pb-4 space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1.5">
              <h3 className="font-display text-lg sm:text-xl font-semibold flex items-center gap-2">
                <BrainCircuit className="h-5 w-5 text-primary" />
                Dự báo AI – {tDef?.label ?? target}
              </h3>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {chosenLabel && (
                  <Badge variant="secondary" className="gap-1">
                    {model === 'best' ? `Tốt nhất: ${chosenLabel}` : chosenLabel}
                  </Badge>
                )}
                {data?.device && (
                  <Badge variant="outline" className="gap-1 font-normal">
                    <Cpu className="h-3 w-3" /> {data.device.toUpperCase()}
                  </Badge>
                )}
                {data?.issued_ts && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Phát lúc {fmtDateTime(data.issued_ts)} ({fmtRelative(data.issued_ts)})
                  </span>
                )}
                {q.isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
              </div>
              {data && !isStale && (data.origin_ts ?? data.last_observation_ts) !== undefined && (
                <p className="text-xs font-medium text-foreground/80">
                  Dự báo từ quan sát cuối: {fmtDateTime(data.origin_ts ?? data.last_observation_ts)}
                  <span className="font-normal text-muted-foreground"> ({fmtRelative(data.origin_ts ?? data.last_observation_ts)})</span>
                  {data.data_source && <span className="font-normal text-muted-foreground"> · nguồn: {data.data_source}</span>}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="h-8 w-[150px] text-xs">
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
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="h-8 w-[190px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => {
                    const av = availability.get(m.key);
                    return (
                      <SelectItem key={m.key} value={m.key} className="text-xs">
                        {m.key === 'best' && model === 'best' && chosenLabel ? `Tốt nhất (${chosenLabel})` : m.label}
                        {av === false ? ' · chưa train' : ''}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => q.refetch()}
                disabled={q.isFetching}
                title="Làm mới"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', q.isFetching && 'animate-spin')} />
              </Button>
            </div>
          </div>

          {/* Horizon tabs */}
          <Tabs value={horizon} onValueChange={setHorizon}>
            <div className="overflow-x-auto -mx-1 px-1 pb-1">
              <TabsList className="h-auto w-max justify-start gap-0.5 p-1">
                <span className="px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ngắn hạn</span>
                {SHORT_HORIZONS.map((h) => (
                  <TabsTrigger key={h.key} value={h.key} className="px-2.5 py-1 text-xs" title={h.label}>
                    {h.label}
                  </TabsTrigger>
                ))}
                <span className="mx-1.5 h-5 w-px bg-border" />
                <span className="px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Dài hạn</span>
                {LONG_HORIZONS.map((h) => (
                  <TabsTrigger key={h.key} value={h.key} className="px-2.5 py-1 text-xs" title={h.label}>
                    {h.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>

          {data && !isStale && <MetricsRow m={data.metrics_at_horizon} unit={data.unit ?? tDef?.unit ?? ''} />}
          {data && !isStale && (data.note || data.context_valid === false) && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning" />
              <span>
                {data.context_valid === false && <b>Ngữ cảnh đầu vào chưa đủ / không liên tục. </b>}
                {data.note}
              </span>
            </div>
          )}
          {data && !isStale && data.requested_model && data.requested_model !== data.model && data.requested_model !== 'best' && (
            <p className="text-[11px] text-muted-foreground">
              Đã yêu cầu {modelLabel(data.requested_model)} nhưng backend dùng {chosenLabel}.
            </p>
          )}
        </CardHeader>

        <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
          <div className={cn('h-64 sm:h-80 relative', isStale && 'opacity-60 transition-opacity')}>
            {q.isLoading ? (
              <ChartSkeleton className="h-full" />
            ) : q.isError && (!data || !q.isFetching) ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} className="h-full" />
            ) : !chart || chart.rows.length === 0 ? (
              <EmptyState message="Chưa có dữ liệu dự báo cho lựa chọn này" className="h-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart.rows} margin={{ top: 10, right: 10, left: -5, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fcBand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.12} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="ts"
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    tickFormatter={tick}
                    minTickGap={30}
                    {...axisProps}
                  />
                  <YAxis domain={['auto', 'auto']} width={45} {...axisProps} tickFormatter={(v: number) => fmtNum(v, tDef?.digits ?? 1)} />
                  <RTooltip content={<ForecastTooltip unit={tDef?.unit ?? ''} digits={(tDef?.digits ?? 1) + 1} />} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  {chart.hasBand && (
                    <Area
                      type="monotone"
                      dataKey="band"
                      name="Khoảng tin cậy 80%"
                      stroke="none"
                      fill="url(#fcBand)"
                      isAnimationActive={false}
                      connectNulls
                      activeDot={false}
                    />
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
                    name={`Dự báo (${chosenLabel ?? modelLabel(model)})`}
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
                      label={{
                        value: Date.now() - chart.nowTs > 2 * 3600_000 ? 'Quan sát cuối' : 'Hiện tại',
                        position: 'insideTopRight',
                        fontSize: 10,
                        fill: 'hsl(var(--muted-foreground))',
                      }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          {data && !isStale && lastForecast && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Info className="h-3 w-3" />
                Sau {HORIZON_MAP[data.horizon]?.label ?? data.horizon} ({fmtDateTime(lastForecast.ts)}):{' '}
                <b className="text-foreground">
                  {fmtNum(lastForecast.yhat, (tDef?.digits ?? 1) + 1)} {data.unit ?? tDef?.unit}
                </b>
                {lastForecast.lo !== undefined && lastForecast.hi !== undefined && (
                  <span>
                    {' '}
                    (80%: {fmtNum(lastForecast.lo, tDef?.digits ?? 1)} – {fmtNum(lastForecast.hi, tDef?.digits ?? 1)})
                  </span>
                )}
              </span>
              {data.resolution_minutes && <span>Độ phân giải: {data.resolution_minutes >= 60 ? `${data.resolution_minutes / 60} giờ` : `${data.resolution_minutes} phút`}</span>}
              <span>Tự làm mới mỗi 5 phút</span>
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}

export default ForecastPanel;
