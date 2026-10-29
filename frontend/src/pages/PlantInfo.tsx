import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, formatDateVN, formatDateTimeVN } from '@/lib/utils';
import {
  subscribeStreamingConfig,
  subscribeSensorData,
  getLatestSensorReading,
  fetchProcessedStagesSummary,
  StreamingConfig,
  FirebaseSensorData,
  FirebaseSensorReading,
  BackendStagesSummaryResponse,
} from '@/services/firebaseAPI';
import {
  getPlantData,
  getCurrentStageIndex,
  analyzeFirebaseDataByStages,
  summarizeFullFirebaseDataset,
  PlantGrowthData,
  StageFirebaseAnalysis,
  FullDatasetSummary,
} from '@/data/plantGrowthData';

export default function PlantInfoPage() {
  const navigate = useNavigate();
  const [streamingConfig, setStreamingConfig] = useState<StreamingConfig | null>(null);
  const [sensorData, setSensorData] = useState<FirebaseSensorData | null>(null);
  const [backendSummary, setBackendSummary] = useState<BackendStagesSummaryResponse | null>(null);
  const [latestReading, setLatestReading] = useState<FirebaseSensorReading | null>(null);
  const [latestTimestamp, setLatestTimestamp] = useState<string>('');
  const [selectedStageIndex, setSelectedStageIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubConfig = subscribeStreamingConfig((config) => {
      setStreamingConfig(config);
      setIsLoading(false);
    });

    fetchProcessedStagesSummary('ffill')
      .then((res) => {
        if (res) {
          setBackendSummary(res);
          setLatestReading(res.latest.reading);
          setLatestTimestamp(res.latest.timestamp);
        }
      })
      .catch(() => {});

    const unsubSensor = subscribeSensorData((data) => {
      setSensorData(data);
      const dates = Object.keys(data || {}).sort().reverse();
      if (dates.length > 0) {
        const latestDate = dates[0];
        const times = Object.keys(data[latestDate] || {}).sort().reverse();
        if (times.length > 0) {
          const latestTime = times[0];
          setLatestReading(data[latestDate][latestTime]);
          setLatestTimestamp(`${latestDate} ${latestTime}`);
        }
      }
    });

    getLatestSensorReading()
      .then((res) => {
        if (res) {
          setLatestReading((prev) => prev || res.reading);
          setLatestTimestamp((prev) => prev || res.timestamp);
        }
      })
      .catch(() => {});

    return () => {
      unsubConfig();
      unsubSensor();
    };
  }, []);

  const plantType = streamingConfig?.config?.plant?.type || 'chili';
  const plantGrowthData: PlantGrowthData = useMemo(() => getPlantData(plantType), [plantType]);
  const growthStages = plantGrowthData.stages;
  const totalNPK = plantGrowthData.totalNPK;

  const datasetSummary: FullDatasetSummary = useMemo(
    () =>
      backendSummary?.summary
        ? {
            totalDays: backendSummary.summary.totalDays,
            totalSamples: backendSummary.summary.totalSamples,
            firstDate: backendSummary.summary.firstDate,
            lastDate: backendSummary.summary.lastDate,
            overallAverage: backendSummary.summary.overallAverage,
            latestReading: backendSummary.summary.latestReading,
          }
        : summarizeFullFirebaseDataset(sensorData, latestReading),
    [backendSummary, sensorData, latestReading]
  );

  // Tuổi cây thực tế tính từ ngày bắt đầu vận hành hệ thống đến ngày đo mới nhất
  const actualDaysPlanted = datasetSummary.totalDays;
  const currentStageIndex = useMemo(
    () => getCurrentStageIndex(actualDaysPlanted, growthStages),
    [actualDaysPlanted, growthStages]
  );

  const activeStageIndex = selectedStageIndex !== null ? selectedStageIndex : currentStageIndex;
  const currentStage = growthStages[currentStageIndex];
  const selectedStage = growthStages[activeStageIndex] || currentStage;

  const stageAnalyses: StageFirebaseAnalysis[] = useMemo(
    () =>
      analyzeFirebaseDataByStages(
        sensorData,
        latestReading,
        actualDaysPlanted,
        growthStages,
        backendSummary
      ),
    [sensorData, latestReading, actualDaysPlanted, growthStages, backendSummary]
  );

  const currentStageAnalysis = stageAnalyses[currentStageIndex];
  const selectedStageAnalysis = stageAnalyses[activeStageIndex] || currentStageAnalysis;

  if (isLoading || !streamingConfig) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-foreground">
            Thông tin cây trồng
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Theo dõi quá trình phát triển và so sánh chỉ số môi trường theo từng giai đoạn
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/recommendations')}
          className="gap-1.5 border-primary/30 text-primary hover:bg-primary/10 self-start sm:self-auto"
        >
          Hướng dẫn chăm sóc
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {/* KHỐI 1: THẺ TỔNG QUAN CÂY TRỒNG */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
        <div className="gradient-primary px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="text-primary-foreground">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-xl sm:text-2xl font-bold">
                Cây ớt
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/20 text-white font-medium">
                Họ cà
              </span>
            </div>
            <p className="text-xs sm:text-sm text-white/85 mt-1">
              Trồng từ ngày {formatDateVN(datasetSummary.firstDate)} đến {formatDateVN(datasetSummary.lastDate)}
              {latestTimestamp && ` • Cập nhật: ${formatDateTimeVN(latestTimestamp)}`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-white/20 backdrop-blur-md border border-white/30 px-3.5 py-1 text-xs font-semibold text-white">
              {currentStageAnalysis.overallStatusLabel}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
          <div className="p-4 sm:p-5">
            <p className="text-xs text-muted-foreground">Thời gian trồng</p>
            <p className="font-display text-xl sm:text-2xl font-bold text-foreground mt-1">
              Ngày thứ {actualDaysPlanted}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Bắt đầu: {formatDateVN(datasetSummary.firstDate)}
            </p>
          </div>

          <div className="p-4 sm:p-5">
            <p className="text-xs text-muted-foreground">Giai đoạn hiện tại</p>
            <p className="font-display text-base sm:text-lg font-bold text-primary mt-1">
              Giai đoạn {currentStage.stageNumber}: {currentStage.name}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Ngày {currentStage.minDays} – {currentStage.maxDays}
            </p>
          </div>

          <div className="p-4 sm:p-5">
            <p className="text-xs text-muted-foreground">Số đo mới nhất</p>
            <p className="font-display text-base sm:text-lg font-bold text-foreground mt-1">
              Ẩm {datasetSummary.latestReading.moisture}% • pH {datasetSummary.latestReading.pH}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              EC {datasetSummary.latestReading.EC} mS/cm • Nhiệt đất {datasetSummary.latestReading.soiltemp}°C
            </p>
          </div>

          <div className="p-4 sm:p-5">
            <p className="text-xs text-muted-foreground">Tổng lượng NPK cả vụ</p>
            <p className="font-display text-base sm:text-lg font-bold text-foreground mt-1">
              {totalNPK.n}N – {totalNPK.p}P – {totalNPK.k}K
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Đơn vị: kg/ha</p>
          </div>
        </div>
      </div>

      {/* KHỐI 2: TIẾN TRÌNH 6 GIAI ĐOẠN & CHI TIẾT GIAI ĐOẠN ĐANG CHỌN */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
        <div className="p-6 border-b border-border">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-foreground">
                Tiến trình phát triển theo giai đoạn
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Chọn từng giai đoạn để xem đặc điểm phát triển và số liệu đo tương ứng
              </p>
            </div>
            {activeStageIndex !== currentStageIndex && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedStageIndex(currentStageIndex)}
                className="text-xs text-primary h-8"
              >
                Về giai đoạn hiện tại
              </Button>
            )}
          </div>

          {/* Stepper 6 giai đoạn tối giản, không lạm dụng icon/emoji */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {growthStages.map((stage, index) => {
              const isCurrent = index === currentStageIndex;
              const isPast = index < currentStageIndex;
              const isSelected = index === activeStageIndex;
              const analysis = stageAnalyses[index];

              return (
                <button
                  type="button"
                  key={stage.id}
                  onClick={() => setSelectedStageIndex(index)}
                  className={cn(
                    'p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[104px]',
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary shadow-xs'
                      : 'border-border bg-card hover:bg-secondary/40'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'h-6 w-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0',
                        isSelected || isCurrent
                          ? 'bg-primary text-primary-foreground'
                          : isPast
                          ? 'bg-primary/20 text-primary'
                          : 'bg-secondary text-muted-foreground'
                      )}
                    >
                      {isPast ? <Check className="h-3.5 w-3.5" /> : index + 1}
                    </span>
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Ngày {stage.minDays}–{stage.maxDays}
                    </span>
                  </div>

                  <div className="mt-2.5">
                    <p
                      className={cn(
                        'text-xs font-semibold line-clamp-1',
                        isSelected ? 'text-primary' : 'text-foreground'
                      )}
                    >
                      {stage.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {analysis.startDate} → {analysis.endDate}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Nội dung chi tiết của giai đoạn đang chọn */}
        <div className="p-6 grid gap-6 lg:grid-cols-12">
          {/* Cột Trái (5 cột): Đặc điểm sinh lý & Phác đồ trọng tâm */}
          <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="pb-3 border-b border-border">
                <div className="flex items-center justify-between">
                  <h4 className="font-display text-base font-bold text-foreground">
                    Giai đoạn {selectedStage.stageNumber}: {selectedStage.name}
                  </h4>
                  <span className="text-xs font-medium text-muted-foreground">
                    {selectedStageAnalysis.daysRecorded} ngày ({selectedStageAnalysis.startDate} → {selectedStageAnalysis.endDate})
                  </span>
                </div>
                <p className="text-xs text-primary font-medium mt-1">
                  Tỷ lệ NPK khuyến nghị: {selectedStage.npkRatio}
                </p>
              </div>

              <div className="space-y-3 text-xs leading-relaxed">
                <div className="p-3.5 rounded-xl bg-secondary/30 border border-border">
                  <p className="font-semibold text-foreground mb-1">1. Đặc điểm rễ và cành lá</p>
                  <p className="text-muted-foreground">
                    {selectedStage.physiology.rootAnatomy} {selectedStage.physiology.branchingAndMorphology}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-secondary/30 border border-border">
                  <p className="font-semibold text-foreground mb-1">2. Đặc điểm ra hoa và đậu quả</p>
                  <p className="text-muted-foreground">
                    {selectedStage.physiology.flowerAndFruitBiology}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-primary/5 border border-primary/20">
                  <p className="font-semibold text-primary mb-1">3. Hướng dẫn chăm sóc và phòng bệnh</p>
                  <p className="text-foreground">{selectedStage.physiology.keyAction}</p>
                  <p className="text-muted-foreground mt-1.5">
                    <strong>Lưu ý sâu bệnh:</strong> {selectedStage.physiology.epidemiologyRisk}
                  </p>
                </div>
              </div>
            </div>

            {/* Định mức NPK của giai đoạn */}
            <div className="grid grid-cols-3 gap-2.5 pt-2">
              <div className="p-3 rounded-xl bg-secondary/40 border border-border text-center">
                <p className="text-[11px] text-muted-foreground">Đạm (N)</p>
                <p className="font-display text-lg font-bold text-blue-600 dark:text-blue-400">
                  {selectedStage.n} <span className="text-[10px] font-normal">kg/ha</span>
                </p>
              </div>
              <div className="p-3 rounded-xl bg-secondary/40 border border-border text-center">
                <p className="text-[11px] text-muted-foreground">Lân (P)</p>
                <p className="font-display text-lg font-bold text-amber-700 dark:text-amber-400">
                  {selectedStage.p} <span className="text-[10px] font-normal">kg/ha</span>
                </p>
              </div>
              <div className="p-3 rounded-xl bg-secondary/40 border border-border text-center">
                <p className="text-[11px] text-muted-foreground">Kali (K)</p>
                <p className="font-display text-lg font-bold text-purple-600 dark:text-purple-400">
                  {selectedStage.k} <span className="text-[10px] font-normal">kg/ha</span>
                </p>
              </div>
            </div>
          </div>

          {/* Cột Phải (7 cột): Bảng đối chiếu 9 thông số quan trắc của giai đoạn */}
          <div className="lg:col-span-7">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
              <h4 className="font-display text-base font-bold text-foreground">
                So sánh số liệu đo với mức chuẩn giai đoạn {selectedStage.stageNumber}
              </h4>
              <span className="text-xs text-muted-foreground">
                Độ phù hợp: <strong className="text-foreground">{selectedStageAnalysis.complianceScore}%</strong>
              </span>
            </div>

            <div className="rounded-xl border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-secondary/50 border-b border-border text-muted-foreground">
                      <th className="text-left py-2.5 px-3 font-semibold">Chỉ số môi trường</th>
                      <th className="text-center py-2.5 px-2.5 font-semibold">Trung bình giai đoạn</th>
                      <th className="text-center py-2.5 px-2.5 font-semibold">Mức chuẩn</th>
                      <th className="text-center py-2.5 px-2.5 font-semibold">Chênh lệch</th>
                      <th className="text-right py-2.5 px-3 font-semibold">Đánh giá</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {selectedStageAnalysis.evaluations.map((ev) => {
                      const isCrit = ev.status === 'critical';
                      const isOpt = ev.status === 'optimal';
                      return (
                        <tr key={ev.key} className="hover:bg-secondary/30 transition-colors">
                          <td className="py-2.5 px-3 font-medium text-foreground">{ev.label}</td>
                          <td className="py-2.5 px-2.5 text-center font-semibold text-foreground">
                            {ev.stageAverageValue} {ev.unit}
                          </td>
                          <td className="py-2.5 px-2.5 text-center text-muted-foreground">
                            {ev.targetMin} – {ev.targetMax} {ev.unit}
                          </td>
                          <td className="py-2.5 px-2.5 text-center font-medium">
                            {ev.delta === 0 ? (
                              <span className="text-emerald-600 dark:text-emerald-400">—</span>
                            ) : (
                              <span
                                className={
                                  isCrit
                                    ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                    : 'text-amber-600 dark:text-amber-400'
                                }
                              >
                                {ev.delta > 0 ? `+${ev.delta}` : ev.delta} {ev.unit}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <span
                              className={cn(
                                'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold',
                                isOpt
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : isCrit
                                  ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              )}
                            >
                              {ev.statusLabel}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KHỐI 3: BẢNG TỔNG HỢP TOÀN CHU KỲ */}
      <div className="rounded-2xl border border-border bg-card p-6 overflow-x-auto shadow-xs">
        <h3 className="font-display text-lg font-semibold mb-4">
          Bảng tổng hợp chỉ số qua 6 giai đoạn phát triển
        </h3>
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/40 text-muted-foreground">
              <th className="text-left py-3 px-3 font-semibold whitespace-nowrap w-px">
                Giai đoạn
              </th>
              <th className="text-center py-3 px-3 font-semibold whitespace-nowrap">
                Thời gian
              </th>
              <th className="text-center py-3 px-2.5 font-semibold">Chuẩn ẩm / pH / EC</th>
              <th className="text-center py-3 px-2.5 font-semibold">Trung bình thực tế</th>
              <th className="text-center py-3 px-2.5 font-semibold">NPK thực tế (ppm)</th>
              <th className="text-center py-3 px-2 font-semibold text-blue-600 dark:text-blue-400">N (kg/ha)</th>
              <th className="text-center py-3 px-2 font-semibold text-amber-700 dark:text-amber-400">P (kg/ha)</th>
              <th className="text-center py-3 px-2 font-semibold text-purple-600 dark:text-purple-400">K (kg/ha)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {growthStages.map((stage, index) => {
              const isSelected = index === activeStageIndex;
              const analysis = stageAnalyses[index];
              const avg = analysis.stageAverageReading;

              return (
                <tr
                  key={stage.id}
                  onClick={() => setSelectedStageIndex(index)}
                  className={cn(
                    'cursor-pointer transition-colors',
                    isSelected ? 'bg-primary/10 font-medium' : 'hover:bg-secondary/40'
                  )}
                >
                  <td className="py-3 px-3 text-foreground whitespace-nowrap w-px">
                    {index + 1}. {stage.name}
                  </td>
                  <td className="text-center py-3 px-3 whitespace-nowrap">
                    <div className="font-medium text-foreground text-xs">
                      Ngày {stage.minDays}–{stage.maxDays}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {analysis.startDate} → {analysis.endDate}
                    </div>
                  </td>
                  <td className="text-center py-3 px-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    {stage.targets.moisture.min}–{stage.targets.moisture.max}% | pH {stage.targets.pH.min}–{stage.targets.pH.max} | EC {stage.targets.EC.min}–{stage.targets.EC.max}
                  </td>
                  <td className="text-center py-3 px-2.5 text-xs font-medium whitespace-nowrap">
                    Ẩm {avg.moisture}% | pH {avg.pH} | EC {avg.EC}
                  </td>
                  <td className="text-center py-3 px-2.5 text-xs whitespace-nowrap">
                    {avg.N} / {avg.P} / {avg.K}
                  </td>
                  <td className="text-center py-3 px-2 text-blue-600 dark:text-blue-400">
                    {stage.n}
                  </td>
                  <td className="text-center py-3 px-2 text-amber-700 dark:text-amber-400">
                    {stage.p}
                  </td>
                  <td className="text-center py-3 px-2 text-purple-600 dark:text-purple-400">
                    {stage.k}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
