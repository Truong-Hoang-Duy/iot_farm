import { useState, useEffect } from 'react';
import { Thermometer, Droplets, FlaskConical, Zap, Atom, Wind } from 'lucide-react';
import { SensorCard } from '@/components/dashboard/SensorCard';
import SensorChart from '@/components/dashboard/SensorChart';
import { subscribeSensorData, subscribeStreamingConfig, FirebaseSensorReading, FirebaseSensorData, StreamingConfig } from '@/services/firebaseAPI';
import { useToast } from '@/hooks/use-toast';

// Default thresholds as fallback
const defaultThresholds = {
  soil_temperature: { low: 18, high: 30 },
  soil_moisture: { low: 40, high: 80 },
  soil_ph: { low: 5.5, high: 7.0 },
  soil_ec: { low: 1.0, high: 2.5 },
  nitrogen: { low: 30, high: 500 },
  phosphorus: { low: 20, high: 1200 },
  potassium: { low: 40, high: 1200 },
};

export default function Dashboard() {
  const [latestReading, setLatestReading] = useState<FirebaseSensorReading | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [allSensorData, setAllSensorData] = useState<FirebaseSensorData | null>(null);
  const [thresholds, setThresholds] = useState(defaultThresholds);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    // Subscribe to sensor data
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
              setLastUpdate(new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
            }
          }
        }
      } catch (error) {
        console.error('Error processing Firebase data:', error);
        toast({
          title: 'Lỗi',
          description: 'Không thể xử lý dữ liệu từ Firebase',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    });

    // Subscribe to streaming config for thresholds
    const unsubscribeConfig = subscribeStreamingConfig((config: StreamingConfig | null) => {
      if (config?.config?.threshold) {
        const t = config.config.threshold;
        setThresholds({
          soil_temperature: t.soil_temperature || defaultThresholds.soil_temperature,
          soil_moisture: t.soil_moisture || defaultThresholds.soil_moisture,
          soil_ph: t.soil_ph || defaultThresholds.soil_ph,
          soil_ec: t.soil_ec || defaultThresholds.soil_ec,
          nitrogen: t.nitrogen || defaultThresholds.nitrogen,
          phosphorus: t.phosphorus || defaultThresholds.phosphorus,
          potassium: t.potassium || defaultThresholds.potassium,
        });
      }
    });

    return () => {
      unsubscribeSensor();
      unsubscribeConfig();
    };
  }, [toast]);

  if (isLoading || !latestReading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Calculate NPK status
  const getNPKStatus = (value: number, low: number, high: number) => {
    if (value < low) return { status: 'low', color: 'text-destructive', bg: 'bg-destructive/10' };
    if (value > high) return { status: 'high', color: 'text-warning', bg: 'bg-warning/10' };
    return { status: 'optimal', color: 'text-success', bg: 'bg-success/10' };
  };

  const nStatus = getNPKStatus(latestReading.N ?? 0, thresholds.nitrogen.low, thresholds.nitrogen.high);
  const pStatus = getNPKStatus(latestReading.P ?? 0, thresholds.phosphorus.low, thresholds.phosphorus.high);
  const kStatus = getNPKStatus(latestReading.K ?? 0, thresholds.potassium.low, thresholds.potassium.high);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Theo dõi thông số môi trường thời gian thực
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
          Cập nhật lúc {lastUpdate.toLocaleTimeString('vi-VN')} {lastUpdate.toLocaleDateString('vi-VN')}
        </div>
      </div>

      {/* Main Sensors */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <SensorCard
          title="Nhiệt độ đất"
          value={Number((latestReading.soiltemp ?? 0).toFixed(1))}
          unit="°C"
          icon={Thermometer}
          color="warning"
          min={thresholds.soil_temperature.low}
          max={thresholds.soil_temperature.high}
        />
        <SensorCard
          title="Độ ẩm đất"
          value={Number((latestReading.moisture ?? 0).toFixed(0))}
          unit="%"
          icon={Droplets}
          color="water"
          min={thresholds.soil_moisture.low}
          max={thresholds.soil_moisture.high}
        />
        <SensorCard
          title="Độ pH"
          value={Number((latestReading.pH ?? 0).toFixed(1))}
          unit=""
          icon={FlaskConical}
          color="accent"
          min={thresholds.soil_ph.low}
          max={thresholds.soil_ph.high}
        />
        <SensorCard
          title="Độ mặn EC"
          value={Number((latestReading.EC ?? 0).toFixed(2))}
          unit="mS/cm"
          icon={Zap}
          color="soil"
          min={thresholds.soil_ec.low}
          max={thresholds.soil_ec.high}
        />
      </div>

      {/* Environment Sensors */}
      <div className="grid gap-6 sm:grid-cols-2">
        <SensorCard
          title="Nhiệt độ không khí"
          value={Number((latestReading.temperature ?? 0).toFixed(1))}
          unit="°C"
          icon={Thermometer}
          color="primary"
        />
        <SensorCard
          title="Độ ẩm không khí"
          value={Number((latestReading.humidity ?? 0).toFixed(1))}
          unit="%"
          icon={Wind}
          color="water"
        />
      </div>

      {/* NPK Section - Redesigned Compact */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <h2 className="font-display text-lg sm:text-xl font-semibold mb-4 flex items-center gap-2">
          <Atom className="h-5 w-5 text-nutrient" />
          Dinh dưỡng NPK
        </h2>
        
        {/* Compact NPK Cards with inline gauge */}
        <div className="grid gap-4 sm:grid-cols-3">
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
                <span className="text-muted-foreground">Ngưỡng: {thresholds.nitrogen.low} - {thresholds.nitrogen.high}</span>
                <span className={`font-medium ${nStatus.color}`}>
                  {nStatus.status === 'optimal' ? '✓ Tốt' : nStatus.status === 'low' ? '↓ Thấp' : '↑ Cao'}
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, ((latestReading.N ?? 0) / thresholds.nitrogen.high) * 100)}%` }}
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
                <span className="text-muted-foreground">Ngưỡng: {thresholds.phosphorus.low} - {thresholds.phosphorus.high}</span>
                <span className={`font-medium ${pStatus.color}`}>
                  {pStatus.status === 'optimal' ? '✓ Tốt' : pStatus.status === 'low' ? '↓ Thấp' : '↑ Cao'}
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div 
                  className="h-full bg-orange-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, ((latestReading.P ?? 0) / thresholds.phosphorus.high) * 100)}%` }}
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
                <span className="text-muted-foreground">Ngưỡng: {thresholds.potassium.low} - {thresholds.potassium.high}</span>
                <span className={`font-medium ${kStatus.color}`}>
                  {kStatus.status === 'optimal' ? '✓ Tốt' : kStatus.status === 'low' ? '↓ Thấp' : '↑ Cao'}
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div 
                  className="h-full bg-purple-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, ((latestReading.K ?? 0) / thresholds.potassium.high) * 100)}%` }}
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
