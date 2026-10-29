import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Gauge, Microscope } from 'lucide-react';
import { ModelCards, DeviceBadge } from '@/components/forecast/ModelCards';
import { DatasetSplitCard } from '@/components/forecast/DatasetSplitCard';
import { BestModelGrid, MetricsExplorer } from '@/components/forecast/MetricsExplorer';
import { TestPredictionsChart } from '@/components/forecast/TestPredictionsChart';
import { TrainControl } from '@/components/forecast/TrainControl';
import { MethodologySection } from '@/components/forecast/MethodologySection';
import { ChartSkeleton, ErrorState } from '@/components/forecast/StateViews';
import { cn } from '@/lib/utils';
import { isBackendError, metricsQuery, modelsQuery, runtimeQuery, toMs, type MetricKind } from '@/services/backendAPI';
import { fmtDateTime } from '@/components/forecast/chartUtils';

export default function ModelLab() {
  const [kind, setKind] = useState<MetricKind>('cum');
  const modelsQ = useQuery(modelsQuery());
  const metricsQ = useQuery(metricsQuery(undefined, undefined, kind));
  const runtimeQ = useQuery(runtimeQuery());

  const backendDown = isBackendError(modelsQ.error) && modelsQ.error.kind === 'network';
  const metrics = metricsQ.data;
  const runtime = runtimeQ.data;
  const device = runtime?.training_device ?? metrics?.device ?? modelsQ.data?.find((m) => m.device)?.device;
  const gpuName = runtime?.gpu_name ?? modelsQ.data?.find((m) => m.gpu_name)?.gpu_name;
  const trainedAt = runtime?.trained_at ?? metrics?.generated_at;

  // Nếu backend trả cả 2 loại, chỉ giữ loại đang chọn (dòng không có `kind` coi như cum)
  const rows = useMemo(() => (metrics?.rows ?? []).filter((r) => (r.kind ?? 'cum') === kind || !metrics?.rows.some((x) => x.kind)), [metrics, kind]);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold flex items-center gap-3">
            <Microscope className="h-8 w-8 text-primary" />
            Phòng thí nghiệm mô hình
          </h1>
          <p className="text-muted-foreground mt-1">
            So sánh 5 mô hình dự báo chuỗi thời gian và 2 baseline trên dữ liệu cảm biến của trang trại
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <DeviceBadge device={gpuName && device && /cuda|gpu/i.test(device) ? `${device} · ${gpuName}` : device} />
          {runtime?.cuda_available !== undefined && <span>CUDA hiện tại: {runtime.cuda_available ? 'có' : 'không'}</span>}
          {trainedAt && <span>Huấn luyện lúc: {fmtDateTime(toMs(trainedAt))}</span>}
          {runtime?.trained === false && <span className="text-warning">Chưa có mô hình đã huấn luyện</span>}
        </div>
      </div>

      <TrainControl />

      {/* Model cards */}
      <section className="space-y-3">
        <h2 className="font-display text-lg sm:text-xl font-semibold flex items-center gap-2">
          <Boxes className="h-5 w-5 text-primary" />
          Các mô hình
        </h2>
        {backendDown && (
          <p className="text-xs text-warning">Backend chưa kết nối – đang hiển thị thông tin tĩnh của mô hình (trạng thái train chưa rõ).</p>
        )}
        <ModelCards models={modelsQ.data} isLoading={modelsQ.isLoading} backendDown={backendDown} />
      </section>

      <DatasetSplitCard datasets={metrics?.datasets ?? {}} device={metrics?.device} />

      {/* Metrics */}
      <section className="rounded-2xl border border-border bg-card p-4 sm:p-6 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-display text-lg sm:text-xl font-semibold flex items-center gap-2">
            <Gauge className="h-5 w-5 text-primary" />
            Chỉ số đánh giá trên tập test
            {rows.length > 0 && <span className="text-xs font-normal text-muted-foreground">({rows.length} dòng)</span>}
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border p-0.5 bg-secondary/50">
              {(['cum', 'point'] as MetricKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded-md transition-all',
                    kind === k ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                  title={k === 'cum' ? 'Sai số trung bình trên các bước 1..k' : 'Sai số tại đúng bước thứ k'}
                >
                  {k === 'cum' ? 'Tích luỹ (1..k)' : 'Tại bước k'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-3">
          {kind === 'cum'
            ? 'Tích luỹ: sai số trung bình của mọi bước dự báo từ 1 đến k (k = horizon) – phản ánh chất lượng cả quỹ đạo dự báo.'
            : 'Tại bước k: chỉ tính sai số ở đúng thời điểm horizon – thường lớn hơn chỉ số tích luỹ.'}
        </p>
        {metricsQ.isLoading ? (
          <ChartSkeleton className="h-72" />
        ) : metricsQ.isError ? (
          <ErrorState error={metricsQ.error} onRetry={() => metricsQ.refetch()} className="h-64" showTrainLink={false} />
        ) : (
          <>
            <MetricsExplorer rows={rows} />
            {(rows.length > 0 || Object.keys(metrics?.best ?? {}).length > 0) && (
              <BestModelGrid rows={rows} best={kind === 'cum' ? metrics?.best : undefined} />
            )}
          </>
        )}
      </section>

      <TestPredictionsChart />

      <MethodologySection />
    </div>
  );
}
