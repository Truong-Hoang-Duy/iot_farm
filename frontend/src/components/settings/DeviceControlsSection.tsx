import { useState, useEffect } from 'react';
import { Power, Droplets, Sun, Clock, Lock, Settings, Calendar, Zap, Timer, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn, formatDateTimeVN } from '@/lib/utils';
import { 
  subscribeStreamingConfig, 
  setStreamingIrrigationMode,
  setStreamingLightMode,
  setStreamingControlStatus, 
  setStreamingIrrigationTime,
  setStreamingLightTime,
  getControlDeviceStatus,
  StreamingConfig,
  setIrrigationDurationMin,
  subscribeStreamingConfigField,
  DEFAULT_IRRIGATION_DURATION_MIN,
  MIN_IRRIGATION_DURATION_MIN,
  MAX_IRRIGATION_DURATION_MIN,
} from '@/services/firebaseAPI';
import { useToast } from '@/hooks/use-toast';
import { toastFirebaseWriteError } from '@/lib/firebaseErrors';

type ControlMode = 'auto' | 'schedule' | 'manual';

const modeToNumber: Record<ControlMode, number> = {
  auto: 1,
  schedule: 2,
  manual: 0,
};

const numberToMode = (num: number | string | undefined): ControlMode => {
  if (num === undefined || num === '') return 'auto';
  const n = typeof num === 'string' ? parseInt(num, 10) : num;
  if (n === 0) return 'manual';
  if (n === 2) return 'schedule';
  return 'auto';
};

