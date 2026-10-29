import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Leaf, Lock, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { subscribeStreamingConfig, StreamingConfig, StreamingThreshold } from '@/services/firebaseAPI';
import { ref, set } from 'firebase/database';
import { db } from '@/config/firebaseConfig';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { PLANT_TYPE_OPTIONS } from '@/data/plantGrowthData';
import { SamplingIntervalCard } from '@/components/settings/SamplingIntervalCard';
import { describeFirebaseError } from '@/lib/firebaseErrors';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const sensorTypeOptions = [
  { key: 'soil_temperature', label: 'Nhiệt độ đất', isDecimal: false },
  { key: 'soil_moisture', label: 'Độ ẩm đất', isDecimal: false },
  { key: 'soil_ph', label: 'Độ pH', isDecimal: true },
  { key: 'soil_ec', label: 'Độ dẫn điện EC', isDecimal: true },
  { key: 'nitrogen', label: 'Đạm (N)', isDecimal: false },
  { key: 'phosphorus', label: 'Lân (P)', isDecimal: false },
  { key: 'potassium', label: 'Kali (K)', isDecimal: false },
];

interface WarningThreshold {
  id: string;
  sensorKey: string;
  sensorLabel: string;
  low: number;
  high: number;
  isDecimal: boolean;
}

