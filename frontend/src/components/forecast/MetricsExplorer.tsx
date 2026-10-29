import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Award, LineChart as LineChartIcon, Table2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  HORIZONS,
  METRICS,
  METRIC_MAP,
  MODELS,
  TARGETS,
  TARGET_MAP,
  modelColor,
  modelLabel,
  type MetricKey,
  type MetricRow,
} from '@/services/backendAPI';
import { EmptyState } from './StateViews';
import { axisProps, fmtNum, tooltipContentStyle } from './chartUtils';

/** Thêm alpha cho màu hsl(...) */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('hsl(') && !color.includes('var(')) return color.replace('hsl(', 'hsla(').replace(/\)$/, `, ${alpha})`);
  if (color.includes('var(')) return color.replace(/\)$/, ` / ${alpha})`);
  return color;
}

function score(metric: MetricKey, v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  const d = METRIC_MAP[metric];
  if (d.better === 'higher') return -v;
  if (d.better === 'target80') return Math.abs(v - (v > 1.5 ? 80 : 0.8));
  return v;
}

function orderModels(keys: string[]): string[] {
  const order = MODELS.map((m) => m.key);
  return [...keys].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}

/** Mô hình tốt nhất cho (target, horizon): MASE thấp nhất (fallback MAE). */
export function bestModelFor(rows: MetricRow[], target: string, horizon: string): MetricRow | undefined {
  const cand = rows.filter((r) => r.target === target && r.horizon === horizon);
  const withMase = cand.filter((r) => r.mase !== undefined);
  const pool = withMase.length ? withMase : cand.filter((r) => r.mae !== undefined);
  const key: 'mase' | 'mae' = withMase.length ? 'mase' : 'mae';
  return pool.reduce<MetricRow | undefined>((best, r) => (!best || (r[key] as number) < (best[key] as number) ? r : best), undefined);
}

