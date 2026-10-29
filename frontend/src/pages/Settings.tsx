import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Calendar, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateVN } from '@/lib/utils';
import { SamplingIntervalCard } from '@/components/settings/SamplingIntervalCard';
import {
  fetchProcessedStagesSummary,
  subscribeStreamingConfig,
  StreamingConfig,
  StreamingThreshold,
} from '@/services/firebaseAPI';
import { CHILI_DATA, getCurrentStageIndex } from '@/data/plantGrowthData';
import { ref, set } from 'firebase/database';
import { db } from '@/config/firebaseConfig';
import { useToast } from '@/hooks/use-toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const sensorTypeOptions = [
  { key: 'soil_moisture', label: 'Độ ẩm đất', unit: '%', isDecimal: false },
  { key: 'soil_ph', label: 'Độ pH đất', unit: 'pH', isDecimal: true },
  { key: 'soil_ec', label: 'Độ dẫn điện EC', unit: 'mS/cm', isDecimal: true },
  { key: 'soil_temperature', label: 'Nhiệt độ đất', unit: '°C', isDecimal: false },
  { key: 'nitrogen', label: 'Đạm (N)', unit: 'ppm', isDecimal: false },
  { key: 'phosphorus', label: 'Lân (P)', unit: 'ppm', isDecimal: false },
  { key: 'potassium', label: 'Kali (K)', unit: 'ppm', isDecimal: false },
];

// Ngưỡng chuẩn nông học tối ưu cho Cây ớt
const CHILI_OPTIMAL_THRESHOLDS: Record<string, { low: number; high: number }> = {
  soil_moisture: { low: 60, high: 75 },
  soil_ph: { low: 6.0, high: 6.8 },
  soil_ec: { low: 1.2, high: 2.0 },
  soil_temperature: { low: 20, high: 30 },
  nitrogen: { low: 150, high: 250 },
  phosphorus: { low: 400, high: 700 },
  potassium: { low: 600, high: 1000 },
};

interface WarningThreshold {
  id: string;
  sensorKey: string;
  sensorLabel: string;
  unit: string;
  low: number;
  high: number;
  isDecimal: boolean;
}

