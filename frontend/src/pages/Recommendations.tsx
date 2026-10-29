import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Droplets,
  FlaskConical,
  ShieldAlert,
  RefreshCw,
  Bot,
  ArrowRight,
  Clock,
  Sprout,
  CheckCircle2,
  Lightbulb,
  Sparkles,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import {
  fetchProcessedStagesSummary,
  getLatestSensorReading,
  FirebaseSensorReading,
  BackendStagesSummaryResponse,
  setStreamingControlStatus,
} from '@/services/firebaseAPI';
import {
  getPlantData,
  getCurrentStageIndex,
  analyzeFirebaseDataByStages,
  PlantGrowthData,
  StageFirebaseAnalysis,
} from '@/data/plantGrowthData';
import { fetchAIAdvisor, fetchLatestCachedAdvisor, AdvisorResponse } from '@/services/aiAPI';
import { triggerOpenAIChat } from '@/components/chat/AIChatWidget';

export default function RecommendationsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [backendSummary, setBackendSummary] = useState<BackendStagesSummaryResponse | null>(null);
  const [currentSensor, setCurrentSensor] = useState<FirebaseSensorReading | null>(null);
  const [sensorTimestamp, setSensorTimestamp] = useState<string>('');
  const [aiData, setAiData] = useState<AdvisorResponse | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isActivatingPump, setIsActivatingPump] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [selectedStageIndex, setSelectedStageIndex] = useState<number | null>(null);

  const plantGrowthData: PlantGrowthData = useMemo(() => getPlantData('chili'), []);
  const growthStages = plantGrowthData.stages;

  // Tuổi cây thực tế lấy trực tiếp từ API thông tin cây (/api/sensors/stages-summary)
  const actualDaysPlanted = backendSummary?.summary?.totalDays || 261;
  const currentStageIndex = useMemo(
    () => getCurrentStageIndex(actualDaysPlanted, growthStages),
    [actualDaysPlanted, growthStages]
  );

  const activeStageIndex = selectedStageIndex !== null ? selectedStageIndex : currentStageIndex;
  const currentStage = growthStages[currentStageIndex];
  const activeStage = growthStages[activeStageIndex] || currentStage;

  const stageAnalyses: StageFirebaseAnalysis[] = useMemo(
    () =>
      analyzeFirebaseDataByStages(
        null,
        currentSensor,
        actualDaysPlanted,
        growthStages,
        backendSummary
      ),
    [currentSensor, actualDaysPlanted, growthStages, backendSummary]
  );

  const activeStageAnalysis = stageAnalyses[activeStageIndex] || stageAnalyses[currentStageIndex];

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      try {
        // 1. Lấy dữ liệu thông tin cây & cảm biến đã làm sạch (tái sử dụng cache từ trang Thông tin cây)
        const stagesRes = await fetchProcessedStagesSummary('ffill');
        let latestReading: FirebaseSensorReading | null = null;
        let resolvedDays = 261;

        if (stagesRes && isMounted) {
          setBackendSummary(stagesRes);
          latestReading = stagesRes.latest.reading;
          resolvedDays = stagesRes.summary.totalDays;
          setCurrentSensor(stagesRes.latest.reading);
          setSensorTimestamp(stagesRes.latest.timestamp);
        } else {
          const latest = await getLatestSensorReading();
          if (latest && isMounted) {
            latestReading = latest.reading;
            setCurrentSensor(latest.reading);
            setSensorTimestamp(latest.timestamp);
          }
        }

        const resolvedStageIdx = getCurrentStageIndex(resolvedDays, growthStages);
        const resolvedStage = growthStages[resolvedStageIdx];

        // 2. Lấy khuyến nghị từ DB (/api/recommendations/latest)
        const cached = await fetchLatestCachedAdvisor();
        if (cached && isMounted) {
          setAiData(cached);
          if (cached.saved_at) {
            setLastUpdate(new Date(cached.saved_at));
          }

          // Nếu bản lưu trong DB lệch tuổi cây hoặc giai đoạn so với thực tế thì tự động phân tích & ghi đè vào DB
          if (
            latestReading &&
            (cached.age_days !== resolvedDays || cached.growth_stage !== resolvedStage.name)
          ) {
            await runAndSaveAIAnalysis(resolvedDays, resolvedStage.name, latestReading, false);
          }
        } else if (latestReading && isMounted) {
          await runAndSaveAIAnalysis(resolvedDays, resolvedStage.name, latestReading, false);
        }
      } catch (err) {
        console.warn('Lỗi khởi tạo dữ liệu khuyến nghị:', err);
      }
    };

    initialize();
    return () => {
      isMounted = false;
    };
  }, [growthStages]);

  const runAndSaveAIAnalysis = async (
    ageDays: number,
    stageName: string,
    reading: FirebaseSensorReading,
    showNotification: boolean = true
  ) => {
    setIsAiLoading(true);
    try {
      const response = await fetchAIAdvisor({
        plant_type: 'Cây ớt',
        age_days: ageDays,
        growth_stage: stageName,
        sensor_reading: {
          moisture: reading.moisture,
          soiltemp: reading.soiltemp,
          pH: reading.pH,
          EC: reading.EC,
          N: reading.N,
          P: reading.P,
          K: reading.K,
          temperature: reading.temperature,
          humidity: reading.humidity,
        },
      });

      setAiData(response);
      setLastUpdate(response.saved_at ? new Date(response.saved_at) : new Date());

      if (showNotification) {
        toast({
          title: 'Đã phân tích và lưu vào DB',
          description: `Khuyến nghị cho ngày thứ ${ageDays} (${stageName}) đã được ghi đè vào cơ sở dữ liệu.`,
        });
      }
    } catch (error) {
      console.error('Lỗi phân tích AI:', error);
      if (showNotification) {
        toast({
          title: 'Không thể kết nối máy chủ phân tích',
          description: 'Vui lòng kiểm tra kết nối Backend API.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleReanalyze = async () => {
    const readingToAnalyze = currentSensor || activeStageAnalysis?.stageAverageReading;
    if (!readingToAnalyze) return;
    await runAndSaveAIAnalysis(actualDaysPlanted, activeStage.name, readingToAnalyze, true);
  };

  const handleActivateIrrigation = async () => {
    setIsActivatingPump(true);
    try {
      await setStreamingControlStatus('pump', true);
      toast({
        title: 'Đã kích hoạt máy bơm tưới',
        description: 'Hệ thống đang tưới bù ẩm 1.5L/gốc cho luống ớt.',
      });
    } catch {
      toast({
        title: 'Chưa thể bật máy bơm',
        description: 'Vui lòng kiểm tra kết nối thiết bị tại tab Điều khiển.',
        variant: 'destructive',
      });
    } finally {
      setIsActivatingPump(false);
    }
  };

  const reading = currentSensor || activeStageAnalysis.stageAverageReading;
  const moistureVal = Number((reading?.moisture ?? 51.72).toFixed(1));
  const phVal = Number((reading?.pH ?? 5.37).toFixed(2));
  const ecVal = Number((reading?.EC ?? 0.64).toFixed(2));
  const nVal = Math.round(reading?.N ?? 109);
  const pVal = Math.round(reading?.P ?? 401);
  const kVal = Math.round(reading?.K ?? 472);

  const healthScore = aiData?.soil_health_score ?? activeStageAnalysis.complianceScore;

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* 1. Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-foreground">
              Khuyến nghị chăm sóc
            </h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              Ngày thứ {actualDaysPlanted} • {currentStage.name}
            </span>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Hướng dẫn tưới nước, bón phân và phòng sâu bệnh từ AI dựa trên dữ liệu thực tế của cây
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground bg-secondary/60 px-3 py-1.5 rounded-full border border-border">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Lưu DB lúc {lastUpdate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
          </div>

          <Button
            onClick={handleReanalyze}
            disabled={isAiLoading}
            className="shadow-xs flex items-center gap-2"
          >
            <RefreshCw className={cn('h-4 w-4', isAiLoading && 'animate-spin')} />
            {isAiLoading ? 'Đang phân tích và lưu...' : 'Phân tích lại'}
          </Button>

          <Button
            onClick={() =>
              triggerOpenAIChat(
                `Tư vấn kỹ thuật chăm sóc cây ớt ngày thứ ${actualDaysPlanted} (${activeStage.name}) với ẩm độ ${moistureVal}% và pH ${phVal}?`
              )
            }
            variant="outline"
            className="flex items-center gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
          >
            <Bot className="h-4 w-4" />
            Hỏi trợ lý AI
          </Button>
        </div>
      </div>

      {/* 2. KHỐI 1: TIẾN TRÌNH SINH TRƯỞNG & ĐỐI CHIẾU CHỈ SỐ THỰC TẾ (Đồng bộ với Thông tin cây) */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
        <div className="bg-secondary/40 border-b border-border px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <span className="font-semibold text-sm text-foreground">
            Các giai đoạn phát triển và mức chỉ số chuẩn của cây ớt
          </span>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Trạng thái hiện tại:</span>
            <span className="font-semibold text-primary bg-primary/10 px-2.5 py-0.5 rounded-md border border-primary/20">
              Ngày thứ {actualDaysPlanted} • Giai đoạn {currentStage.stageNumber}: {currentStage.name}
            </span>
          </div>
        </div>

        {/* Thanh chọn 6 giai đoạn đồng bộ với PlantInfo */}
        <div className="p-6 border-b border-border bg-secondary/10">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {growthStages.map((stage, index) => {
              const isSelected = index === activeStageIndex;
              const isCurrent = index === currentStageIndex;
              const isPast = index < currentStageIndex;
              const analysis = stageAnalyses[index];

              return (
                <button
                  type="button"
                  key={stage.id}
                  onClick={() => setSelectedStageIndex(index)}
                  className={cn(
                    'p-3 rounded-xl border text-left transition-all flex flex-col justify-between min-h-[96px]',
                    isSelected
                      ? 'bg-card border-primary shadow-xs ring-1 ring-primary'
                      : 'bg-secondary/30 border-border/80 hover:bg-secondary/60'
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
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
                      {isPast ? <Check className="h-3.5 w-3.5" /> : stage.stageNumber}
                    </span>
                    {isCurrent ? (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">
                        Hiện tại
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-muted-foreground">
                        Ngày {stage.minDays}–{stage.maxDays}
                      </span>
                    )}
                  </div>
                  <div className="mt-2">
                    <h4 className="font-semibold text-xs text-foreground line-clamp-1">
                      {stage.name}
                    </h4>
                    <span className="text-[10px] text-muted-foreground block mt-0.5">
                      {analysis.startDate} → {analysis.endDate}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Chi tiết sinh lý & Đối chiếu nhanh */}
        <div className="p-6 grid gap-6 lg:grid-cols-12 items-stretch">
          <div className="lg:col-span-7 space-y-3.5 border-b lg:border-b-0 lg:border-r border-border pb-6 lg:pb-0 lg:pr-6">
            <div>
              <h3 className="font-display text-base sm:text-lg font-bold text-foreground">
                Giai đoạn {activeStage.stageNumber}: {activeStage.name} (ngày {activeStage.minDays}–{activeStage.maxDays})
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Thời gian ghi nhận: {activeStageAnalysis.startDate} → {activeStageAnalysis.endDate} • Tỷ lệ NPK: {activeStage.npkRatio}
              </p>
            </div>

            <div className="grid gap-2.5 text-xs">
              <div className="p-3 rounded-xl bg-secondary/30 border border-border/80">
                <p className="font-semibold text-foreground mb-1">1. Đặc điểm rễ và cành lá</p>
                <p className="text-muted-foreground leading-relaxed">
                  {activeStage.physiology.rootAnatomy} {activeStage.physiology.branchingAndMorphology}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-secondary/30 border border-border/80">
                <p className="font-semibold text-foreground mb-1">2. Đặc điểm ra hoa và đậu quả</p>
                <p className="text-muted-foreground leading-relaxed">
                  {activeStage.physiology.flowerAndFruitBiology}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-rose-500/[0.06] border border-rose-500/20 flex items-start gap-2 text-rose-800 dark:text-rose-300">
                <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                <span>
                  <strong>Nguy cơ sâu bệnh cần lưu ý:</strong> {activeStage.physiology.epidemiologyRisk}
                </span>
              </div>
            </div>
          </div>

          {/* Cột phải: Đối chiếu cảm biến mới nhất với chuẩn của giai đoạn */}
          <div className="lg:col-span-5 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-border">
                <h4 className="text-xs font-bold text-muted-foreground">
                  So sánh số đo hiện tại với mức chuẩn giai đoạn {activeStage.stageNumber}
                </h4>
                <span className="text-xs text-muted-foreground">
                  Mẫu: <strong className="text-foreground">{sensorTimestamp || backendSummary?.latest?.timestamp || 'Mới nhất'}</strong>
                </span>
              </div>

              <div className="space-y-2.5 pt-3 text-xs">
                <div className="p-3 rounded-xl bg-secondary/20 border border-border flex items-center justify-between">
                  <div>
                    <span className="text-muted-foreground block">Độ ẩm đất</span>
                    <span className="text-base font-bold text-foreground">
                      {moistureVal}%{' '}
                      <span
                        className={cn(
                          'text-xs font-medium',
                          moistureVal < activeStage.targets.moisture.min ||
                            moistureVal > activeStage.targets.moisture.max
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        )}
                      >
                        (
                        {moistureVal < activeStage.targets.moisture.min
                          ? 'Thiếu ẩm'
                          : moistureVal > activeStage.targets.moisture.max
                          ? 'Dư ẩm'
                          : 'Đạt chuẩn'}
                        )
                      </span>
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-muted-foreground block text-[11px]">Chuẩn giai đoạn {activeStage.stageNumber}:</span>
                    <span className="font-semibold text-foreground">
                      {activeStage.targets.moisture.min} – {activeStage.targets.moisture.max}%
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-secondary/20 border border-border flex items-center justify-between">
                  <div>
                    <span className="text-muted-foreground block">Độ pH đất</span>
                    <span className="text-base font-bold text-foreground">
                      {phVal}{' '}
                      <span
                        className={cn(
                          'text-xs font-medium',
                          phVal < activeStage.targets.pH.min
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        )}
                      >
                        ({phVal < activeStage.targets.pH.min ? 'Đất chua' : 'Đạt chuẩn'})
                      </span>
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-muted-foreground block text-[11px]">Chuẩn giai đoạn {activeStage.stageNumber}:</span>
                    <span className="font-semibold text-foreground">
                      {activeStage.targets.pH.min} – {activeStage.targets.pH.max}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-secondary/20 border border-border flex items-center justify-between">
                  <div>
                    <span className="text-muted-foreground block">Độ dẫn điện EC và N-P-K</span>
                    <span className="text-sm font-bold text-foreground">
                      EC {ecVal} mS/cm • N:{nVal} P:{pVal} K:{kVal} ppm
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-muted-foreground block text-[11px]">Chuẩn EC:</span>
                    <span className="font-semibold text-foreground">
                      {activeStage.targets.EC.min} – {activeStage.targets.EC.max} mS/cm
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-emerald-500/[0.07] border border-emerald-500/20 flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-muted-foreground block">
                  Điểm sức khỏe đất (AI đánh giá):
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {healthScore >= 75 ? 'Đất cân bằng tốt' : 'Cần cải tạo pH, bù ẩm và dinh dưỡng'}
                </span>
              </div>
              <div className="text-right">
                <span className="font-display text-2xl font-black text-emerald-600 dark:text-emerald-400">
                  {healthScore}
                </span>
                <span className="text-[10px] text-muted-foreground block">/100 điểm</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. KHỐI 2: HƯỚNG DẪN CHĂM SÓC TỪ AI (Nhúng trực tiếp dữ liệu AI trả về & Lưu DB) */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="bg-secondary/40 border-b border-border px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">
              Hướng dẫn chăm sóc từ AI — Ngày thứ {aiData?.age_days ?? actualDaysPlanted} ({aiData?.growth_stage ?? activeStage.name})
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Kết quả phân tích từ AI được lưu trực tiếp vào cơ sở dữ liệu ({aiData?.timestamp || 'Vừa cập nhật'})
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              {aiData?.ai_model_used || 'Trợ lý nông nghiệp AI'}
            </span>
          </div>
        </div>

        {/* Nhận định tổng quan từ AI (aiData.summary) */}
        <div className="px-6 py-3.5 bg-secondary/15 border-b border-border flex items-start gap-2.5 text-xs sm:text-sm text-foreground/90">
          <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>Đánh giá tổng quan từ AI:</strong>{' '}
            {aiData?.summary || activeStage.physiology.keyAction}
          </p>
        </div>

        {/* 3 Tabs hành động nhúng trực tiếp dữ liệu từ AI */}
        <div className="p-6">
          <Tabs defaultValue="irrigation" className="w-full space-y-6">
            <TabsList className="grid grid-cols-3 w-full max-w-xl mx-auto h-11 p-1 bg-secondary/60">
              <TabsTrigger value="irrigation" className="flex items-center gap-2 text-xs sm:text-sm">
                <Droplets className="h-4 w-4 text-sky-500" />
                <span>1. Tưới nước</span>
              </TabsTrigger>
              <TabsTrigger value="fertilizer" className="flex items-center gap-2 text-xs sm:text-sm">
                <FlaskConical className="h-4 w-4 text-emerald-500" />
                <span>2. Bón phân và pH</span>
              </TabsTrigger>
              <TabsTrigger value="pests" className="flex items-center gap-2 text-xs sm:text-sm">
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                <span>3. Sâu bệnh</span>
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: KHUYẾN NGHỊ TƯỚI NƯỚC TỪ AI (aiData.watering_advice) */}
            <TabsContent value="irrigation" className="space-y-5 animate-fade-in mt-2">
              <div className="grid gap-5 md:grid-cols-12 items-center">
                <div className="md:col-span-8 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-sky-600 dark:text-sky-400 bg-sky-500/10 px-2.5 py-0.5 rounded-full">
                      Chuẩn ẩm độ giai đoạn {activeStage.stageNumber}: {activeStage.targets.moisture.min}% – {activeStage.targets.moisture.max}%
                    </span>
                    <span className="text-xs text-muted-foreground">Thực đo: {moistureVal}%</span>
                  </div>

                  <div className="p-4 rounded-xl bg-secondary/30 border border-border">
                    <p className="text-sm text-foreground leading-relaxed">
                      {aiData?.watering_advice ||
                        `Độ ẩm đất hiện đạt ${moistureVal}% (chuẩn giai đoạn ${activeStage.name} là ${activeStage.targets.moisture.min}% - ${activeStage.targets.moisture.max}%). Nên tưới bổ sung 1.5 - 2.0 lít/gốc vào sáng sớm và chiều mát.`}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div className="p-3 rounded-xl bg-secondary/40 border border-border space-y-1">
                      <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-sky-500" /> Khung giờ tưới khuyến nghị:
                      </span>
                      <p className="font-bold text-sm text-foreground">06:30 sáng và 16:30 chiều</p>
                      <p className="text-[11px] text-muted-foreground">
                        Tránh tưới giữa trưa nắng gắt gây sốc nhiệt bộ rễ chùm 0–30cm
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-secondary/40 border border-border space-y-1">
                      <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5">
                        <Droplets className="h-3.5 w-3.5 text-sky-500" /> Lưu lượng đề xuất:
                      </span>
                      <p className="font-bold text-sm text-foreground">1.5 – 2.0 lít / gốc</p>
                      <p className="text-[11px] text-muted-foreground">
                        Tưới nhỏ giọt quanh vùng tán rễ, thoát nước tốt sau mưa
                      </p>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-4 p-4 rounded-2xl bg-sky-500/[0.06] border border-sky-500/20 flex flex-col justify-between space-y-4 text-center">
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-sky-700 dark:text-sky-300">
                      Điều khiển máy bơm tưới
                    </span>
                    <p className="text-[11px] text-muted-foreground">
                      Kích hoạt máy bơm tưới trực tiếp từ hệ thống điều khiển
                    </p>
                  </div>

                  <Button
                    onClick={handleActivateIrrigation}
                    disabled={isActivatingPump}
                    className="w-full bg-sky-600 hover:bg-sky-700 text-white flex items-center justify-center gap-2 shadow-xs"
                  >
                    <Droplets className="h-4 w-4" />
                    {isActivatingPump ? 'Đang kích hoạt...' : 'Bật máy bơm tưới ngay'}
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/controls')}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Mở trang điều khiển thiết bị <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* TAB 2: PHÁC ĐỒ BÓN PHÂN & CẢI TẠO ĐẤT TỪ AI (aiData.soil_improvement_tips + aiData.fertilizer_plan) */}
            <TabsContent value="fertilizer" className="space-y-5 animate-fade-in mt-2">
              {/* Cải tạo đất từ AI (soil_improvement_tips) */}
              {aiData?.soil_improvement_tips && aiData.soil_improvement_tips.length > 0 && (
                <div className="p-4 rounded-xl bg-amber-500/[0.06] border border-amber-500/20 space-y-2">
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <Lightbulb className="h-4 w-4" /> Khuyến nghị cải tạo đất và điều chỉnh pH từ AI (pH hiện tại: {phVal}):
                  </span>
                  <ul className="space-y-1.5 text-xs text-foreground/90 pl-5 list-disc">
                    {aiData.soil_improvement_tips.map((tip, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Danh sách phân bón từ AI (fertilizer_plan) */}
              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {aiData?.fertilizer_plan && aiData.fertilizer_plan.length > 0 ? (
                  aiData.fertilizer_plan.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-border bg-secondary/30 hover:bg-secondary/50 p-4 space-y-3 transition-colors flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-border/70">
                          <h4 className="font-semibold text-sm text-foreground">{item.name}</h4>
                          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">
                            {item.amount}
                          </span>
                        </div>

                        <div className="space-y-1.5 text-xs text-muted-foreground mt-3">
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span>
                              <strong>Thời điểm:</strong> {item.timing}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Sprout className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span>
                              <strong>Cách bón:</strong> {item.method}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-2.5 border-t border-border/70 flex items-start gap-1.5 text-xs text-foreground/85">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        <span>{item.purpose}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="col-span-full p-6 text-center text-sm text-muted-foreground">
                    Nhấn "Phân tích lại" để AI tạo hướng dẫn bón phân chi tiết.
                  </div>
                )}
              </div>
            </TabsContent>

            {/* TAB 3: CẢNH BÁO SÂU BỆNH TỪ AI (aiData.pest_disease_warnings) */}
            <TabsContent value="pests" className="space-y-5 animate-fade-in mt-2">
              <div className="grid gap-4 sm:grid-cols-2">
                {aiData?.pest_disease_warnings && aiData.pest_disease_warnings.length > 0 ? (
                  aiData.pest_disease_warnings.map((warning, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.04] space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-sm text-foreground flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-amber-500" />
                          Nguy cơ sâu bệnh #{idx + 1}
                        </h4>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400">
                          AI phát hiện
                        </span>
                      </div>
                      <p className="text-xs text-foreground/90 leading-relaxed">{warning}</p>
                    </div>
                  ))
                ) : (
                  <div className="col-span-full p-4 rounded-xl border border-border bg-secondary/20 text-xs text-muted-foreground">
                    {activeStage.physiology.epidemiologyRisk}
                  </div>
                )}
              </div>

              <div className="p-4 rounded-xl bg-secondary/40 border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  Cần tư vấn thêm về thuốc sinh học hoặc cách phòng bệnh cho giai đoạn {activeStage.name.toLowerCase()}?
                </div>
                <Button
                  onClick={() =>
                    triggerOpenAIChat(
                      `Cách phòng trừ sâu bệnh sinh học cho cây ớt ở ngày thứ ${actualDaysPlanted} (${activeStage.name}) khi ẩm độ ${moistureVal}% và pH ${phVal}?`
                    )
                  }
                  className="flex items-center gap-1.5 shadow-xs"
                >
                  <Bot className="h-4 w-4" />
                  Hỏi chuyên gia AI về sâu bệnh
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
