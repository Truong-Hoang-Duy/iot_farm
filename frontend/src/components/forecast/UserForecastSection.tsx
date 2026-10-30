import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
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
  Calendar,
  ArrowRight,
  Check,
  ChevronDown,
  SlidersHorizontal,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

export interface ForecastCompletionPayload {
  lastObsTs?: number;
  horizon: string;
  force?: boolean;
}

export interface UserForecastSectionProps {
  onForecastComplete?: (payload: ForecastCompletionPayload) => void;
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
    lowAdvice: 'Độ ẩm đất dự báo giảm thấp dưới ngưỡng tối ưu. Nên chủ động tưới bù nhỏ giọt để giữ ẩm vùng rễ ớt.',
    highAdvice: 'Độ ẩm đất dự báo vượt ngưỡng 70%. Nên tạm ngưng tưới và kiểm tra rãnh thoát nước luống để phòng ngập rễ.',
    okAdvice: 'Độ ẩm đất dự báo duy trì ổn định trong vùng tối ưu (50–70%) cho bộ rễ cây ớt hấp thu dinh dưỡng.',
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

interface RawValuesByTarget {
  obs?: number;
  yhat?: number;
  lo?: number;
  hi?: number;
}

type MultiChartRow = {
  ts: number;
  _raw: Record<string, RawValuesByTarget>;
  singleBand?: [number, number];
} & Record<string, unknown>;

function buildMultiChartData(
  seriesList: Array<{ key: string; data: ForecastResponse }>,
  horizonMinutes: number,
  normalize: boolean,
): {
  rows: MultiChartRow[];
  nowTs?: number;
  hasSingleBand: boolean;
  inputStartTs?: number;
  lastObsTs?: number;
  forecastEndTs?: number;
} {
  if (seriesList.length === 0) {
    return { rows: [], hasSingleBand: false };
  }

  const firstData = seriesList[0].data;
  const firstHist = firstData.history.filter((p) => p.v !== undefined);
  const lastHist = firstHist[firstHist.length - 1];
  const lastObsTs = firstData.last_observation_ts ?? lastHist?.ts;
  const nowTs = lastObsTs ?? firstData.issued_ts;
  const inputStartTs = firstHist[0]?.ts ?? lastObsTs;

  const firstFc = firstData.forecast.filter((p) => p.yhat !== undefined);
  const forecastEndTs = firstFc.length ? firstFc[firstFc.length - 1].ts : undefined;

  const minWindow = firstData.group === 'long' ? 3 * 86400_000 : 3 * 3600_000;
  const windowMs = Math.max(horizonMinutes * 60_000 * 3.5, minWindow);
  const refTs = lastObsTs ?? nowTs ?? Date.now();

  const map = new Map<number, MultiChartRow>();
  const ensureRow = (ts: number): MultiChartRow => {
    let r = map.get(ts);
    if (!r) {
      r = { ts, _raw: {} };
      map.set(ts, r);
    }
    return r;
  };

  const minMaxByKey = new Map<string, { min: number; max: number }>();

  for (const { key, data } of seriesList) {
    const hist = downsample(
      data.history.filter((p) => p.v !== undefined && p.ts >= refTs - windowMs),
      350,
    );
    const fc = downsample(
      data.forecast.filter((p) => p.yhat !== undefined),
      300,
    );

    const allVals: number[] = [];
    for (const p of hist) if (p.v !== undefined) allVals.push(p.v);
    for (const p of fc) if (p.yhat !== undefined) allVals.push(p.yhat);

    const mn = allVals.length ? Math.min(...allVals) : 0;
    const mx = allVals.length ? Math.max(...allVals) : 1;
    minMaxByKey.set(key, { min: mn, max: mx > mn ? mx : mn + 1 });

    for (const p of hist) {
      const row = ensureRow(p.ts);
      row._raw[key] = { ...(row._raw[key] ?? {}), obs: p.v };
    }

    const lastP = hist[hist.length - 1];
    if (lastP && lastP.v !== undefined) {
      const row = ensureRow(lastP.ts);
      row._raw[key] = {
        ...(row._raw[key] ?? {}),
        obs: lastP.v,
        yhat: lastP.v,
        lo: lastP.v,
        hi: lastP.v,
      };
    }

    for (const p of fc) {
      const row = ensureRow(p.ts);
      row._raw[key] = {
        ...(row._raw[key] ?? {}),
        yhat: p.yhat,
        lo: p.lo,
        hi: p.hi,
      };
    }
  }

  const normVal = (key: string, v: number | undefined): number | undefined => {
    if (v === undefined) return undefined;
    if (!normalize) return v;
    const mm = minMaxByKey.get(key);
    if (!mm) return v;
    return ((v - mm.min) / (mm.max - mm.min)) * 100;
  };

  const isSingle = seriesList.length === 1;
  const singleKey = isSingle ? seriesList[0].key : undefined;
  let hasSingleBand = false;

  const sortedRows = [...map.values()].sort((a, b) => a.ts - b.ts);
  for (const row of sortedRows) {
    for (const { key } of seriesList) {
      const rv = row._raw[key];
      if (!rv) continue;
      if (rv.obs !== undefined) {
        row[`obs_${key}`] = normVal(key, rv.obs);
      }
      if (rv.yhat !== undefined) {
        row[`yhat_${key}`] = normVal(key, rv.yhat);
      }
      if (isSingle && key === singleKey && rv.lo !== undefined && rv.hi !== undefined && !normalize) {
        row.singleBand = [Math.min(rv.lo, rv.hi), Math.max(rv.lo, rv.hi)];
        hasSingleBand = true;
      }
    }
  }

  return {
    rows: sortedRows,
    nowTs,
    hasSingleBand,
    inputStartTs,
    lastObsTs,
    forecastEndTs,
  };
}

function MultiForecastTooltip({
  active,
  payload,
  label,
  selectedKeys,
}: {
  active?: boolean;
  payload?: Array<{ payload?: MultiChartRow }>;
  label?: number;
  selectedKeys: string[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div style={tooltipContentStyle} className="px-3 py-2.5 shadow-md space-y-1.5 min-w-[200px]">
      <p className="font-semibold border-b border-border/60 pb-1">{fmtDateTime(label ?? row.ts)}</p>
      <div className="space-y-1.5">
        {selectedKeys.map((key) => {
          const tDef = TARGET_MAP[key];
          const rv = row._raw?.[key];
          if (!rv || (rv.obs === undefined && rv.yhat === undefined)) return null;
          const isForecastPoint = rv.obs === undefined && rv.yhat !== undefined;
          const val = isForecastPoint ? rv.yhat : rv.obs;
          const digits = (tDef?.digits ?? 1) + (isForecastPoint ? 1 : 0);

          return (
            <div key={key} className="text-xs space-y-0.5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span
                    className="inline-block h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: tDef?.color ?? 'hsl(var(--primary))' }}
                  />
                  {tDef?.label ?? key}
                  <span className="text-[10px] opacity-75">
                    ({isForecastPoint ? 'dự báo' : 'thực tế'})
                  </span>
                </span>
                <b className="text-foreground">
                  {fmtNum(val, digits)} {tDef?.unit}
                </b>
              </div>
              {isForecastPoint && rv.lo !== undefined && rv.hi !== undefined && (
                <p className="text-[10px] text-muted-foreground pl-3.5">
                  Khoảng 80%: {fmtNum(rv.lo, tDef?.digits ?? 1)} – {fmtNum(rv.hi, tDef?.digits ?? 1)} {tDef?.unit}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function UserForecastSection({ onForecastComplete }: UserForecastSectionProps) {
  // Mặc định chỉ chọn 1 thông số quan trọng nhất (Độ ẩm đất - moisture) để demo giao diện gọn đẹp
  const [mode, setMode] = useState<'short' | 'long'>('short');
  const [selectedTargets, setSelectedTargets] = useState<string[]>(['moisture']);
  const [shortHorizon, setShortHorizon] = useState<string>('6h');
  const [longHorizon, setLongHorizon] = useState<string>('3d');
  const [scaleMode, setScaleMode] = useState<'auto' | 'normalized' | 'raw'>('auto');

  const horizon = mode === 'short' ? shortHorizon : longHorizon;
  const hDef = HORIZON_MAP[horizon];

  const queries = useQueries({
    queries: selectedTargets.map((t) => ({
      ...forecastQuery(t, horizon, 'xgboost'),
    })),
  });

  const isLoading = queries.some((q) => q.isLoading && !q.data);
  const isFetching = queries.some((q) => q.isFetching);
  const firstError = queries.find((q) => q.isError)?.error;

  const loadedSeries = useMemo(() => {
    const out: Array<{ key: string; data: ForecastResponse }> = [];
    selectedTargets.forEach((key, idx) => {
      const d = queries[idx]?.data;
      if (d) out.push({ key, data: d });
    });
    return out;
  }, [selectedTargets, queries]);

  const useNormalized = useMemo(() => {
    if (selectedTargets.length <= 1) return false;
    if (scaleMode === 'normalized') return true;
    if (scaleMode === 'raw') return false;
    return selectedTargets.length >= 3;
  }, [selectedTargets.length, scaleMode]);

  const useDualAxis = !useNormalized && selectedTargets.length === 2;

  const chart = useMemo(
    () => buildMultiChartData(loadedSeries, hDef?.minutes ?? 360, useNormalized),
    [loadedSeries, hDef?.minutes, useNormalized],
  );

  // Tự động kích hoạt phân tích cảnh báo hệ thống Gemini khi dự báo mô hình hoàn tất
  const lastNotifiedRef = useRef<string>('');
  useEffect(() => {
    if (!isFetching && loadedSeries.length > 0 && chart.lastObsTs && onForecastComplete) {
      const sig = `${chart.lastObsTs}_${horizon}`;
      if (lastNotifiedRef.current !== sig) {
        lastNotifiedRef.current = sig;
        onForecastComplete({ lastObsTs: chart.lastObsTs, horizon, force: false });
      }
    }
  }, [isFetching, loadedSeries.length, chart.lastObsTs, horizon, onForecastComplete]);

  const span =
    chart.rows.length > 1 ? chart.rows[chart.rows.length - 1].ts - chart.rows[0].ts : 86400_000;
  const tick = useMemo(() => makeTimeTick(span), [span]);

  const summaries = useMemo(() => {
    return loadedSeries
      .map(({ key, data }) => {
        const tDef = TARGET_MAP[key];
        const optimal = CHILI_OPTIMAL_RANGES[key];
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
          key,
          tDef,
          optimal,
          lastObs,
          endFc,
          delta,
          status,
          advice,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [loadedSeries]);

  const toggleTarget = (key: string) => {
    setSelectedTargets((prev) => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev;
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  };

  const handleRefreshAll = () => {
    queries.forEach((q) => q.refetch());
    if (onForecastComplete) {
      onForecastComplete({ lastObsTs: chart.lastObsTs, horizon, force: true });
    }
  };

  const activeHorizons = mode === 'short' ? SHORT_HORIZONS : LONG_HORIZONS;
  const isSingleMode = selectedTargets.length === 1;
  const singleSummary = isSingleMode ? summaries[0] : undefined;
  const singleTargetDef = isSingleMode ? TARGET_MAP[selectedTargets[0]] : undefined;
  const singleOptimal = isSingleMode ? CHILI_OPTIMAL_RANGES[selectedTargets[0]] : undefined;
  const leftTargetDef = TARGET_MAP[selectedTargets[0]];
  const rightTargetDef = useDualAxis ? TARGET_MAP[selectedTargets[1]] : undefined;

  return (
    <Card className="rounded-2xl border-border shadow-xs overflow-hidden">
      {/* Thanh công cụ gọn gàng trên 1 hàng */}
      <CardHeader className="p-4 sm:p-5 pb-3.5 border-b border-border/60 bg-secondary/15">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          {/* Bên trái: Tiêu đề + Mốc ngày tính toán */}
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="font-display text-base sm:text-lg font-semibold flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <TrendingUp className="h-4 w-4" />
              </div>
              Dự báo xu hướng
            </CardTitle>

            {chart.lastObsTs && (
              <div className="inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-border/80 bg-card px-3 py-1 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>
                  Dữ liệu: <b className="text-foreground">{fmtDateTime(chart.inputStartTs)}</b> –{' '}
                  <b className="text-foreground">{fmtDateTime(chart.lastObsTs)}</b>
                </span>
                {chart.forecastEndTs && (
                  <>
                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span>
                      Dự báo tới: <b className="text-primary">{fmtDateTime(chart.forecastEndTs)}</b>
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Bên phải: Popover chọn 1 hoặc nhiều biến + Ngắn/Dài hạn + Mốc thời gian + Làm mới */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Popover chọn biến cảm biến (mặc định 1 biến Độ ẩm đất, bấm vào mới xổ danh sách chọn nhiều biến) */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-xl gap-2 text-xs font-medium bg-card border-border"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
                  {isSingleMode ? (
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: singleTargetDef?.color }}
                      />
                      {singleTargetDef?.label}
                      {singleTargetDef?.unit ? ` (${singleTargetDef.unit})` : ''}
                    </span>
                  ) : (
                    <span>Đã chọn {selectedTargets.length} thông số</span>
                  )}
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3 space-y-2.5 rounded-xl">
                <div className="flex items-center justify-between border-b border-border/60 pb-2">
                  <span className="text-xs font-semibold text-foreground">Chọn thông số dự báo</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedTargets(['moisture'])}
                      className="text-[11px] text-primary hover:underline px-1"
                    >
                      Mặc định (1)
                    </button>
                    <span className="text-muted-foreground text-[10px]">•</span>
                    <button
                      type="button"
                      onClick={() => setSelectedTargets(TARGETS.map((t) => t.key))}
                      className="text-[11px] text-muted-foreground hover:text-foreground px-1"
                    >
                      Tất cả (9)
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1 max-h-64 overflow-y-auto">
                  {TARGETS.map((t) => {
                    const checked = selectedTargets.includes(t.key);
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => toggleTarget(t.key)}
                        className={cn(
                          'flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors',
                          checked
                            ? 'bg-primary/10 text-foreground font-medium'
                            : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: t.color }}
                          />
                          <span>
                            {t.label} {t.unit ? `(${t.unit})` : ''}
                          </span>
                        </span>
                        {checked && <Check className="h-3.5 w-3.5 text-primary" />}
                      </button>
                    );
                  })}
                </div>
                {selectedTargets.length >= 2 && (
                  <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Thang trục Y:</span>
                    <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5">
                      <button
                        type="button"
                        onClick={() => setScaleMode('normalized')}
                        className={cn(
                          'rounded-md px-2 py-0.5 font-medium',
                          useNormalized ? 'bg-card text-foreground shadow-2xs' : 'text-muted-foreground',
                        )}
                      >
                        0–100%
                      </button>
                      <button
                        type="button"
                        onClick={() => setScaleMode('raw')}
                        className={cn(
                          'rounded-md px-2 py-0.5 font-medium',
                          !useNormalized ? 'bg-card text-foreground shadow-2xs' : 'text-muted-foreground',
                        )}
                      >
                        Đơn vị gốc
                      </button>
                    </div>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            {/* Nút gạt Ngắn hạn / Dài hạn */}
            <div className="inline-flex rounded-xl border border-border bg-card p-0.5">
              <button
                type="button"
                onClick={() => setMode('short')}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-all',
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
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-all',
                  mode === 'long'
                    ? 'bg-primary text-primary-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Dài hạn
              </button>
            </div>

            {/* Các mốc thời gian dự báo */}
            <div className="inline-flex flex-wrap items-center gap-0.5 rounded-xl border border-border bg-card p-0.5">
              {activeHorizons.map((h) => {
                const active = h.key === horizon;
                return (
                  <button
                    key={h.key}
                    type="button"
                    onClick={() => (mode === 'short' ? setShortHorizon(h.key) : setLongHorizon(h.key))}
                    className={cn(
                      'rounded-lg px-2 py-1 text-xs font-medium transition-all',
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
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-xl bg-card"
              onClick={handleRefreshAll}
              disabled={isFetching}
              title="Làm mới dự báo & đồng bộ cảnh báo"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5">
        {/* Bố cục bất đối xứng 8/4 khi xem 1 thông số (mặc định demo) hoặc 12 cột khi so sánh nhiều thông số */}
        <div className={cn('grid gap-5', isSingleMode && singleSummary ? 'lg:grid-cols-12 lg:items-stretch' : 'grid-cols-1')}>
          {/* Khung Biểu đồ */}
          <div className={cn(isSingleMode && singleSummary ? 'lg:col-span-8' : 'col-span-1')}>
            <div className={cn('h-72 sm:h-80 relative', isFetching && 'opacity-80 transition-opacity')}>
              {isLoading ? (
                <ChartSkeleton className="h-full" />
              ) : firstError && loadedSeries.length === 0 ? (
                <ErrorState error={firstError} onRetry={handleRefreshAll} className="h-full" />
              ) : chart.rows.length === 0 ? (
                <EmptyState message="Chưa có dữ liệu dự báo cho lựa chọn này" className="h-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart.rows} margin={{ top: 10, right: useDualAxis ? 8 : 12, left: -6, bottom: 0 }}>
                    <defs>
                      <linearGradient id="userFcBand" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.24} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.04} />
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
                      yAxisId="left"
                      domain={useNormalized ? [0, 100] : ['auto', 'auto']}
                      width={44}
                      {...axisProps}
                      tickFormatter={(v: number) =>
                        useNormalized
                          ? `${Math.round(v)}%`
                          : fmtNum(v, (singleTargetDef ?? leftTargetDef)?.digits ?? 1)
                      }
                    />
                    {useDualAxis && rightTargetDef && (
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        domain={['auto', 'auto']}
                        width={44}
                        {...axisProps}
                        tickFormatter={(v: number) => fmtNum(v, rightTargetDef.digits ?? 1)}
                      />
                    )}
                    <RTooltip content={<MultiForecastTooltip selectedKeys={selectedTargets} />} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />

                    {chart.hasSingleBand && (
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="singleBand"
                        name="Khoảng dự kiến (80%)"
                        stroke="none"
                        fill="url(#userFcBand)"
                        isAnimationActive={false}
                        connectNulls
                        activeDot={false}
                      />
                    )}

                    {singleOptimal && !useNormalized && (
                      <>
                        <ReferenceLine
                          yAxisId="left"
                          y={singleOptimal.min}
                          stroke="hsl(var(--warning))"
                          strokeDasharray="4 4"
                          strokeOpacity={0.65}
                        />
                        <ReferenceLine
                          yAxisId="left"
                          y={singleOptimal.max}
                          stroke="hsl(var(--warning))"
                          strokeDasharray="4 4"
                          strokeOpacity={0.65}
                        />
                      </>
                    )}

                    {selectedTargets.map((key, idx) => {
                      const tDef = TARGET_MAP[key];
                      const color = tDef?.color ?? 'hsl(var(--primary))';
                      const axisId = useDualAxis && idx === 1 ? 'right' : 'left';
                      return (
                        <Line
                          key={`obs_${key}`}
                          yAxisId={axisId}
                          type="monotone"
                          dataKey={`obs_${key}`}
                          name={isSingleMode ? 'Thực tế' : `${tDef?.label ?? key} (thực tế)`}
                          stroke={color}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                          connectNulls
                        />
                      );
                    })}

                    {selectedTargets.map((key, idx) => {
                      const tDef = TARGET_MAP[key];
                      const color = isSingleMode ? 'hsl(var(--primary))' : tDef?.color ?? 'hsl(var(--primary))';
                      const axisId = useDualAxis && idx === 1 ? 'right' : 'left';
                      return (
                        <Line
                          key={`yhat_${key}`}
                          yAxisId={axisId}
                          type="monotone"
                          dataKey={`yhat_${key}`}
                          name={isSingleMode ? 'Dự báo' : `${tDef?.label ?? key} (dự báo)`}
                          stroke={color}
                          strokeWidth={2.5}
                          strokeDasharray="6 4"
                          dot={false}
                          isAnimationActive={false}
                          connectNulls
                        />
                      );
                    })}

                    {chart.nowTs !== undefined && (
                      <ReferenceLine
                        yAxisId="left"
                        x={chart.nowTs}
                        stroke="hsl(var(--muted-foreground))"
                        strokeDasharray="3 3"
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Cột phải (4 cols) khi xem 1 thông số: Thẻ tổng hợp chuyên sâu */}
          {isSingleMode && singleSummary && (
            <div className="lg:col-span-4 flex flex-col justify-between rounded-2xl border border-border bg-secondary/20 p-4 sm:p-5 space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: singleSummary.tDef?.color }}
                    />
                    {singleSummary.tDef?.label}
                  </span>
                  {singleSummary.optimal && (
                    <span className="rounded-lg bg-card border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      Chuẩn: {singleSummary.optimal.min}–{singleSummary.optimal.max} {singleSummary.optimal.unit}
                    </span>
                  )}
                </div>

                {/* Hộp đối chiếu Hiện tại -> Dự báo */}
                <div className="grid grid-cols-2 gap-3 rounded-xl bg-card border border-border/80 p-3.5">
                  <div>
                    <span className="text-[11px] text-muted-foreground block">Mẫu đo cuối</span>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="font-display text-2xl font-bold text-foreground">
                        {fmtNum(singleSummary.lastObs.v, singleSummary.tDef?.digits ?? 1)}
                      </span>
                      <span className="text-xs text-muted-foreground">{singleSummary.tDef?.unit}</span>
                    </div>
                    <span className="mt-0.5 text-[10px] text-muted-foreground block truncate">
                      {fmtDateTime(singleSummary.lastObs.ts)}
                    </span>
                  </div>

                  <div className="border-l border-border/60 pl-3">
                    <span className="text-[11px] text-muted-foreground block">
                      Sau {hDef?.label ?? horizon}
                    </span>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="font-display text-2xl font-bold text-primary">
                        {fmtNum(singleSummary.endFc.yhat, (singleSummary.tDef?.digits ?? 1) + 1)}
                      </span>
                      <span className="text-xs text-muted-foreground">{singleSummary.tDef?.unit}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span
                        className={cn(
                          'inline-flex items-center gap-0.5 text-[11px] font-semibold',
                          Math.abs(singleSummary.delta) < 0.05
                            ? 'text-muted-foreground'
                            : singleSummary.delta > 0
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-sky-600 dark:text-sky-400',
                        )}
                      >
                        {Math.abs(singleSummary.delta) < 0.05 ? (
                          <Minus className="h-3 w-3" />
                        ) : singleSummary.delta > 0 ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {singleSummary.delta > 0 ? '+' : ''}
                        {fmtNum(singleSummary.delta, singleSummary.tDef?.digits ?? 1)} {singleSummary.tDef?.unit}
                      </span>
                    </div>
                  </div>
                </div>

                {singleSummary.endFc.lo !== undefined && singleSummary.endFc.hi !== undefined && (
                  <div className="flex items-center justify-between text-xs px-1">
                    <span className="text-muted-foreground">Khoảng dao động dự kiến (80%):</span>
                    <span className="font-semibold text-foreground">
                      {fmtNum(singleSummary.endFc.lo, singleSummary.tDef?.digits ?? 1)} –{' '}
                      {fmtNum(singleSummary.endFc.hi, singleSummary.tDef?.digits ?? 1)} {singleSummary.tDef?.unit}
                    </span>
                  </div>
                )}
              </div>

              {/* Khuyến nghị chăm sóc */}
              <div
                className={cn(
                  'rounded-xl border p-3.5 space-y-1.5',
                  singleSummary.status === 'ok'
                    ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
                    : 'border-amber-500/40 bg-amber-500/[0.08]',
                )}
              >
                <div className="flex items-center gap-2">
                  {singleSummary.status === 'ok' ? (
                    <Sprout className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  )}
                  <span className="text-xs font-semibold text-foreground">Khuyến nghị chăm sóc sớm</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{singleSummary.advice}</p>
              </div>
            </div>
          )}
        </div>

        {/* Khi người dùng chọn >= 2 thông số: Hiển thị lưới thẻ tóm tắt bên dưới biểu đồ */}
        {!isSingleMode && summaries.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summaries.map((item) => (
              <div
                key={item.key}
                className={cn(
                  'rounded-xl border p-3.5 space-y-2 transition-all',
                  item.status === 'ok'
                    ? 'border-border bg-secondary/20'
                    : 'border-amber-500/35 bg-amber-500/[0.05]',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: item.tDef?.color }}
                    />
                    <span className="font-semibold text-xs sm:text-sm text-foreground truncate">
                      {item.tDef?.label ?? item.key}
                    </span>
                  </div>
                  {item.optimal && (
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      Chuẩn: {item.optimal.min}–{item.optimal.max} {item.optimal.unit}
                    </span>
                  )}
                </div>

                <div className="flex items-baseline justify-between gap-2 pt-0.5">
                  <div>
                    <span className="text-[11px] text-muted-foreground block">Mẫu cuối</span>
                    <span className="font-display text-base font-bold text-foreground">
                      {fmtNum(item.lastObs.v, item.tDef?.digits ?? 1)}{' '}
                      <span className="text-[11px] font-normal text-muted-foreground">{item.tDef?.unit}</span>
                    </span>
                  </div>

                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

                  <div>
                    <span className="text-[11px] text-muted-foreground block">
                      Dự báo ({hDef?.label ?? horizon})
                    </span>
                    <span className="font-display text-base font-bold text-primary">
                      {fmtNum(item.endFc.yhat, (item.tDef?.digits ?? 1) + 1)}{' '}
                      <span className="text-[11px] font-normal text-muted-foreground">{item.tDef?.unit}</span>
                    </span>
                  </div>

                  <span
                    className={cn(
                      'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
                      Math.abs(item.delta) < 0.05
                        ? 'bg-muted text-muted-foreground'
                        : item.delta > 0
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
                    )}
                  >
                    {Math.abs(item.delta) < 0.05 ? (
                      <Minus className="h-3 w-3" />
                    ) : item.delta > 0 ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
                    {item.delta > 0 ? '+' : ''}
                    {fmtNum(item.delta, item.tDef?.digits ?? 1)}
                  </span>
                </div>

                <div className="flex items-start gap-2 pt-1.5 border-t border-border/50 text-xs">
                  {item.status === 'ok' ? (
                    <Sprout className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <span className="text-muted-foreground leading-relaxed">{item.advice}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default UserForecastSection;