export default function SettingsPage() {
  const [plantInfo, setPlantInfo] = useState<{ type: string; ageDays: number } | null>(null);
  const [editedAgeDays, setEditedAgeDays] = useState<number>(0);
  const [selectedPlantType, setSelectedPlantType] = useState<string>('chili');
  const [warningThresholds, setWarningThresholds] = useState<WarningThreshold[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingAge, setIsSavingAge] = useState(false);
  const [isSavingPlantType, setIsSavingPlantType] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Subscribe to streaming config from Firebase
  useEffect(() => {
    const unsubscribe = subscribeStreamingConfig((config: StreamingConfig | null) => {
      if (config) {
        // Get plant info
        if (config.config?.plant) {
          const plantType = config.config.plant.type || 'chili';
          setPlantInfo({
            type: plantType,
            ageDays: config.config.plant.age_days || 0,
          });
          setEditedAgeDays(config.config.plant.age_days || 0);
          
          // Map plant type to select value
          const typeValue = plantType.toLowerCase();
          if (typeValue.includes('mustard') || typeValue.includes('cải')) {
            setSelectedPlantType('mustard');
          } else if (typeValue.includes('peanut') || typeValue.includes('lạc') || typeValue.includes('đậu phộng')) {
            setSelectedPlantType('peanut');
          } else {
            setSelectedPlantType('chili');
          }
        }

        // Get thresholds
        if (config.config?.threshold) {
          const thresholdsArray: WarningThreshold[] = [];
          const t = config.config.threshold;
          
          sensorTypeOptions.forEach((sensor, index) => {
            const thresholdData = t[sensor.key as keyof typeof t] as StreamingThreshold | undefined;
            if (thresholdData) {
              thresholdsArray.push({
                id: String(index + 1),
                sensorKey: sensor.key,
                sensorLabel: sensor.label,
                low: thresholdData.low,
                high: thresholdData.high,
                isDecimal: sensor.isDecimal,
              });
            }
          });
          
          setWarningThresholds(thresholdsArray);
        }
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleSaveThresholds = async () => {
    setIsSaving(true);
    try {
      console.log('[Settings] Saving thresholds to Firebase...');
      
      // Set each threshold field individually instead of setting the whole object
      for (const t of warningThresholds) {
        const lowRef = ref(db, `streaming/config/threshold/${t.sensorKey}/low`);
        await set(lowRef, t.low);
        
        const highRef = ref(db, `streaming/config/threshold/${t.sensorKey}/high`);
        await set(highRef, t.high);
      }
      
      toast({
        title: "Đã lưu cài đặt",
        description: "Các ngưỡng cảnh báo đã được cập nhật",
      });
    } catch (error) {
      console.error('[Settings] Error saving settings:', error);
      toast({
        title: "Lỗi",
        description: `Không thể lưu cài đặt. ${describeFirebaseError(error)}`,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAgeDays = async () => {
    setIsSavingAge(true);
    try {
      console.log('[Settings] Saving plant age to Firebase...');
      
      const ageRef = ref(db, 'streaming/config/plant/age_days');
      await set(ageRef, editedAgeDays);
      
      toast({
        title: "Đã cập nhật",
        description: `Số ngày trồng đã được cập nhật thành ${editedAgeDays} ngày`,
      });
    } catch (error) {
      console.error('[Settings] Error saving plant age:', error);
      toast({
        title: "Lỗi",
        description: `Không thể cập nhật số ngày trồng. ${describeFirebaseError(error)}`,
        variant: "destructive",
      });
    } finally {
      setIsSavingAge(false);
    }
  };

  const handleSavePlantType = async (newType: string) => {
    setIsSavingPlantType(true);
    try {
      console.log('[Settings] Saving plant type to Firebase:', newType);
      
      const typeRef = ref(db, 'streaming/config/plant/type');
      await set(typeRef, newType);
      
      setSelectedPlantType(newType);
      
      const plantLabel = PLANT_TYPE_OPTIONS.find(p => p.value === newType)?.label || newType;
      toast({
        title: "Đã cập nhật loại cây",
        description: `Loại cây đã được đổi thành ${plantLabel}`,
      });
    } catch (error) {
      console.error('[Settings] Error saving plant type:', error);
      toast({
        title: "Lỗi",
        description: `Không thể cập nhật loại cây. ${describeFirebaseError(error)}`,
        variant: "destructive",
      });
    } finally {
      setIsSavingPlantType(false);
    }
  };

  const updateThreshold = (id: string, field: 'low' | 'high', value: number, isDecimal: boolean) => {
    const processedValue = isDecimal ? value : Math.round(value);
    setWarningThresholds(warningThresholds.map(t =>
      t.id === id ? { ...t, [field]: processedValue } : t
    ));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="font-display text-3xl font-bold">Cài đặt thông số</h1>
        <p className="text-muted-foreground mt-1">
          Cấu hình hệ thống tưới tiêu theo nhu cầu
        </p>
      </div>

      {/* Plant Info with editable age and type */}
      {plantInfo && (
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="font-display text-xl font-semibold mb-6 flex items-center gap-2">
            <Leaf className="h-5 w-5 text-primary" />
            Thông tin cây trồng
          </h3>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="plantType">Loại cây</Label>
              <Select
                value={selectedPlantType}
                onValueChange={handleSavePlantType}
                disabled={isSavingPlantType}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn loại cây" />
                </SelectTrigger>
                <SelectContent>
                  {PLANT_TYPE_OPTIONS.map((plant) => (
                    <SelectItem key={plant.value} value={plant.value}>
                      <span className="flex items-center gap-2">
                        <span>{plant.icon}</span>
                        <span>{plant.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Chọn loại cây để cập nhật thông tin giai đoạn phù hợp
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ageDays" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Số ngày trồng
              </Label>
              <div className="flex gap-2">
                <Input
                  id="ageDays"
                  type="number"
                  min={0}
                  value={editedAgeDays}
                  onChange={(e) => setEditedAgeDays(Math.max(0, parseInt(e.target.value) || 0))}
                  className="flex-1"
                />
                <Button 
                  onClick={handleSaveAgeDays} 
                  disabled={isSavingAge || editedAgeDays === plantInfo.ageDays}
                  size="sm"
                >
                  {isSavingAge ? 'Đang lưu...' : 'Cập nhật'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Nhập số ngày kể từ khi bắt đầu trồng cây
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Sampling interval (Jetson) + irrigation duration */}
      <SamplingIntervalCard />

      {/* Warning Settings Table - Only Low and High thresholds */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-display text-xl font-semibold flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-accent" />
            Cài đặt ngưỡng cảnh báo
          </h3>
          <Button onClick={handleSaveThresholds} disabled={isSaving} size="sm" className="gap-2">
            <Save className="h-4 w-4" />
            {isSaving ? 'Đang lưu...' : 'Lưu ngưỡng'}
          </Button>
        </div>

        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <div className="min-w-[400px] sm:min-w-0 px-4 sm:px-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary/10">
                  <TableHead className="font-semibold text-primary">Cảm biến</TableHead>
                  <TableHead className="font-semibold text-primary text-center">Ngưỡng dưới</TableHead>
                  <TableHead className="font-semibold text-primary text-center">Ngưỡng trên</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {warningThresholds.map((threshold) => (
                  <TableRow key={threshold.id}>
                    <TableCell className="font-medium">{threshold.sensorLabel}</TableCell>
                    <TableCell className="py-2">
                      <Input
                        type="number"
                        value={threshold.low}
                        onChange={(e) => updateThreshold(threshold.id, 'low', Number(e.target.value), threshold.isDecimal)}
                        className="w-24 mx-auto text-center"
                        step={threshold.isDecimal ? "0.1" : "1"}
                      />
                    </TableCell>
                    <TableCell className="py-2">
                      <Input
                        type="number"
                        value={threshold.high}
                        onChange={(e) => updateThreshold(threshold.id, 'high', Number(e.target.value), threshold.isDecimal)}
                        className="w-24 mx-auto text-center"
                        step={threshold.isDecimal ? "0.1" : "1"}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Quick Threshold Cards */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {warningThresholds.slice(0, 8).map((threshold) => (
          <div key={threshold.id} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="bg-primary/10 px-3 py-2">
              <span className="font-semibold text-sm truncate block">{threshold.sensorLabel}</span>
            </div>
            <div className="p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Ngưỡng dưới</span>
                <span className="font-medium text-blue-600">{threshold.low}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Ngưỡng trên</span>
                <span className="font-medium text-orange-600">{threshold.high}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Account Settings */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h3 className="font-display text-xl font-semibold mb-6 flex items-center gap-2">
          <Lock className="h-5 w-5 text-warning" />
          Bảo mật tài khoản
        </h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Đổi mật khẩu</p>
            <p className="text-sm text-muted-foreground">
              Cập nhật mật khẩu tài khoản của bạn
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate('/change-password')}>
            Đổi mật khẩu
          </Button>
        </div>
      </div>

      {/* Info Card */}
      <div className="rounded-xl bg-primary/5 border border-primary/20 p-4">
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">Lưu ý:</strong> Các ngưỡng được thiết lập sẽ quyết định khi nào hệ thống gửi cảnh báo và tự động kích hoạt tưới (trong chế độ tự động).
        </p>
      </div>
    </div>
  );
}
