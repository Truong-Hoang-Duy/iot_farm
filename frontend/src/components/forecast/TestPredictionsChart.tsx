import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Brush, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FlaskConical } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  GROUP_LABELS,
  HORIZON_MAP,
  MODELS,
  TARGETS,
  TARGET_MAP,
  backendAPI,
  modelColor,
  modelLabel,
  queryKeys,
  shouldRetry,
  type HorizonGroup,
} from '@/services/backendAPI';
import { ChartSkeleton, EmptyState, ErrorState } from './StateViews';
import { axisProps, downsample, fmtDateTime, fmtNum, makeTimeTick, tooltipContentStyle } from './chartUtils';

type Row = { ts: number; actual?: number } & Record<string, number | undefined>;

export function TestPredictionsChart({ defaultTarget = 'moisture' }: { defaultTarget?: string }) {
  const [target, setTarget] = useState(defaultTarget);
  const [group, setGroup] = useState<HorizonGroup>('short');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const lastDays = group === 'long' ? 30 : 7;

  const q = useQuery({
    queryKey: [...queryKeys.testPredictions(target, group), lastDays],
    queryFn: ({ signal }) => backendAPI.getTestPredictions({ target, group, last_days: lastDays }, signal),
    staleTime: 5 * 60_000,
    retry: shouldRetry,
  });

  const tDef = TARGET_MAP[target];
  const data = q.data;

  const models = useMemo(() => {
    if (!data) return [];
    const order = MODELS.map((m) => m.key);
    return Object.keys(data.predictions)
      .filter((k) => data.predictions[k].length > 0)
      .sort((a, b) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)));
  }, [data]);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const map = new Map<number, Row>();
    for (const p of data.actual) {
      const r = map.get(p.ts) ?? { ts: p.ts };
      r.actual = p.v;
      map.set(p.ts, r);
    }
    for (const m of models) {
      for (const p of data.predictions[m]) {
        const r = map.get(p.ts) ?? { ts: p.ts };
        r[m] = p.yhat;
        map.set(p.ts, r);
      }
    }
    return downsample(
      [...map.values()].sort((a, b) => a.ts - b.ts),
      1500,
    );
  }, [data, models]);

  const span = rows.length > 1 ? rows[rows.length - 1].ts - rows[0].ts : 86400_000;
  const tick = useMemo(() => makeTimeTick(span), [span]);

  const toggle = (m: string) =>
    setHidden((prev) => {
      const n = new Set(prev);
      if (n.has(m)) n.delete(m);
      else n.add(m);
      return n;
    });

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg sm:text-xl font-semibold flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            Dự báo vs Thực tế trên tập test
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Dữ liệu test (20% cuối) – mô hình không nhìn thấy khi huấn luyện · hiển thị {lastDays} ngày cuối
            {data?.horizon ? ` · horizon ${HORIZON_MAP[data.horizon]?.label ?? data.horizon}` : ''}
            {data?.origins ? ` · ${data.origins} thời điểm phát dự báo` : ''}
          </p>
          {data?.description && <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">{data.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TARGETS.map((t) => (
                <SelectItem key={t.key} value={t.key} className="text-xs">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={group} onValueChange={(v) => setGroup(v as HorizonGroup)}>
            <SelectTrigger className="h-8 w-[190px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="short" className="text-xs">
                {GROUP_LABELS.short}
              </SelectItem>
              <SelectItem value="long" className="text-xs">
                {GROUP_LABELS.long}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {models.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="px-3 py-1 rounded-full text-xs font-medium bg-foreground text-background">Thực tế</span>
          {models.map((m, i) => (
            <button
              key={m}
              onClick={() => toggle(m)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-all border',
                hidden.has(m) ? 'bg-secondary text-muted-foreground border-transparent' : 'text-white border-transparent',
              )}
              style={{ backgroundColor: hidden.has(m) ? undefined : modelColor(m, i) }}
            >
              {modelLabel(m)}
            </button>
          ))}
        </div>
      )}

      <div className="h-80">
        {q.isLoading ? (
          <ChartSkeleton className="h-full" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} className="h-full" showTrainLink={false} />
        ) : rows.length === 0 ? (
          <EmptyState message="Chưa có dự báo trên tập test cho lựa chọn này" className="h-full" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tick} minTickGap={40} {...axisProps} />
              <YAxis domain={['auto', 'auto']} width={45} {...axisProps} tickFormatter={(v: number) => fmtNum(v, tDef?.digits ?? 1)} />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelFormatter={(l: number) => fmtDateTime(l)}
                formatter={(v: number, name: string) => [`${fmtNum(v, (tDef?.digits ?? 1) + 1)} ${tDef?.unit ?? ''}`, name === 'actual' ? 'Thực tế' : modelLabel(name)]}
              />
              <Legend wrapperStyle={{ fontSize: '11px' }} formatter={(v: string) => (v === 'actual' ? 'Thực tế' : modelLabel(v))} />
              <Line
                type="monotone"
                dataKey="actual"
                name="actual"
                stroke="hsl(var(--foreground))"
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              {models
                .filter((m) => !hidden.has(m))
                .map((m) => (
                  <Line
                    key={m}
                    type="monotone"
                    dataKey={m}
                    name={m}
                    stroke={modelColor(m, models.indexOf(m))}
                    strokeWidth={1.6}
                    strokeDasharray="6 4"
                    dot={false}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              {rows.length > 60 && (
                <Brush dataKey="ts" height={22} stroke="hsl(var(--primary))" tickFormatter={tick} travellerWidth={8} />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