export default function SettingsPage() {
  const [startDate, setStartDate] = useState<string>('2025-12-14');
  const [editedAgeDays, setEditedAgeDays] = useState<number>(261);
  const [dbSummary, setDbSummary] = useState<{ firstDate: string; lastDate: string; totalDays: number } | null>(null);
  const [warningThresholds, setWarningThresholds] = useState<WarningThreshold[]>([]);
  const [isSavingThresholds, setIsSavingThresholds] = useState(false);
  const [isSavingPlant, setIsSavingPlant] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    let isMounted = true;

    // 1. Lấy dữ liệu ngày gieo trồng và độ tuổi sẵn có từ DB (đồng bộ hoàn toàn với PlantInfo và Recommendations)
    fetchProcessedStagesSummary('ffill')
      .then((res) => {
        if (res?.summary && isMounted) {
          const first = res.summary.firstDate; // ví dụ: "2025-12-14"
          const last = res.summary.lastDate;   // ví dụ: "2026-08-31"
          const days = res.summary.totalDays;  // ví dụ: 261
          setDbSummary({ firstDate: first, lastDate: last, totalDays: days });
          setStartDate(first);
          setEditedAgeDays(days);
        }
      })
      .catch((err) => console.warn('Lỗi đọc dữ liệu mùa vụ từ DB:', err));

    // 2. Lắng nghe cấu hình thời gian thực từ Firebase
    const unsubscribe = subscribeStreamingConfig((config: StreamingConfig | null) => {
      if (config && isMounted) {
        if (config.config?.plant) {
          if (typeof config.config.plant.age_days === 'number' && config.config.plant.age_days > 0) {
            setEditedAgeDays(config.config.plant.age_days);
          }
          if ((config.config.plant as any).start_date) {
            setStartDate((config.config.plant as any).start_date);
          }
        }

        // Ngưỡng cảm biến
        if (config.config?.threshold) {
          const t = config.config.threshold;
          const list: WarningThreshold[] = sensorTypeOptions.map((sensor, idx) => {
            const data = t[sensor.key as keyof typeof t] as StreamingThreshold | undefined;
            const optimal = CHILI_OPTIMAL_THRESHOLDS[sensor.key];
            return {
              id: String(idx + 1),
              sensorKey: sensor.key,
              sensorLabel: sensor.label,
              unit: sensor.unit,
              low: data?.low ?? optimal?.low ?? 0,
              high: data?.high ?? optimal?.high ?? 100,
              isDecimal: sensor.isDecimal,
            };
          });
          setWarningThresholds(list);
        }
      }
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // Tính số ngày tuổi từ ngày gieo trồng đến mốc dữ liệu cuối của DB (hoặc hôm nay)
  const handleStartDateChange = (dateStr: string) => {
    setStartDate(dateStr);
    if (!dateStr) return;
    const start = new Date(dateStr);
    const end = dbSummary?.lastDate ? new Date(dbSummary.lastDate) : new Date();
    const diffTime = end.getTime() - start.getTime();
    const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1);
    setEditedAgeDays(diffDays);
  };

  // Khi sửa số ngày tuổi -> Lùi lại ngày gieo trồng tương ứng
  const handleAgeDaysChange = (days: number) => {
    const validDays = Math.max(0, days);
    setEditedAgeDays(validDays);
    const end = dbSummary?.lastDate ? new Date(dbSummary.lastDate) : new Date();
    end.setDate(end.getDate() - validDays);
    setStartDate(end.toISOString().split('T')[0]);
  };

  // Giai đoạn sinh trưởng tương ứng với số ngày tuổi theo chuẩn nông học cây ớt
  const stageIndex = getCurrentStageIndex(editedAgeDays, CHILI_DATA.stages);
  const currentStage = CHILI_DATA.stages[stageIndex]?.name || 'Cuối vụ & phục hồi';

  // Lưu thông tin cây ớt lên Firebase
  const handleSavePlantInfo = async () => {
    setIsSavingPlant(true);
    try {
      await set(ref(db, 'streaming/config/plant/type'), 'chili');
      await set(ref(db, 'streaming/config/plant/age_days'), editedAgeDays);
      await set(ref(db, 'streaming/config/plant/growth_stage'), currentStage);
      await set(ref(db, 'streaming/config/plant/start_date'), startDate);

      toast({
        title: 'Đã lưu',
        description: `Cây ớt ${editedAgeDays} ngày tuổi (${currentStage})`,
      });
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: 'Không thể lưu thông tin cây',
        variant: 'destructive',
      });
    } finally {
      setIsSavingPlant(false);
    }
  };

  // Áp dụng nhanh bộ ngưỡng chuẩn cho cây ớt
  const handleApplyOptimal = () => {
    setWarningThresholds((prev) =>
      prev.map((t) => {
        const opt = CHILI_OPTIMAL_THRESHOLDS[t.sensorKey];
        if (opt) {
          return { ...t, low: opt.low, high: opt.high };
        }
        return t;
      })
    );
    toast({
      title: 'Đã điền chuẩn cây ớt',
      description: 'Nhấn "Lưu ngưỡng" để áp dụng lên hệ thống.',
    });
  };

  // Lưu ngưỡng cảm biến lên Firebase
  const handleSaveThresholds = async () => {
    setIsSavingThresholds(true);
    try {
      for (const t of warningThresholds) {
        await set(ref(db, `streaming/config/threshold/${t.sensorKey}/low`), t.low);
        await set(ref(db, `streaming/config/threshold/${t.sensorKey}/high`), t.high);
      }
      toast({
        title: 'Đã lưu',
        description: 'Ngưỡng cảm biến đã được cập nhật.',
      });
    } catch (err) {
      toast({
        title: 'Lỗi',
        description: 'Không thể lưu ngưỡng cảnh báo',
        variant: 'destructive',
      });
    } finally {
      setIsSavingThresholds(false);
    }
  };

  const updateThresholdValue = (id: string, field: 'low' | 'high', val: number, isDecimal: boolean) => {
    const finalVal = isDecimal ? val : Math.round(val);
    setWarningThresholds((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: finalVal } : t))
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Tiêu đề */}
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-foreground">Cài đặt</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Quản lý cây ớt và ngưỡng cảm biến
        </p>
      </div>

      {/* 1. KHỐI CÂY ỚT & MÙA VỤ */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌶️</span>
            <div>
              <h2 className="font-display text-base font-bold text-foreground">Cây ớt & mùa vụ</h2>
              <p className="text-xs text-muted-foreground">Lấy dữ liệu gieo trồng và độ tuổi từ DB quan trắc</p>
            </div>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
            {currentStage}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {/* Cây trồng: Cố định cây ớt */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Cây trồng</Label>
            <Input
              value="Cây ớt"
              disabled
              className="h-9 text-xs font-medium bg-secondary/50 text-foreground cursor-default"
            />
          </div>

          {/* Ngày gieo trồng (Lấy từ bản ghi đầu tiên trong DB) */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              Ngày gieo trồng {startDate ? `(${formatDateVN(startDate)})` : ''}
            </Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => handleStartDateChange(e.target.value)}
              className="h-9 text-xs font-medium"
            />
          </div>

          {/* Độ tuổi: Sinh tự động theo dữ liệu DB */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Độ tuổi (ngày)</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                max={365}
                value={editedAgeDays}
                onChange={(e) => handleAgeDaysChange(parseInt(e.target.value) || 0)}
                className="h-9 text-xs font-semibold"
              />
              <Button
                onClick={handleSavePlantInfo}
                disabled={isSavingPlant}
                size="sm"
                className="h-9 px-4 text-xs shrink-0"
              >
                {isSavingPlant ? 'Đang lưu...' : 'Lưu'}
              </Button>
            </div>
          </div>
        </div>

        {dbSummary && (
          <p className="text-[11px] text-muted-foreground pt-1">
            Đồng bộ theo dữ liệu quan trắc vườn: {formatDateVN(dbSummary.firstDate)} đến {formatDateVN(dbSummary.lastDate)} ({dbSummary.totalDays} ngày)
          </p>
        )}
      </div>

      {/* 2. KHỐI NGƯỠNG CẢM BIẾN */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4 text-primary" />
            <div>
              <h2 className="font-display text-base font-bold text-foreground">Ngưỡng cảnh báo</h2>
              <p className="text-xs text-muted-foreground">Kích hoạt cảnh báo và bật máy bơm khi vượt ngưỡng</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleApplyOptimal}
              className="h-8 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Điền chuẩn cây ớt
            </Button>
            <Button
              size="sm"
              onClick={handleSaveThresholds}
              disabled={isSavingThresholds}
              className="h-8 text-xs gap-1.5 shadow-xs"
            >
              <Save className="h-3.5 w-3.5" />
              {isSavingThresholds ? 'Đang lưu...' : 'Lưu ngưỡng'}
            </Button>
          </div>
        </div>

        {/* Bảng nhập ngưỡng ngắn gọn */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/40 text-xs hover:bg-secondary/40">
                <TableHead className="font-semibold text-foreground py-2.5">Cảm biến</TableHead>
                <TableHead className="font-semibold text-foreground text-center py-2.5 w-36">
                  Dưới ngưỡng (Thấp)
                </TableHead>
                <TableHead className="font-semibold text-foreground text-center py-2.5 w-36">
                  Vượt ngưỡng (Cao)
                </TableHead>
                <TableHead className="font-semibold text-muted-foreground text-right py-2.5 hidden sm:table-cell">
                  Chuẩn tối ưu
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {warningThresholds.map((t) => {
                const opt = CHILI_OPTIMAL_THRESHOLDS[t.sensorKey];
                return (
                  <TableRow key={t.id} className="text-xs hover:bg-secondary/20">
                    <TableCell className="font-medium py-2.5">
                      {t.sensorLabel}{' '}
                      <span className="text-muted-foreground text-[11px]">({t.unit})</span>
                    </TableCell>
                    <TableCell className="py-2 text-center">
                      <Input
                        type="number"
                        step={t.isDecimal ? '0.1' : '1'}
                        value={t.low}
                        onChange={(e) => updateThresholdValue(t.id, 'low', Number(e.target.value), t.isDecimal)}
                        className="w-24 h-8 text-xs text-center mx-auto"
                      />
                    </TableCell>
                    <TableCell className="py-2 text-center">
                      <Input
                        type="number"
                        step={t.isDecimal ? '0.1' : '1'}
                        value={t.high}
                        onChange={(e) => updateThresholdValue(t.id, 'high', Number(e.target.value), t.isDecimal)}
                        className="w-24 h-8 text-xs text-center mx-auto"
                      />
                    </TableCell>
                    <TableCell className="py-2.5 text-right text-muted-foreground hidden sm:table-cell">
                      {opt ? `${opt.low} – ${opt.high} ${t.unit}` : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* 3. CẤU HÌNH THỜI GIAN LẤY MẪU & TƯỚI THIẾT BỊ */}
      <SamplingIntervalCard />
    </div>
  );
}