export function MetricsExplorer({ rows }: { rows: MetricRow[] }) {
  const targetsWithData = useMemo(() => TARGETS.filter((t) => rows.some((r) => r.target === t.key)), [rows]);
  const [target, setTarget] = useState<string>(() => (rows.some((r) => r.target === 'moisture') ? 'moisture' : rows[0]?.target ?? 'moisture'));
  const [metric, setMetric] = useState<MetricKey>('mase');
  const mDef = METRIC_MAP[metric];
  const tDef = TARGET_MAP[target];

  const tRows = useMemo(() => rows.filter((r) => r.target === target), [rows, target]);
  const models = useMemo(() => orderModels([...new Set(tRows.map((r) => r.model))]), [tRows]);
  const horizons = useMemo(() => HORIZONS.filter((h) => tRows.some((r) => r.horizon === h.key)), [tRows]);

  const lookup = useMemo(() => {
    const m = new Map<string, MetricRow>();
    for (const r of tRows) m.set(`${r.model}|${r.horizon}`, r);
    return m;
  }, [tRows]);

  const chartData = useMemo(
    () =>
      horizons.map((h) => {
        const row: Record<string, string | number | undefined> = { horizon: h.label };
        for (const m of models) row[m] = lookup.get(`${m}|${h.key}`)?.[metric];
        return row;
      }),
    [horizons, models, lookup, metric],
  );

  const bestPerHorizon = useMemo(() => {
    const out: Record<string, string | undefined> = {};
    for (const h of horizons) {
      let best: string | undefined;
      let bestScore = Infinity;
      for (const m of models) {
        const s = score(metric, lookup.get(`${m}|${h.key}`)?.[metric]);
        if (s !== undefined && s < bestScore) {
          bestScore = s;
          best = m;
        }
      }
      out[h.key] = best;
    }
    return out;
  }, [horizons, models, lookup, metric]);

  const unitSuffix = metric === 'mae' || metric === 'rmse' ? (tDef?.unit ? ` (${tDef.unit})` : '') : mDef.percent ? ' (%)' : '';

  if (rows.length === 0) {
    return <EmptyState message="Chưa có bảng chỉ số – hãy huấn luyện mô hình trước." className="h-40" />;
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(targetsWithData.length ? targetsWithData : TARGETS).map((t) => (
              <SelectItem key={t.key} value={t.key} className="text-xs">
                {t.label}
                {t.unit ? ` (${t.unit})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap rounded-lg border border-border p-0.5 bg-secondary/50">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              title={m.description}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                metric === m.key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {mDef.description}. {mDef.better === 'lower' ? 'Càng thấp càng tốt.' : mDef.better === 'higher' ? 'Càng cao càng tốt.' : 'Càng gần 80% càng tốt.'}
        </span>
      </div>

      {/* Line chart error vs horizon */}
      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <LineChartIcon className="h-4 w-4 text-primary" />
          {mDef.label}
          {unitSuffix} theo horizon – {tDef?.label ?? target}
        </h3>
        <div className="h-72">
          {chartData.length === 0 ? (
            <EmptyState message="Không có dữ liệu cho biến này" className="h-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -5, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="horizon" {...axisProps} />
                <YAxis {...axisProps} width={50} tickFormatter={(v: number) => fmtNum(v, 3)} />
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  formatter={(v: number, name: string) => [fmtNum(v, 4), modelLabel(name)]}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} formatter={(v: string) => modelLabel(v)} />
                {models.map((m, i) => {
                  const baseline = m === 'naive' || m === 'seasonal_naive';
                  return (
                    <Line
                      key={m}
                      type="monotone"
                      dataKey={m}
                      name={m}
                      stroke={modelColor(m, i)}
                      strokeWidth={baseline ? 1.5 : 2.25}
                      strokeDasharray={baseline ? '4 3' : undefined}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        {metric === 'mase' && (
          <p className="text-[11px] text-muted-foreground mt-1">MASE &lt; 1 ⇒ mô hình tốt hơn Seasonal Naive (chu kỳ 1 ngày).</p>
        )}
      </div>

      {/* Table models × horizons */}
      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Table2 className="h-4 w-4 text-primary" />
          Bảng {mDef.label} – mô hình × horizon (ô màu xanh = tốt nhất của cột)
        </h3>
        <div className="rounded-xl border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-card z-10 min-w-[130px]">Mô hình</TableHead>
                {horizons.map((h) => (
                  <TableHead key={h.key} className="text-center whitespace-nowrap text-xs">
                    {h.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((m, i) => (
                <TableRow key={m}>
                  <TableCell className="sticky left-0 bg-card z-10 font-medium text-xs">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: modelColor(m, i) }} />
                      {modelLabel(m)}
                    </span>
                  </TableCell>
                  {horizons.map((h) => {
                    const v = lookup.get(`${m}|${h.key}`)?.[metric];
                    const isBest = bestPerHorizon[h.key] === m;
                    const masePoor = metric === 'mase' && v !== undefined && v >= 1;
                    return (
                      <TableCell
                        key={h.key}
                        className={cn(
                          'text-center text-xs tabular-nums py-2',
                          isBest && 'bg-success/15 font-bold text-success',
                          !isBest && masePoor && 'text-warning',
                        )}
                      >
                        {fmtNum(v, 3)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

/** Lưới "mô hình tốt nhất" theo (biến × horizon), tô màu theo mô hình. Ưu tiên bảng `best` do backend chọn. */
export function BestModelGrid({ rows, best }: { rows: MetricRow[]; best?: Record<string, Record<string, { model: string; mase?: number }>> }) {
  const hasBest = !!best && Object.keys(best).length > 0;
  const targets = TARGETS.filter((t) => rows.some((r) => r.target === t.key) || (hasBest && best![t.key]));
  const horizons = HORIZONS.filter((h) => rows.some((r) => r.horizon === h.key) || (hasBest && Object.values(best!).some((x) => x[h.key])));
  const usedModels = new Set<string>();
  const grid = targets.map((t) =>
    horizons.map((h) => {
      const fromBackend = hasBest ? best![t.key]?.[h.key] : undefined;
      let b: Pick<MetricRow, 'model' | 'mase' | 'mae'> | undefined;
      if (fromBackend) {
        const row = rows.find((r) => r.target === t.key && r.horizon === h.key && r.model === fromBackend.model);
        b = { model: fromBackend.model, mase: fromBackend.mase ?? row?.mase, mae: row?.mae };
      } else {
        b = bestModelFor(rows, t.key, h.key);
      }
      if (b) usedModels.add(b.model);
      return b;
    }),
  );

  if (!targets.length) return <EmptyState message="Chưa có dữ liệu" className="h-32" />;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Award className="h-4 w-4 text-primary" />
        Mô hình tốt nhất cho từng (biến, horizon) – theo MASE thấp nhất trên tập test
      </h3>
      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 bg-card z-10 text-left font-medium text-muted-foreground px-3 py-2 min-w-[120px]">Biến</th>
              {horizons.map((h) => (
                <th key={h.key} className="font-medium text-muted-foreground px-1.5 py-2 whitespace-nowrap">
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {targets.map((t, ti) => (
              <tr key={t.key} className="border-b border-border last:border-0">
                <td className="sticky left-0 bg-card z-10 px-3 py-1.5 font-medium whitespace-nowrap">{t.label}</td>
                {grid[ti].map((b, hi) => {
                  const c = b ? modelColor(b.model) : undefined;
                  return (
                    <td key={horizons[hi].key} className="p-0.5">
                      <div
                        className="rounded-md px-1.5 py-1.5 text-center leading-tight"
                        style={{
                          backgroundColor: c ? withAlpha(c, 0.18) : 'hsl(var(--muted))',
                          border: c ? `1px solid ${withAlpha(c, 0.45)}` : undefined,
                        }}
                        title={b ? `${modelLabel(b.model)} – MASE ${fmtNum(b.mase, 3)}, MAE ${fmtNum(b.mae, 3)}` : 'Chưa có'}
                      >
                        <div className="font-semibold truncate" style={{ color: c }}>
                          {b ? modelLabel(b.model) : '—'}
                        </div>
                        {b?.mase !== undefined && (
                          <div className={cn('text-[10px] tabular-nums', b.mase < 1 ? 'text-success' : 'text-warning')}>{fmtNum(b.mase, 2)}</div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        {orderModels([...usedModels]).map((m) => (
          <span key={m} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: modelColor(m) }} />
            {modelLabel(m)}
          </span>
        ))}
        <span>· Số nhỏ = MASE (xanh &lt; 1: tốt hơn baseline)</span>
      </div>
    </div>
  );
}
