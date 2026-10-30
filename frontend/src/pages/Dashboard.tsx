import { useState, useEffect, useMemo } from 'react';
import { Thermometer, Droplets, FlaskConical, Zap, Atom, Wind } from 'lucide-react';
import { SensorCard } from '@/components/dashboard/SensorCard';
import { DeviceStatusCard } from '@/components/dashboard/DeviceStatusCard';
import SensorChart from '@/components/dashboard/SensorChart';
import {
  subscribeSensorData,
  fetchProcessedStagesSummary,
  FirebaseSensorReading,
  FirebaseSensorData,
  BackendStagesSummaryResponse,
} from '@/services/firebaseAPI';
import { getPlantData, getCurrentStageIndex } from '@/data/plantGrowthData';
import { useToast } from '@/hooks/use-toast';
import { formatDateTimeVN } from '@/lib/utils';
import { DashboardSkeleton } from '@/components/common/LoadingStates';

export default function Dashboard() {
  const [latestReading, setLatestReading] = useState<FirebaseSensorReading | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [allSensorData, setAllSensorData] = useState<FirebaseSensorData | null>(null);
  const [backendSummary, setBackendSummary] = useState<BackendStagesSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const plantGrowthData = useMemo(() => getPlantData('chili'), []);
  const growthStages = plantGrowthData.stages;

  const actualDaysPlanted = useMemo(() => {
    if (backendSummary?.summary?.totalDays) {
      return backendSummary.summary.totalDays;
    }
    if (allSensorData) {
      return Object.keys(allSensorData).length;
    }
    return 261;
  }, [backendSummary, allSensorData]);

  const currentStageIndex = useMemo(
    () => getCurrentStageIndex(actualDaysPlanted, growthStages),
    [actualDaysPlanted, growthStages]
  );
  const currentStage = growthStages[currentStageIndex];
  const targets = currentStage.targets;

  useEffect(() => {
    // 1. Lấy bản tóm tắt chuẩn hóa & mẫu đo mới nhất đã qua xử lý từ Backend (/api/sensors/stages-summary)
    fetchProcessedStagesSummary('ffill')
      .then((res) => {
        if (res) {
          setBackendSummary(res);
          setLatestReading(res.latest.reading);
          const [datePart, timePart] = res.latest.timestamp.split(' ');
          if (datePart && timePart) {
            const [year, month, day] = datePart.split('-');
            const [hour, minute] = timePart.split(':');
            setLastUpdate(
              new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
            );
          }
          setIsLoading(false);
        }
      })
      .catch(() => {});

    const unsubscribeSensor = subscribeSensorData((data) => {
      try {
        setAllSensorData(data);

        if (data) {
          const dates = Object.keys(data).sort().reverse();
          if (dates.length > 0) {
            const latestDate = dates[0];
            const times = Object.keys(data[latestDate]).sort().reverse();
            if (times.length > 0) {
              const latestTime = times[0];
              setLatestReading(data[latestDate][latestTime]);

              const [year, month, day] = latestDate.split('-');
              const [hour, minute] = latestTime.split(':');
              setLastUpdate(
                new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
              );
            }
          }
        }
      } catch (error) {
        console.error('Error processing sensor data:', error);
        toast({
          title: 'Lỗi',
          description: 'Không thể xử lý dữ liệu cảm biến',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    });

    return () => {
      unsubscribeSensor();
    };
  }, [toast]);

  if (isLoading || !latestReading) {
    return <DashboardSkeleton />;
  }

  const getNPKStatus = (value: number, low: number, high: number) => {
    if (value < low) return { status: 'low', color: 'text-destructive', bg: 'bg-destructive/10' };
    if (value > high) return { status: 'high', color: 'text-warning', bg: 'bg-warning/10' };
    return { status: 'optimal', color: 'text-success', bg: 'bg-success/10' };
  };

  const nStatus = getNPKStatus(latestReading.N ?? 0, targets.N.min, targets.N.max);
  const pStatus = getNPKStatus(latestReading.P ?? 0, targets.P.min, targets.P.max);
  const kStatus = getNPKStatus(latestReading.K ?? 0, targets.K.min, targets.K.max);

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in w-full max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl sm:text-3xl font-bold">Tổng quan hệ thống</h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              Cây ớt • Ngày thứ {actualDaysPlanted} • Giai đoạn {currentStage.stageNumber}: {currentStage.name}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-xs sm:text-sm">
            Theo dõi thông số môi trường và so sánh với mức chuẩn giai đoạn {currentStage.stageNumber}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
          Cập nhật: {formatDateTimeVN(lastUpdate)}
        </div>
      </div>

      {/* Trạng thái thiết bị biên Jetson Nano */}
      <DeviceStatusCard />

      {/* Main Sensors */}
      <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <SensorCard
          title="Nhiệt độ đất"
          value={Number((latestReading.soiltemp ?? 0).toFixed(1))}
          unit="°C"
          icon={Thermometer}
          color="warning"
          min={targets.soiltemp.min}
          max={targets.soiltemp.max}
        />
        <SensorCard
          title="Độ ẩm đất"
          value={Number((latestReading.moisture ?? 0).toFixed(1))}
          unit="%"
          icon={Droplets}
          color="water"
          min={targets.moisture.min}
          max={targets.moisture.max}
        />
        <SensorCard
          title="Độ pH"
          value={Number((latestReading.pH ?? 0).toFixed(2))}
          unit=""
          icon={FlaskConical}
          color="accent"
          min={targets.pH.min}
          max={targets.pH.max}
        />
        <SensorCard
          title="Độ dẫn điện EC"
          value={Number((latestReading.EC ?? 0).toFixed(2))}
          unit="mS/cm"
          icon={Zap}
          color="soil"
          min={targets.EC.min}
          max={targets.EC.max}
        />
      </div>

      {/* Environment Sensors */}
      <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2">
        <SensorCard
          title="Nhiệt độ không khí"
          value={Number((latestReading.temperature ?? 0).toFixed(1))}
          unit="°C"
          icon={Thermometer}
          color="primary"
          min={targets.temperature.min}
          max={targets.temperature.max}
        />
        <SensorCard
          title="Độ ẩm không khí"
          value={Number((latestReading.humidity ?? 0).toFixed(1))}
          unit="%"
          icon={Wind}
          color="water"
          min={targets.humidity.min}
          max={targets.humidity.max}
        />
      </div>

      {/* NPK Section */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs">
        <h2 className="font-display text-lg sm:text-xl font-semibold mb-4 flex items-center gap-2">
          <Atom className="h-5 w-5 text-nutrient" />
          Dinh dưỡng NPK (chuẩn giai đoạn {currentStage.stageNumber}: {currentStage.name})
        </h2>

        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-3">
          {/* Nitrogen */}
          <div className={`rounded-xl border p-4 ${nStatus.bg} border-blue-500/20`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <span className="font-bold text-blue-600">N</span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Đạm</p>
                  <p className="font-display text-xl font-bold">{latestReading.N ?? 0}</p>
                </div>
              </div>
              <span className="text-xs font-medium text-muted-foreground">ppm</span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  Chuẩn: {targets.N.min} – {targets.N.max}
                </span>
                <span className={`font-medium ${nStatus.color}`}>
                  {nStatus.status === 'optimal' ? 'Đạt chuẩn' : nStatus.status === 'low' ? 'Thấp' : 'Cao'}
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, ((latestReading.N ?? 0) / targets.N.max) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Phosphorus */}
          <div className={`rounded-xl border p-4 ${pStatus.bg} border-orange-500/20`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
                  <span className="font-bold text-orange-600">P</span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Lân</p>
                  <p className="font-display text-xl font-bold">{latestReading.P ?? 0}</p>
                </div>
              </div>
              <span className="text-xs font-medium text-muted-foreground">ppm</span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  Chuẩn: {targets.P.min} – {targets.P.max}
                </span>
                <span className={`font-medium ${pStatus.color}`}>
                  {pStatus.status === 'optimal' ? 'Đạt chuẩn' : pStatus.status === 'low' ? 'Thấp' : 'Cao'}
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, ((latestReading.P ?? 0) / targets.P.max) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Potassium */}
          <div className={`rounded-xl border p-4 ${kStatus.bg} border-purple-500/20`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <span className="font-bold text-purple-600">K</span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Kali</p>
                  <p className="font-display text-xl font-bold">{latestReading.K ?? 0}</p>
                </div>
              </div>
              <span className="text-xs font-medium text-muted-foreground">ppm</span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">
                  Chuẩn: {targets.K.min} – {targets.K.max}
                </span>
                <span className={`font-medium ${kStatus.color}`}>
                  {kStatus.status === 'optimal' ? 'Đạt chuẩn' : kStatus.status === 'low' ? 'Thấp' : 'Cao'}
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, ((latestReading.K ?? 0) / targets.K.max) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Time Series Chart */}
      <SensorChart sensorData={allSensorData} />
    </div>
  );
}