export function DeviceControlsSection() {
  const [streamingConfig, setStreamingConfig] = useState<StreamingConfig | null>(null);
  const [isLoading, setIsLoading] = useState<string | null>(null);
  
  // Chế độ riêng biệt cho máy bơm và đèn chiếu sáng
  const [pumpMode, setPumpMode] = useState<ControlMode>('auto');
  const [lightMode, setLightMode] = useState<ControlMode>('auto');
  
  // Trạng thái lập lịch
  const [pumpScheduleDialogOpen, setPumpScheduleDialogOpen] = useState(false);
  const [lightScheduleDialogOpen, setLightScheduleDialogOpen] = useState(false);
  const [pumpScheduleTimes, setPumpScheduleTimes] = useState<number[]>([5, 17]);
  const [pumpDuration, setPumpDuration] = useState<number>(DEFAULT_IRRIGATION_DURATION_MIN);
  const [editDuration, setEditDuration] = useState<number>(DEFAULT_IRRIGATION_DURATION_MIN);
  
  const [lightOnTime, setLightOnTime] = useState<number>(6);
  const [lightOffTime, setLightOffTime] = useState<number>(18);
  
  const { toast } = useToast();

  // Lấy trạng thái hoạt động thực tế từ Firebase
  const pumpInfo = streamingConfig?.control?.pump 
    ? getControlDeviceStatus(streamingConfig.control.pump) 
    : { status: false, daily_time: 0, last_on_time: '' };
  const lightInfo = streamingConfig?.control?.light 
    ? getControlDeviceStatus(streamingConfig.control.light) 
    : { status: false, daily_time: 0, last_on_time: '' };

  const isPumpOn = pumpInfo.status;
  const isLightOn = lightInfo.status;

  useEffect(() => {
    const unsubscribeConfig = subscribeStreamingConfig((config) => {
      setStreamingConfig(config);
      
      if (config?.config?.irrigation_mode !== undefined) {
        setPumpMode(numberToMode(config.config.irrigation_mode));
      }
      
      if (config?.config?.light_mode !== undefined) {
        setLightMode(numberToMode(config.config.light_mode));
      }
      
      if (config?.config?.irrigation_time) {
        const times = Object.values(config.config.irrigation_time).filter((t): t is number => typeof t === 'number');
        if (times.length > 0) {
          setPumpScheduleTimes(times);
        }
      }
      
      if (config?.config?.light_time) {
        const lt = config.config.light_time;
        if (lt.on !== undefined && lt.on !== '') {
          setLightOnTime(typeof lt.on === 'string' ? parseInt(lt.on, 10) || 6 : lt.on);
        }
        if (lt.off !== undefined && lt.off !== '') {
          setLightOffTime(typeof lt.off === 'string' ? parseInt(lt.off, 10) || 18 : lt.off);
        }
      }
    });

    const unsubscribeDuration = subscribeStreamingConfigField('irrigation_duration_min', (val) => {
      if (typeof val === 'number') {
        setPumpDuration(val);
        setEditDuration(val);
      }
    });

    return () => {
      unsubscribeConfig();
      unsubscribeDuration();
    };
  }, []);

  const handlePumpModeChange = async (mode: ControlMode) => {
    try {
      setIsLoading('pumpMode');
      setPumpMode(mode);
      await setStreamingIrrigationMode(modeToNumber[mode]);
      
      const modeLabels: Record<ControlMode, string> = { auto: 'Tự động', schedule: 'Lập lịch', manual: 'Thủ công' };
      toast({
        title: 'Đã thay đổi chế độ bơm',
        description: `Chế độ bơm đã chuyển sang ${modeLabels[mode]}`,
      });
    } catch (error) {
      toastFirebaseWriteError(error, 'Không thể thay đổi chế độ bơm');
    } finally {
      setIsLoading(null);
    }
  };

  const handleLightModeChange = async (mode: ControlMode) => {
    try {
      setIsLoading('lightMode');
      setLightMode(mode);
      await setStreamingLightMode(modeToNumber[mode]);
      
      const modeLabels: Record<ControlMode, string> = { auto: 'Tự động', schedule: 'Lập lịch', manual: 'Thủ công' };
      toast({
        title: 'Đã thay đổi chế độ đèn',
        description: `Chế độ đèn đã chuyển sang ${modeLabels[mode]}`,
      });
    } catch (error) {
      toastFirebaseWriteError(error, 'Không thể thay đổi chế độ đèn');
    } finally {
      setIsLoading(null);
    }
  };

  const handleToggle = async (device: 'pump' | 'light') => {
    const mode = device === 'pump' ? pumpMode : lightMode;
    if (mode !== 'manual') {
      toast({
        title: 'Không thể điều khiển',
        description: 'Vui lòng chuyển sang chế độ thủ công để bật/tắt thiết bị',
        variant: 'destructive',
      });
      return;
    }
    
    setIsLoading(device);
    try {
      const currentStatus = device === 'pump' ? isPumpOn : isLightOn;
      const newStatus = !currentStatus;
      await setStreamingControlStatus(device, newStatus);
      
      toast({
        title: device === 'pump' ? 'Máy bơm' : 'Đèn chiếu sáng',
        description: `Đã ${newStatus ? 'bật' : 'tắt'} ${device === 'pump' ? 'máy bơm' : 'đèn'}`,
      });
    } catch (error) {
      toastFirebaseWriteError(error, `Không thể điều khiển ${device === 'pump' ? 'máy bơm' : 'đèn'}`);
    } finally {
      setIsLoading(null);
    }
  };

  const handleSavePumpSchedule = async () => {
    try {
      setIsLoading('pumpSchedule');
      await setStreamingIrrigationTime({
        time1: pumpScheduleTimes[0] ?? 5,
        time2: pumpScheduleTimes[1] ?? 17,
      });

      const validDuration = Math.min(MAX_IRRIGATION_DURATION_MIN, Math.max(MIN_IRRIGATION_DURATION_MIN, editDuration));
      await setIrrigationDurationMin(validDuration);
      setPumpDuration(validDuration);
      
      toast({
        title: 'Đã lưu lịch tưới',
        description: `Tưới lúc ${formatTime(pumpScheduleTimes[0] ?? 5)} và ${formatTime(pumpScheduleTimes[1] ?? 17)} (${validDuration} phút/lần)`,
      });
      setPumpScheduleDialogOpen(false);
    } catch (error) {
      toastFirebaseWriteError(error, 'Không thể lưu lịch tưới');
    } finally {
      setIsLoading(null);
    }
  };

  const handleSaveLightSchedule = async () => {
    try {
      setIsLoading('lightSchedule');
      await setStreamingLightTime(lightOnTime, lightOffTime);
      
      toast({
        title: 'Đã lưu lịch đèn',
        description: `Đèn bật lúc ${formatTime(lightOnTime)}, tắt lúc ${formatTime(lightOffTime)}`,
      });
      setLightScheduleDialogOpen(false);
    } catch (error) {
      toastFirebaseWriteError(error, 'Không thể lưu lịch đèn');
    } finally {
      setIsLoading(null);
    }
  };

  const updatePumpTime = (index: number, value: number) => {
    const newTimes = [...pumpScheduleTimes];
    newTimes[index] = Math.min(23, Math.max(0, value));
    setPumpScheduleTimes(newTimes);
  };

  const formatTime = (hour: number) => `${hour.toString().padStart(2, '0')}:00`;

  return (
    <div className="space-y-6">
      {/* 2 Thẻ điều khiển thiết bị chính */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {/* THẺ 1: MÁY BƠM */}
        <div className={cn(
          'rounded-2xl border p-5 sm:p-6 transition-all duration-300 space-y-4',
          isPumpOn 
            ? 'border-emerald-500/40 bg-emerald-500/5 shadow-xs' 
            : 'border-border bg-card shadow-xs'
        )}>
          {/* Header máy bơm */}
          <div className="flex items-center justify-between pb-3 border-b border-border/60">
            <div className="flex items-center gap-3">
              <div className={cn(
                'h-11 w-11 rounded-xl flex items-center justify-center transition-all',
                isPumpOn 
                  ? 'bg-emerald-500 text-white shadow-xs' 
                  : 'bg-secondary text-muted-foreground'
              )}>
                <Droplets className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-display text-base sm:text-lg font-bold">Máy bơm nước</h3>
                <p className={cn(
                  'text-xs font-semibold flex items-center gap-1.5',
                  isPumpOn ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
                )}>
                  <span className={cn('h-2 w-2 rounded-full', isPumpOn ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/40')} />
                  {isPumpOn ? 'Đang hoạt động' : 'Đã tắt'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={isPumpOn}
                onCheckedChange={() => handleToggle('pump')}
                disabled={isLoading === 'pump' || pumpMode !== 'manual'}
                title={pumpMode === 'manual' ? 'Bật/tắt máy bơm thủ công' : 'Chuyển sang chế độ thủ công để bật/tắt'}
              />
            </div>
          </div>

          {/* Chọn chế độ bơm */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Chế độ điều khiển</label>
            <Select
              value={pumpMode}
              onValueChange={(value) => handlePumpModeChange(value as ControlMode)}
              disabled={isLoading === 'pumpMode'}
            >
              <SelectTrigger className="w-full h-9 text-xs">
                <SelectValue placeholder="Chọn chế độ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  <div className="flex items-center gap-2 text-xs">
                    <Zap className="h-3.5 w-3.5 text-emerald-500" />
                    Tự động (theo ngưỡng cảm biến)
                  </div>
                </SelectItem>
                <SelectItem value="schedule">
                  <div className="flex items-center gap-2 text-xs">
                    <Calendar className="h-3.5 w-3.5 text-sky-500" />
                    Lập lịch (theo khung giờ cố định)
                  </div>
                </SelectItem>
                <SelectItem value="manual">
                  <div className="flex items-center gap-2 text-xs">
                    <Power className="h-3.5 w-3.5 text-amber-500" />
                    Thủ công (điều khiển trực tiếp)
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Chi tiết chế độ Lập lịch */}
          {pumpMode === 'schedule' && (
            <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/20 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sky-700 dark:text-sky-400 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Lịch tưới hàng ngày (2 cữ)
                </span>
                <Dialog open={pumpScheduleDialogOpen} onOpenChange={setPumpScheduleDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 px-2.5 text-[11px] gap-1 bg-background/80">
                      <Settings className="h-3 w-3" />
                      Cài đặt lịch
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2 text-base">
                        <Droplets className="h-4 w-4 text-emerald-500" />
                        Cài đặt lịch tưới máy bơm
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <p className="text-xs text-muted-foreground">
                        Cài đặt 2 mốc giờ trong ngày và thời lượng tưới tự động cho cây ớt.
                      </p>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                          <label className="text-[11px] text-muted-foreground block flex items-center gap-1">
                            <Clock className="h-3 w-3 text-sky-500" />
                            Cữ sáng
                          </label>
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={0}
                              max={23}
                              value={pumpScheduleTimes[0] ?? 5}
                              onChange={(e) => updatePumpTime(0, parseInt(e.target.value, 10) || 0)}
                              className="h-8 text-xs font-semibold"
                            />
                            <span className="text-xs text-muted-foreground font-mono">:00</span>
                          </div>
                        </div>

                        <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                          <label className="text-[11px] text-muted-foreground block flex items-center gap-1">
                            <Clock className="h-3 w-3 text-sky-500" />
                            Cữ chiều
                          </label>
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={0}
                              max={23}
                              value={pumpScheduleTimes[1] ?? 17}
                              onChange={(e) => updatePumpTime(1, parseInt(e.target.value, 10) || 0)}
                              className="h-8 text-xs font-semibold"
                            />
                            <span className="text-xs text-muted-foreground font-mono">:00</span>
                          </div>
                        </div>
                      </div>

                      <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                        <label className="text-[11px] text-muted-foreground block flex items-center gap-1">
                          <Timer className="h-3 w-3 text-emerald-500" />
                          Thời lượng mỗi lần tưới (phút)
                        </label>
                        <Input
                          type="number"
                          min={MIN_IRRIGATION_DURATION_MIN}
                          max={MAX_IRRIGATION_DURATION_MIN}
                          value={editDuration}
                          onChange={(e) => setEditDuration(parseInt(e.target.value, 10) || 1)}
                          className="h-8 text-xs font-semibold"
                        />
                      </div>

                      <Button
                        className="w-full text-xs h-9" 
                        onClick={handleSavePumpSchedule}
                        disabled={isLoading === 'pumpSchedule'}
                      >
                        {isLoading === 'pumpSchedule' ? 'Đang lưu...' : 'Lưu lịch tưới'}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {pumpScheduleTimes.sort((a, b) => a - b).map((time, idx) => (
                  <span 
                    key={idx}
                    className="inline-flex items-center gap-1 bg-sky-500/20 text-sky-800 dark:text-sky-300 px-2.5 py-0.5 rounded-full font-medium"
                  >
                    <Clock className="h-3 w-3" />
                    {formatTime(time)}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2.5 py-0.5 rounded-full font-medium">
                  <Timer className="h-3 w-3" />
                  {pumpDuration} phút / lần
                </span>
              </div>
            </div>
          )}

          {/* Chi tiết chế độ Thủ công */}
          {pumpMode === 'manual' && (
            <div className="pt-1">
              <Button
                variant={isPumpOn ? 'destructive' : 'default'}
                size="sm"
                className="w-full h-9 text-xs gap-2 shadow-xs"
                onClick={() => handleToggle('pump')}
                disabled={isLoading === 'pump'}
              >
                <Power className="h-3.5 w-3.5" />
                {isPumpOn ? 'Tắt máy bơm ngay' : 'Bật máy bơm ngay'}
              </Button>
            </div>
          )}

          {/* Thông báo chế độ Tự động */}
          {pumpMode === 'auto' && (
            <div className="p-3 rounded-xl bg-secondary/50 border border-border text-xs text-muted-foreground flex items-start gap-2">
              <Info className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>Máy bơm tự động kích hoạt khi độ ẩm đất thấp hơn ngưỡng cho phép (cấu hình tại thẻ Cây trồng &amp; ngưỡng).</span>
            </div>
          )}

          {pumpMode !== 'manual' && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1 pt-0.5">
              <Lock className="h-3 w-3" />
              Chuyển sang chế độ thủ công nếu muốn bật/tắt thiết bị tức thời.
            </p>
          )}
        </div>

        {/* THẺ 2: ĐÈN CHIẾU SÁNG */}
        <div className={cn(
          'rounded-2xl border p-5 sm:p-6 transition-all duration-300 space-y-4',
          isLightOn 
            ? 'border-amber-500/40 bg-amber-500/5 shadow-xs' 
            : 'border-border bg-card shadow-xs'
        )}>
          {/* Header đèn */}
          <div className="flex items-center justify-between pb-3 border-b border-border/60">
            <div className="flex items-center gap-3">
              <div className={cn(
                'h-11 w-11 rounded-xl flex items-center justify-center transition-all',
                isLightOn 
                  ? 'bg-amber-500 text-white shadow-xs' 
                  : 'bg-secondary text-muted-foreground'
              )}>
                <Sun className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-display text-base sm:text-lg font-bold">Đèn quang kỳ (Chiếu sáng)</h3>
                <p className={cn(
                  'text-xs font-semibold flex items-center gap-1.5',
                  isLightOn ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
                )}>
                  <span className={cn('h-2 w-2 rounded-full', isLightOn ? 'bg-amber-500 animate-pulse' : 'bg-muted-foreground/40')} />
                  {isLightOn ? 'Đang bật' : 'Đã tắt'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={isLightOn}
                onCheckedChange={() => handleToggle('light')}
                disabled={isLoading === 'light' || lightMode !== 'manual'}
                title={lightMode === 'manual' ? 'Bật/tắt đèn thủ công' : 'Chuyển sang chế độ thủ công để bật/tắt'}
              />
            </div>
          </div>

          {/* Chọn chế độ đèn */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Chế độ điều khiển</label>
            <Select
              value={lightMode}
              onValueChange={(value) => handleLightModeChange(value as ControlMode)}
              disabled={isLoading === 'lightMode'}
            >
              <SelectTrigger className="w-full h-9 text-xs">
                <SelectValue placeholder="Chọn chế độ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  <div className="flex items-center gap-2 text-xs">
                    <Zap className="h-3.5 w-3.5 text-emerald-500" />
                    Tự động (theo chu kỳ sinh trưởng cây)
                  </div>
                </SelectItem>
                <SelectItem value="schedule">
                  <div className="flex items-center gap-2 text-xs">
                    <Calendar className="h-3.5 w-3.5 text-amber-500" />
                    Lập lịch (khoảng giờ bật / tắt)
                  </div>
                </SelectItem>
                <SelectItem value="manual">
                  <div className="flex items-center gap-2 text-xs">
                    <Power className="h-3.5 w-3.5 text-amber-500" />
                    Thủ công (điều khiển trực tiếp)
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Chi tiết chế độ Lập lịch */}
          {lightMode === 'schedule' && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <Sun className="h-3.5 w-3.5 text-amber-600" />
                  Lịch chiếu sáng hàng ngày
                </span>
                <Dialog open={lightScheduleDialogOpen} onOpenChange={setLightScheduleDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 px-2.5 text-[11px] gap-1 bg-background/80">
                      <Settings className="h-3 w-3" />
                      Cài đặt lịch
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2 text-base">
                        <Sun className="h-4 w-4 text-amber-500" />
                        Cài đặt lịch chiếu sáng
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <p className="text-xs text-muted-foreground">
                        Cài đặt thời điểm bật đèn và tắt đèn quang kỳ trong ngày.
                      </p>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                          <label className="text-[11px] text-muted-foreground block flex items-center gap-1">
                            <Sun className="h-3 w-3 text-amber-500" />
                            Giờ bật
                          </label>
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={0}
                              max={23}
                              value={lightOnTime}
                              onChange={(e) => setLightOnTime(Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                              className="h-8 text-xs font-semibold"
                            />
                            <span className="text-xs text-muted-foreground font-mono">:00</span>
                          </div>
                        </div>

                        <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                          <label className="text-[11px] text-muted-foreground block flex items-center gap-1">
                            <Power className="h-3 w-3 text-muted-foreground" />
                            Giờ tắt
                          </label>
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={0}
                              max={23}
                              value={lightOffTime}
                              onChange={(e) => setLightOffTime(Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                              className="h-8 text-xs font-semibold"
                            />
                            <span className="text-xs text-muted-foreground font-mono">:00</span>
                          </div>
                        </div>
                      </div>

                      <Button 
                        className="w-full text-xs h-9" 
                        onClick={handleSaveLightSchedule}
                        disabled={isLoading === 'lightSchedule'}
                      >
                        {isLoading === 'lightSchedule' ? 'Đang lưu...' : 'Lưu lịch đèn'}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="flex items-center gap-2.5 bg-background/80 px-3 py-1.5 rounded-lg border border-border">
                <Sun className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span className="font-semibold text-amber-800 dark:text-amber-300">{formatTime(lightOnTime)}</span>
                <span className="text-muted-foreground">→</span>
                <Power className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium text-foreground">{formatTime(lightOffTime)}</span>
              </div>
            </div>
          )}

          {/* Chi tiết chế độ Thủ công */}
          {lightMode === 'manual' && (
            <div className="pt-1">
              <Button
                variant={isLightOn ? 'destructive' : 'default'}
                size="sm"
                className="w-full h-9 text-xs gap-2 shadow-xs"
                onClick={() => handleToggle('light')}
                disabled={isLoading === 'light'}
              >
                <Power className="h-3.5 w-3.5" />
                {isLightOn ? 'Tắt đèn ngay' : 'Bật đèn ngay'}
              </Button>
            </div>
          )}

          {/* Thông báo chế độ Tự động */}
          {lightMode === 'auto' && (
            <div className="p-3 rounded-xl bg-secondary/50 border border-border text-xs text-muted-foreground flex items-start gap-2">
              <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <span>Đèn tự động bật bổ sung quang kỳ theo giai đoạn phát triển hiện tại của cây ớt.</span>
            </div>
          )}

          {lightMode !== 'manual' && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1 pt-0.5">
              <Lock className="h-3 w-3" />
              Chuyển sang chế độ thủ công nếu muốn bật/tắt thiết bị tức thời.
            </p>
          )}
        </div>
      </div>

      {/* Thẻ Thống kê thời gian hoạt động thiết bị */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-border/60">
          <h3 className="font-display text-base font-bold flex items-center gap-2">
            <Timer className="h-4 w-4 text-primary" />
            Thống kê thời lượng hoạt động trong ngày
          </h3>
          <span className="text-xs text-muted-foreground">Hôm nay</span>
        </div>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          {/* Thống kê máy bơm */}
          <div className="rounded-xl border border-border/80 bg-secondary/20 p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Droplets className="h-4 w-4" />
              </div>
              <div>
                <h4 className="font-semibold text-xs text-foreground">Máy bơm nước</h4>
                <p className="text-[11px] text-muted-foreground">Thời gian kích hoạt</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-background/80 p-2.5 rounded-lg border border-border">
                <p className="text-[11px] text-muted-foreground mb-0.5">Tổng hôm nay</p>
                <p className="font-display text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  {pumpInfo.daily_time ?? '--'} phút
                </p>
              </div>
              <div className="bg-background/80 p-2.5 rounded-lg border border-border">
                <p className="text-[11px] text-muted-foreground mb-0.5">Lần bật cuối</p>
                <p className="font-medium text-xs truncate" title={pumpInfo.last_on_time ? formatDateTimeVN(new Date(Number(pumpInfo.last_on_time) * 1000 - 7 * 60 * 60 * 1000)) : '--'}>
                  {pumpInfo.last_on_time ? formatDateTimeVN(new Date(Number(pumpInfo.last_on_time) * 1000 - 7 * 60 * 60 * 1000)) : 'Chưa có'}
                </p>
              </div>
            </div>
          </div>

          {/* Thống kê đèn chiếu sáng */}
          <div className="rounded-xl border border-border/80 bg-secondary/20 p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-center justify-center">
                <Sun className="h-4 w-4" />
              </div>
              <div>
                <h4 className="font-semibold text-xs text-foreground">Đèn chiếu sáng</h4>
                <p className="text-[11px] text-muted-foreground">Thời gian phát quang</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-background/80 p-2.5 rounded-lg border border-border">
                <p className="text-[11px] text-muted-foreground mb-0.5">Tổng hôm nay</p>
                <p className="font-display text-lg font-bold text-amber-700 dark:text-amber-400">
                  {lightInfo.daily_time ?? '--'} phút
                </p>
              </div>
              <div className="bg-background/80 p-2.5 rounded-lg border border-border">
                <p className="text-[11px] text-muted-foreground mb-0.5">Lần bật cuối</p>
                <p className="font-medium text-xs truncate" title={lightInfo?.last_on_time ? formatDateTimeVN(new Date(+lightInfo.last_on_time * 1000 - 7 * 60 * 60 * 1000)) : '--'}>
                  {lightInfo?.last_on_time ? formatDateTimeVN(new Date(+lightInfo.last_on_time * 1000 - 7 * 60 * 60 * 1000)) : 'Chưa có'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
