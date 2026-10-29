import { useMemo } from 'react';
import { Grid3x3, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { targetLabel, weatherVarLabel, type CorrelationResponse } from '@/services/backendAPI';
import { corrColor, corrTextColor, fmtNum } from '@/components/forecast/chartUtils';

export function strengthLabel(r: number): string {
  const a = Math.abs(r);
  if (a >= 0.7) return 'rất mạnh';
  if (a >= 0.5) return 'mạnh';
  if (a >= 0.3) return 'trung bình';
  if (a >= 0.1) return 'yếu';
  return 'không đáng kể';
}

export function CorrelationHeatmap({ data }: { data: CorrelationResponse }) {
  const { variables_weather: rows, variables_sensor: cols, matrix } = data;
  if (!rows.length || !cols.length) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Grid3x3 className="h-4 w-4 text-primary" />
        Ma trận tương quan {data.method === 'spearman' ? 'Spearman ρ' : 'Pearson r'} (hàng: thời tiết · cột: cảm biến)
      </h3>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-card z-10 min-w-[140px]" />
              {cols.map((c) => (
                <th key={c} className="px-1 py-1.5 font-medium text-muted-foreground whitespace-nowrap min-w-[64px]">
                  {targetLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((w, i) => (
              <tr key={w}>
                <td className="sticky left-0 bg-card z-10 pr-2 py-1 text-right font-medium whitespace-nowrap">{weatherVarLabel(w)}</td>
                {cols.map((c, j) => {
                  const r = matrix[i]?.[j] ?? null;
                  const p = data.pvalues?.[i]?.[j] ?? null;
                  const sig = p !== null && p < 0.05;
                  return (
                    <td
                      key={c}
                      className="h-9 rounded-md text-center tabular-nums font-medium"
                      style={{ backgroundColor: corrColor(r), color: corrTextColor(r) }}
                      title={
                        r === null
                          ? 'Không đủ dữ liệu'
                          : `${weatherVarLabel(w)} ↔ ${targetLabel(c)}: ${fmtNum(r, 3)} (${strengthLabel(r)})${p !== null ? ` · p = ${p < 0.001 ? '< 0,001' : fmtNum(p, 3)}` : ''}`
                      }
                    >
                      {r === null ? '—' : r.toFixed(2)}
                      {sig && <sup className="ml-0.5">*</sup>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Thang màu */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>−1</span>
        <div
          className="h-2.5 w-48 rounded-full border border-border"
          style={{ background: `linear-gradient(to right, ${corrColor(-1)}, ${corrColor(-0.5)}, ${corrColor(0)}, ${corrColor(0.5)}, ${corrColor(1)})` }}
        />
        <span>+1</span>
        <span className="ml-2">Đỏ: tương quan nghịch · Xanh: tương quan thuận{data.n ? ` · n = ${fmtNum(data.n, 0)} điểm giờ` : ''}{data.pvalues ? ' · * p < 0,05' : ''}</span>
      </div>
    </div>
  );
}

export function LagTable({ data, limit = 15 }: { data: CorrelationResponse; limit?: number }) {
  const items = useMemo(() => {
    const out: { w: string; s: string; r0: number | null; lag: number | null; rl: number | null }[] = [];
    if (!data.lag) return out;
    data.variables_weather.forEach((w, i) =>
      data.variables_sensor.forEach((s, j) => {
        out.push({
          w,
          s,
          r0: data.matrix[i]?.[j] ?? null,
          lag: data.lag!.best_lag_h[i]?.[j] ?? null,
          rl: data.lag!.best_corr[i]?.[j] ?? null,
        });
      }),
    );
    return out.filter((x) => x.rl !== null).sort((a, b) => Math.abs(b.rl!) - Math.abs(a.rl!));
  }, [data]);

  if (!data.lag) return <p className="text-xs text-muted-foreground">Backend chưa trả về phân tích độ trễ.</p>;
  if (!items.length) return <p className="text-xs text-muted-foreground">Không đủ dữ liệu cho phân tích độ trễ.</p>;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Timer className="h-4 w-4 text-primary" />
        Phân tích độ trễ (cross-correlation, tối đa {data.max_lag_h ?? 24}h) – {Math.min(limit, items.length)} cặp mạnh nhất
      </h3>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left font-medium px-3 py-2">Thời tiết</th>
              <th className="text-left font-medium px-3 py-2">Cảm biến</th>
              <th className="text-center font-medium px-3 py-2">r (trễ 0)</th>
              <th className="text-center font-medium px-3 py-2">Độ trễ tối ưu</th>
              <th className="text-center font-medium px-3 py-2">r tại độ trễ</th>
              <th className="text-left font-medium px-3 py-2">Mức độ</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, limit).map((x) => (
              <tr key={`${x.w}|${x.s}`} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5">{weatherVarLabel(x.w)}</td>
                <td className="px-3 py-1.5">{targetLabel(x.s)}</td>
                <td className="px-3 py-1.5 text-center tabular-nums">{x.r0 === null ? '—' : x.r0.toFixed(2)}</td>
                <td className="px-3 py-1.5 text-center tabular-nums font-medium">{x.lag === null ? '—' : `${x.lag > 0 ? '+' : ''}${x.lag} h`}</td>
                <td className="px-3 py-1.5 text-center">
                  <span
                    className="inline-block rounded-md px-2 py-0.5 tabular-nums font-semibold"
                    style={{ backgroundColor: corrColor(x.rl), color: corrTextColor(x.rl) }}
                  >
                    {x.rl!.toFixed(2)}
                  </span>
                </td>
                <td className={cn('px-3 py-1.5', Math.abs(x.rl!) >= 0.5 ? 'font-medium' : 'text-muted-foreground')}>
                  {x.rl! >= 0 ? 'Thuận' : 'Nghịch'}, {strengthLabel(x.rl!)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Độ trễ dương = biến thời tiết đi trước biến cảm biến (vd. mưa hôm nay → độ ẩm đất tăng sau vài giờ).
      </p>
    </div>
  );
}
