import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  BookOpen, 
  Droplets, 
  FlaskConical, 
  ShieldAlert, 
  RefreshCw, 
  Bot, 
  ArrowRight, 
  Clock, 
  Sprout, 
  CheckCircle2, 
  AlertTriangle,
  Lightbulb,
  HeartPulse,
  Thermometer,
  Zap,
  Sliders,
  ChevronRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { 
  getLatestSensorReading, 
  FirebaseSensorReading,
  setStreamingControlStatus 
} from '@/services/firebaseAPI';
import { fetchAIAdvisor, fetchLatestCachedAdvisor, AdvisorResponse } from '@/services/aiAPI';
import { triggerOpenAIChat } from '@/components/chat/AIChatWidget';

export default function RecommendationsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [currentSensor, setCurrentSensor] = useState<FirebaseSensorReading | null>(null);
  const [sensorTimestamp, setSensorTimestamp] = useState<string>('');
  const [aiData, setAiData] = useState<AdvisorResponse | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isActivatingPump, setIsActivatingPump] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    const initialize = async () => {
      // 1. Tải nhanh khuyến nghị từ Cache đã sinh sẵn (0s)
      try {
        const cached = await fetchLatestCachedAdvisor();
        if (cached) {
          setAiData(cached);
          if ((cached as any).saved_at) {
            setLastUpdate(new Date((cached as any).saved_at));
          }
        }
      } catch (err) {
        console.warn('Lỗi đọc cache khuyến nghị:', err);
      }

      // 2. Đọc cảm biến thực tế mới nhất từ trạm quan trắc IoT
      try {
        const latest = await getLatestSensorReading();
        if (latest) {
          setCurrentSensor(latest.reading);
          setSensorTimestamp(latest.timestamp);
          
          // Nếu chưa có dữ liệu phân tích thì mới bắt buộc phải chạy
          if (!aiData) {
            loadAIAdvice(latest.reading);
          }
        }
      } catch (err) {
        console.warn('Không thể đọc dữ liệu cảm biến mới nhất:', err);
      }
    };

    initialize();
  }, []);

  const loadAIAdvice = async (reading?: FirebaseSensorReading) => {
    const targetReading = reading || currentSensor;
    if (!targetReading) return;

    setIsAiLoading(true);
    try {
      const response = await fetchAIAdvisor({
        plant_type: 'Cây ớt (Chili Pepper)',
        age_days: 45,
        growth_stage: 'Ra hoa & tạo quả',
        sensor_reading: {
          moisture: targetReading.moisture,
          soiltemp: targetReading.soiltemp,
          pH: targetReading.pH,
          EC: targetReading.EC,
          N: targetReading.N,
          P: targetReading.P,
          K: targetReading.K,
          temperature: targetReading.temperature,
          humidity: targetReading.humidity,
          light: targetReading.light,
        }
      });

      setAiData(response);
      setLastUpdate(new Date());
      toast({
        title: 'Cập nhật đề xuất thành công',
        description: 'Đã phân tích lại dữ liệu từ trạm IoT Farm.',
      });
    } catch (error: any) {
      console.error('Lỗi phân tích:', error);
      toast({
        title: 'Đang dùng dữ liệu chuẩn IoT Farm',
        description: 'Hiển thị phác đồ canh tác theo chuẩn nông học.',
        variant: 'destructive',
      });
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleActivateIrrigation = async () => {
    setIsActivatingPump(true);
    try {
      await setStreamingControlStatus('pump', true);
      toast({
        title: 'Đã kích hoạt máy bơm tưới',
        description: 'Hệ thống IoT Farm đã bật bơm tưới nước 1.5L/gốc.',
      });
    } catch (err) {
      toast({
        title: 'Chưa thể bật máy bơm',
        description: 'Vui lòng kiểm tra kết nối thiết bị tại tab Điều khiển.',
        variant: 'destructive',
      });
    } finally {
      setIsActivatingPump(false);
    }
  };

  const moistureVal = currentSensor?.moisture ?? 52;
  const phVal = currentSensor?.pH ?? 5.4;
  const ecVal = currentSensor?.EC ?? 0.64;
  const nVal = currentSensor?.N ?? 109;
  const pVal = currentSensor?.P ?? 401;
  const kVal = currentSensor?.K ?? 472;
  const soilTemp = currentSensor?.soiltemp ?? 27.2;

  // Tính toán phần trăm tiến độ ẩm so với khoảng tối ưu (60 - 75%)
  const moistureProgress = Math.min(100, Math.max(0, Math.round((moistureVal / 85) * 100)));

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* 1. Header chuẩn đồng bộ với Dashboard */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-3xl font-bold">Khuyến nghị canh tác</h1>
            <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold border border-primary/20">
              <Sprout className="h-3.5 w-3.5" /> IoT Farm
            </span>
          </div>
          <p className="text-muted-foreground mt-1">
            Đề xuất tối ưu hóa chế độ tưới tiêu và dinh dưỡng đất cho hệ thống IoT Farm
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Cập nhật {lastUpdate.toLocaleTimeString('vi-VN')}
          </div>

          <Button 
            onClick={() => loadAIAdvice()} 
            disabled={isAiLoading}
            className="shadow-sm flex items-center gap-2"
          >
            <RefreshCw className={cn("h-4 w-4", isAiLoading && "animate-spin")} />
            {isAiLoading ? 'Đang phân tích...' : 'Phân tích lại'}
          </Button>

          <Button
            onClick={() => triggerOpenAIChat()}
            variant="outline"
            className="flex items-center gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
          >
            <Bot className="h-4 w-4" />
            Trợ lý IoT Farm
          </Button>
        </div>
      </div>

      {/* 2. Hero Card: Tổng quan sức khỏe đất & Trạng thái 4 chỉ số cốt lõi */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
        {/* Banner trên của Card */}
        <div className="bg-secondary/40 border-b border-border px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 font-medium">
            <span className="text-base">🌶️</span>
            <span className="font-semibold text-foreground">Cây Ớt (Chili Pepper)</span>
            <span className="text-muted-foreground">• 45 ngày tuổi</span>
            <span className="text-muted-foreground">• Giai đoạn Ra hoa & Nuôi quả</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>Trạm quan trắc IoT:</span>
            <strong className="text-foreground">{sensorTimestamp || 'Dữ liệu thời gian thực'}</strong>
          </div>
        </div>

        {/* Nội dung chính Hero Card */}
        <div className="p-6 grid gap-6 lg:grid-cols-12 items-center">
          {/* Cột trái: Điểm sức khỏe & Tóm tắt kết luận */}
          <div className="lg:col-span-5 flex flex-col sm:flex-row items-center sm:items-start gap-5 border-b lg:border-b-0 lg:border-r border-border pb-6 lg:pb-0 lg:pr-6">
            <div className="flex flex-col items-center justify-center p-4 rounded-2xl bg-secondary/60 border border-border shrink-0 text-center w-32">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Sức Khỏe Đất</p>
              <div className="flex items-baseline justify-center mt-1">
                <span className={cn(
                  "font-display text-4xl font-extrabold",
                  (aiData?.soil_health_score ?? 65) >= 80 ? "text-emerald-500" :
                  (aiData?.soil_health_score ?? 65) >= 60 ? "text-amber-500" : "text-rose-500"
                )}>
                  {aiData?.soil_health_score ?? 65}
                </span>
                <span className="text-sm text-muted-foreground font-normal">/100</span>
              </div>
              <span className={cn(
                "inline-block mt-2 text-[10px] font-semibold px-2 py-0.5 rounded-full",
                (aiData?.soil_health_score ?? 65) >= 80 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
                (aiData?.soil_health_score ?? 65) >= 60 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" :
                "bg-rose-500/15 text-rose-600 dark:text-rose-400"
              )}>
                {(aiData?.soil_health_score ?? 65) >= 80 ? 'Rất tốt' : 'Cần cân bằng'}
              </span>
            </div>

            <div className="space-y-2 text-center sm:text-left">
              <h3 className="font-display text-lg font-bold text-foreground flex items-center justify-center sm:justify-start gap-2">
                <HeartPulse className="h-5 w-5 text-primary" />
                Đánh giá trạm IoT Farm
              </h3>
              <p className="text-sm text-foreground/90 leading-relaxed font-medium">
                {aiData?.summary || `Chỉ số lý hóa tổng quát đạt 65/100. Độ ẩm đất ${moistureVal}%, pH ${phVal}. Cần tưới bù ẩm và điều chỉnh độ chua của đất để cây phát triển tối ưu.`}
              </p>
              <p className="text-xs text-muted-foreground">
                Hệ thống phân tích IoT Farm • Phiên bản chuyên sâu
              </p>
            </div>
          </div>

          {/* Cột phải: 4 ô chỉ số tóm tắt trực quan (style SensorCard) */}
          <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            {/* Độ ẩm */}
            <div className="rounded-xl border border-border bg-card p-3.5 space-y-1.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">Độ ẩm đất</span>
                <Droplets className="h-4 w-4 text-sky-500" />
              </div>
              <p className="font-display text-xl font-bold text-foreground">{moistureVal}%</p>
              <div className="space-y-1">
                <Progress value={moistureProgress} className="h-1.5" />
                <p className="text-[10px] text-muted-foreground flex justify-between">
                  <span>Chuẩn: 60-75%</span>
                  <span className="text-sky-600 dark:text-sky-400 font-medium">Thiếu ẩm</span>
                </p>
              </div>
            </div>

            {/* pH */}
            <div className="rounded-xl border border-border bg-card p-3.5 space-y-1.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">Độ pH</span>
                <FlaskConical className="h-4 w-4 text-amber-500" />
              </div>
              <p className="font-display text-xl font-bold text-foreground">{phVal}</p>
              <div className="space-y-1">
                <Progress value={Math.min(100, Math.round((phVal / 9) * 100))} className="h-1.5" />
                <p className="text-[10px] text-muted-foreground flex justify-between">
                  <span>Chuẩn: 6.0-6.8</span>
                  <span className="text-amber-600 dark:text-amber-400 font-medium">Đất chua</span>
                </p>
              </div>
            </div>

            {/* EC */}
            <div className="rounded-xl border border-border bg-card p-3.5 space-y-1.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">Độ mặn EC</span>
                <Zap className="h-4 w-4 text-primary" />
              </div>
              <p className="font-display text-xl font-bold text-foreground">{ecVal} <span className="text-xs font-normal text-muted-foreground">mS/cm</span></p>
              <div className="space-y-1">
                <Progress value={Math.min(100, Math.round((ecVal / 2.5) * 100))} className="h-1.5" />
                <p className="text-[10px] text-muted-foreground flex justify-between">
                  <span>Chuẩn: 1.2-2.0</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">Mức thấp</span>
                </p>
              </div>
            </div>

            {/* N-P-K */}
            <div className="rounded-xl border border-border bg-card p-3.5 space-y-1.5 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">N-P-K (ppm)</span>
                <Sprout className="h-4 w-4 text-emerald-500" />
              </div>
              <p className="font-display text-sm font-bold text-foreground tracking-tight pt-1">
                {nVal}-{pVal}-{kVal}
              </p>
              <div className="space-y-1 pt-1.5">
                <p className="text-[10px] text-muted-foreground">
                  Đạm & Kali thấp hơn ngưỡng dinh dưỡng.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Lưới các Khối Hành Động Cụ Thể (Được tối ưu theo phong cách IoT Farm) */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Khối 1: Kế Hoạch Tưới Nước Thông Minh */}
        <div className="rounded-2xl border border-border bg-card p-6 flex flex-col justify-between shadow-sm">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-sky-500/10 text-sky-500 flex items-center justify-center shrink-0">
                  <Droplets className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-foreground">Chế độ tưới nước tối ưu</h3>
                  <p className="text-xs text-muted-foreground">Điều chỉnh theo ẩm độ thực tế vườn ớt</p>
                </div>
              </div>

              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400">
                Ẩm độ: {moistureVal}%
              </span>
            </div>

            {/* Chi tiết khuyến nghị tưới */}
            <p className="text-sm text-foreground/90 leading-relaxed font-medium">
              {aiData?.watering_advice || `Độ ẩm đất hiện tại đang ở mức ${moistureVal}%, thấp hơn mức lý tưởng 60% - 75%. Khuyến nghị tưới bổ sung vào sáng sớm và chiều mát.`}
            </p>

            {/* 2 Thông số hành động nhanh */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="p-3 rounded-xl bg-secondary/50 border border-border space-y-1">
                <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3 text-sky-500" /> Khung giờ tưới:
                </span>
                <p className="font-semibold text-sm text-foreground">06:30 & 16:30</p>
                <p className="text-[10px] text-muted-foreground">Tránh tưới lúc trưa gắt</p>
              </div>

              <div className="p-3 rounded-xl bg-secondary/50 border border-border space-y-1">
                <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
                  <Droplets className="h-3 w-3 text-sky-500" /> Lưu lượng đề xuất:
                </span>
                <p className="font-semibold text-sm text-foreground">1.5 - 2.0 Lít/gốc</p>
                <p className="text-[10px] text-muted-foreground">Tưới nhỏ giọt quanh rễ</p>
              </div>
            </div>
          </div>

          <div className="pt-5 mt-4 border-t border-border flex flex-wrap items-center justify-between gap-2.5">
            <Button
              size="sm"
              onClick={handleActivateIrrigation}
              disabled={isActivatingPump}
              className="bg-sky-600 hover:bg-sky-700 text-white flex items-center gap-1.5 shadow-xs"
            >
              <Droplets className="h-4 w-4" />
              {isActivatingPump ? 'Đang kích hoạt...' : 'Kích hoạt tưới ngay (1.5L)'}
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate('/controls')}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              Tab Điều khiển <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Khối 2: Cảnh Báo Nguy Cơ Sâu Bệnh & Cải Tạo Đất */}
        <div className="rounded-2xl border border-border bg-card p-6 flex flex-col justify-between shadow-sm">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-foreground">Cảnh báo sâu bệnh & Rủi ro</h3>
                  <p className="text-xs text-muted-foreground">Phòng ngừa dựa trên vi khí hậu vườn</p>
                </div>
              </div>

              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                {aiData?.pest_disease_warnings?.length || 2} điểm lưu ý
              </span>
            </div>

            {/* Danh sách cảnh báo */}
            <div className="space-y-2.5">
              {(aiData?.pest_disease_warnings && aiData.pest_disease_warnings.length > 0) ? (
                aiData.pest_disease_warnings.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2.5 p-2.5 rounded-xl bg-amber-500/[0.05] border border-amber-500/20 text-xs text-foreground/90">
                    <span className="h-2 w-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                    <span>{item}</span>
                  </div>
                ))
              ) : (
                <>
                  <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-amber-500/[0.05] border border-amber-500/20 text-xs text-foreground/90">
                    <span className="h-2 w-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                    <span>Môi trường độ ẩm thấp kèm nắng gắt dễ bùng phát bọ trĩ núp ở mặt dưới lá non gây xoăn đọt.</span>
                  </div>
                  <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-amber-500/[0.05] border border-amber-500/20 text-xs text-foreground/90">
                    <span className="h-2 w-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                    <span>Đất chua (pH 5.37) làm rễ cây dễ bị tổn thương bởi các loại nấm đất gây héo xanh.</span>
                  </div>
                </>
              )}
            </div>

            {/* Mẹo cải tạo đất nhanh */}
            {aiData?.soil_improvement_tips && aiData.soil_improvement_tips.length > 0 && (
              <div className="p-3 rounded-xl bg-emerald-500/[0.05] border border-emerald-500/20 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                <span><strong>Cải tạo đất:</strong> {aiData.soil_improvement_tips.join(' • ')}</span>
              </div>
            )}
          </div>

          <div className="pt-5 mt-4 border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Cần tư vấn biện pháp xử lý thuốc/phân sinh học?</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => triggerOpenAIChat('Cách phòng trừ bệnh hại theo cảnh báo trên?')}
              className="border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
            >
              Hỏi Trợ lý IoT Farm <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>

      {/* 4. Khối Phác Đồ Bón Phân Cân Bằng (Đồng bộ thẻ Card đẹp mắt) */}
      <div className="rounded-2xl border border-border bg-card p-6 space-y-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <FlaskConical className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-lg font-bold text-foreground">Phác đồ bón phân cân bằng N-P-K</h3>
              <p className="text-xs text-muted-foreground">Kế hoạch bổ sung dinh dưỡng theo thời điểm sinh trưởng cây ớt</p>
            </div>
          </div>

          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-primary/10 text-primary w-fit">
            {aiData?.fertilizer_plan?.length ?? 2} loại phân khuyến nghị
          </span>
        </div>

        {/* Lưới danh sách các loại phân bón */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(aiData?.fertilizer_plan && aiData.fertilizer_plan.length > 0) ? (
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
                      <span><strong>Thời điểm:</strong> {item.timing}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Sprout className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span><strong>Phương pháp:</strong> {item.method}</span>
                    </div>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-border/70 flex items-start gap-1.5 text-xs text-foreground/85">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <span>{item.purpose}</span>
                </div>
              </div>
            ))
          ) : (
            <>
              {/* Fallback visual cards */}
              <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-border/70">
                    <h4 className="font-semibold text-sm text-foreground">Đạm Urê hoặc Đạm Cá Hữu Cơ</h4>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">
                      25g/gốc
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs text-muted-foreground mt-3">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span><strong>Thời điểm:</strong> 06:00 - 08:00 sáng</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Sprout className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span><strong>Phương pháp:</strong> Hòa nước tưới đều quanh tán</span>
                    </div>
                  </div>
                </div>
                <div className="pt-2.5 border-t border-border/70 flex items-start gap-1.5 text-xs text-foreground/85">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <span>Bù hàm lượng đạm N đang thấp (109 ppm) để dưỡng chồi non và nuôi hoa.</span>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-border/70">
                    <h4 className="font-semibold text-sm text-foreground">Kali Sunfat (K2SO4)</h4>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">
                      20g/gốc
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs text-muted-foreground mt-3">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span><strong>Thời điểm:</strong> 16:00 - 17:30 chiều</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Sprout className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span><strong>Phương pháp:</strong> Hòa nước tưới gốc</span>
                    </div>
                  </div>
                </div>
                <div className="pt-2.5 border-t border-border/70 flex items-start gap-1.5 text-xs text-foreground/85">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <span>Bổ sung Kali giúp cứng cuống, chống rụng hoa và tăng độ cay cho quả non.</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
