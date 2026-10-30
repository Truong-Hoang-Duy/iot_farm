import { useState, useEffect } from 'react';
import { Power, Droplets, Sun, Clock, Lock, Settings, Calendar, Zap, Timer } from 'lucide-react';
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
} from '@/services/firebaseAPI';
import { controlAPI, ActivityLog } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import { ControlsSkeleton } from '@/components/common/LoadingStates';

type ControlMode = 'auto' | 'schedule' | 'manual';

const modeToNumber: Record<ControlMode, number> = {
  auto: 1,
  schedule: 2,
  manual: 0,
};

const numberToMode = (num: number | string | undefined): ControlMode => {
  if (num === undefined || num === '') return 'auto';
  const n = typeof num === 'string' ? parseInt(num) : num;
  if (n === 0) return 'manual';
  if (n === 2) return 'schedule';
  return 'auto';
};

export default function ControlsPage() {
  const [streamingConfig, setStreamingConfig] = useState<StreamingConfig | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityLog[]>([]);
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  
  // Separate modes for pump and light
  const [pumpMode, setPumpMode] = useState<ControlMode>('auto');
  const [lightMode, setLightMode] = useState<ControlMode>('auto');
  
  // Schedule states
  const [pumpScheduleDialogOpen, setPumpScheduleDialogOpen] = useState(false);
  const [lightScheduleDialogOpen, setLightScheduleDialogOpen] = useState(false);
  const [pumpScheduleTimes, setPumpScheduleTimes] = useState<number[]>([5, 17]);
  const [lightOnTime, setLightOnTime] = useState<number>(6);
  const [lightOffTime, setLightOffTime] = useState<number>(18);
  
  const { toast } = useToast();

  // Derived state from streaming config - listen to streaming/control for status
  const pumpInfo = streamingConfig?.control?.pump 
    ? getControlDeviceStatus(streamingConfig.control.pump) 
    : { status: false, daily_time: 0, last_on_time: '' };
  const lightInfo = streamingConfig?.control?.light 
    ? getControlDeviceStatus(streamingConfig.control.light) 
    : { status: false, daily_time: 0, last_on_time: '' };

  const isPumpOn = pumpInfo.status;
  const isLightOn = lightInfo.status;

  useEffect(() => {
    const unsubscribe = subscribeStreamingConfig((config) => {
      setStreamingConfig(config);
      
      // Initialize pump mode from config
      if (config?.config?.irrigation_mode !== undefined) {
        setPumpMode(numberToMode(config.config.irrigation_mode));
      }
      
      // Initialize light mode from config
      if (config?.config?.light_mode !== undefined) {
        setLightMode(numberToMode(config.config.light_mode));
      }
      
      // Update pump schedule times from config
      if (config?.config?.irrigation_time) {
        const times = Object.values(config.config.irrigation_time).filter(t => typeof t === 'number');
        if (times.length > 0) {
          setPumpScheduleTimes(times);
        }
      }
      
      // Update light schedule from config (single on/off)
      if (config?.config?.light_time) {
        const lt = config.config.light_time;
        if (lt.on !== undefined && lt.on !== '') {
          setLightOnTime(typeof lt.on === 'string' ? parseInt(lt.on) || 6 : lt.on);
        }
        if (lt.off !== undefined && lt.off !== '') {
          setLightOffTime(typeof lt.off === 'string' ? parseInt(lt.off) || 18 : lt.off);
        }
      }
      
      setIsInitialLoading(false);
    });

    controlAPI.getActivityLog().then(setActivityLog).catch(console.error);

    return () => unsubscribe();
  }, []);

  const handlePumpModeChange = async (mode: ControlMode) => {
    try {
      setIsLoading('pumpMode');
      setPumpMode(mode);
      
      // Update Firebase with pump mode
      await setStreamingIrrigationMode(modeToNumber[mode]);
      
      const modeLabels = { auto: 'Tự động', schedule: 'Lập lịch', manual: 'Thủ công' };
      toast({
        title: "Đã thay đổi chế độ bơm",
        description: `Chế độ bơm đã chuyển sang ${modeLabels[mode]}`,
      });
    } catch (error) {
      console.error('[Controls] Error changing pump mode:', error);
      toast({
        title: "Lỗi",
        description: "Không thể thay đổi chế độ bơm",
        variant: "destructive",
      });
    } finally {
      setIsLoading(null);
    }
  };

  const handleLightModeChange = async (mode: ControlMode) => {
    try {
      setIsLoading('lightMode');
      setLightMode(mode);
      
      // Update Firebase with light mode
      await setStreamingLightMode(modeToNumber[mode]);
      
      const modeLabels = { auto: 'Tự động', schedule: 'Lập lịch', manual: 'Thủ công' };
      toast({
        title: "Đã thay đổi chế độ đèn",
        description: `Chế độ đèn đã chuyển sang ${modeLabels[mode]}`,
      });
    } catch (error) {
      console.error('[Controls] Error changing light mode:', error);
      toast({
        title: "Lỗi",
        description: "Không thể thay đổi chế độ đèn",
        variant: "destructive",
      });
    } finally {
      setIsLoading(null);
    }
  };

  const handleToggle = async (device: 'pump' | 'light') => {
    const mode = device === 'pump' ? pumpMode : lightMode;
    if (mode !== 'manual') {
      toast({
        title: "Không thể điều khiển",
        description: "Vui lòng chuyển sang chế độ thủ công để điều khiển thiết bị",
        variant: "destructive",
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
      
      const logs = await controlAPI.getActivityLog();
      setActivityLog(logs);
    } catch (error) {
      console.error(`[Controls] Error toggling ${device}:`, error);
      toast({
        title: "Lỗi",
        description: `Không thể điều khiển ${device === 'pump' ? 'máy bơm' : 'đèn'}`,
        variant: "destructive",
      });
    } finally {
      setIsLoading(null);
    }
  };

  const handleSavePumpSchedule = async () => {
    try {
      setIsLoading('pumpSchedule');
      
      // Set time1 and time2 individually
      await setStreamingIrrigationTime({
        time1: pumpScheduleTimes[0] ?? 5,
        time2: pumpScheduleTimes[1] ?? 17,
      });
      
      toast({
        title: "Đã lưu lịch tưới",
        description: `Đã cập nhật 2 thời điểm tưới`,
      });
      
      setPumpScheduleDialogOpen(false);
    } catch (error) {
      console.error('[Controls] Error saving pump schedule:', error);
      toast({
        title: "Lỗi",
        description: "Không thể lưu lịch tưới",
        variant: "destructive",
      });
    } finally {
      setIsLoading(null);
    }
  };

  const handleSaveLightSchedule = async () => {
    try {
      setIsLoading('lightSchedule');
      
      await setStreamingLightTime(lightOnTime, lightOffTime);
      
      toast({
        title: "Đã lưu lịch đèn",
        description: `Đèn bật lúc ${formatTime(lightOnTime)}, tắt lúc ${formatTime(lightOffTime)}`,
      });
      
      setLightScheduleDialogOpen(false);
    } catch (error) {
      console.error('[Controls] Error saving light schedule:', error);
      toast({
        title: "Lỗi",
        description: "Không thể lưu lịch đèn",
        variant: "destructive",
      });
    } finally {
      setIsLoading(null);
    }
  };

  // Pump schedule helpers - only 2 fixed time slots
  const updatePumpTime = (index: number, value: number) => {
    const newTimes = [...pumpScheduleTimes];
    newTimes[index] = Math.min(23, Math.max(0, value));
    setPumpScheduleTimes(newTimes);
  };

  const formatTime = (hour: number) => `${hour.toString().padStart(2, '0')}:00`;

  const formatDailyTime = (hours: number) => {
    if (hours < 1) return `${Math.round(hours * 60)} phút`;
    return `${hours.toFixed(1)} giờ`;
  };

  if (isInitialLoading) {
    return <ControlsSkeleton />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="font-display text-3xl font-bold">Điều khiển</h1>
        <p className="text-muted-foreground mt-1">
          Quản lý thiết bị tưới tiêu và chiếu sáng
        </p>
      </div>

      {/* Device Control Cards with Separate Modes */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pump Control Card */}
        <div className={cn(
          "rounded-2xl border-2 p-6 transition-all duration-300",
          isPumpOn 
            ? "border-water bg-water/5 shadow-lg shadow-water/20" 
            : "border-border bg-card"
        )}>
          {/* Pump Header */}
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className={cn(
                "h-14 w-14 rounded-2xl flex items-center justify-center transition-all",
                isPumpOn 
                  ? "bg-water text-water-foreground" 
                  : "bg-secondary text-muted-foreground"
              )}>
                <Droplets className="h-7 w-7" />
              </div>
              <div>
                <h3 className="font-display text-xl font-semibold">Máy bơm</h3>
                <p className={cn(
                  "text-sm font-medium",
                  isPumpOn ? "text-water" : "text-muted-foreground"
                )}>
                  {isPumpOn ? 'Đang hoạt động' : 'Đã tắt'}
                </p>
              </div>
            </div>
            <Switch
              checked={isPumpOn}
              onCheckedChange={() => handleToggle('pump')}
              disabled={isLoading === 'pump' || pumpMode !== 'manual'}
            />
          </div>

          {/* Pump Mode Selector */}
          <div className="mb-4">
            <label className="text-sm font-medium text-muted-foreground mb-2 block">Chế độ điều khiển</label>
            <Select
              value={pumpMode}
              onValueChange={(value) => handlePumpModeChange(value as ControlMode)}
              disabled={isLoading === 'pumpMode'}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn chế độ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-success" />
                    Tự động
                  </div>
                </SelectItem>
                <SelectItem value="schedule">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-accent" />
                    Lập lịch
                  </div>
                </SelectItem>
                <SelectItem value="manual">
                  <div className="flex items-center gap-2">
                    <Power className="h-4 w-4 text-warning" />
                    Thủ công
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Pump Schedule Section */}
          {pumpMode === 'schedule' && (
            <div className="mb-4 p-3 rounded-xl bg-water/10 border border-water/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-water" />
                  Lịch tưới ({pumpScheduleTimes.length} lần/ngày)
                </span>
                <Dialog open={pumpScheduleDialogOpen} onOpenChange={setPumpScheduleDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1 h-7">
                      <Settings className="h-3 w-3" />
                      Cài đặt
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Droplets className="h-5 w-5 text-water" />
                        Cài đặt lịch tưới
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <p className="text-sm text-muted-foreground">
                        Cài đặt 2 thời điểm trong ngày để hệ thống tự động bật tưới
                      </p>
                      <div className="space-y-3">
                        {/* Time 1 */}
                        <div className="flex items-center gap-3 p-3 bg-secondary/30 rounded-lg">
                          <Clock className="h-4 w-4 text-water shrink-0" />
                          <div className="flex-1">
                            <label className="text-xs text-muted-foreground mb-1 block">
                              Thời điểm 1 (sáng)
                            </label>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={0}
                                max={23}
                                value={pumpScheduleTimes[0] ?? 5}
                                onChange={(e) => updatePumpTime(0, parseInt(e.target.value) || 0)}
                                className="w-20"
                              />
                              <span className="text-muted-foreground">:00</span>
                            </div>
                          </div>
                        </div>
                        {/* Time 2 */}
                        <div className="flex items-center gap-3 p-3 bg-secondary/30 rounded-lg">
                          <Clock className="h-4 w-4 text-water shrink-0" />
                          <div className="flex-1">
                            <label className="text-xs text-muted-foreground mb-1 block">
                              Thời điểm 2 (chiều)
                            </label>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={0}
                                max={23}
                                value={pumpScheduleTimes[1] ?? 17}
                                onChange={(e) => updatePumpTime(1, parseInt(e.target.value) || 0)}
                                className="w-20"
                              />
                              <span className="text-muted-foreground">:00</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <Button
                        className="w-full" 
                        onClick={handleSavePumpSchedule}
                        disabled={isLoading === 'pumpSchedule'}
                      >
                        {isLoading === 'pumpSchedule' ? 'Đang lưu...' : 'Lưu lịch tưới'}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="flex flex-wrap gap-2">
                {pumpScheduleTimes.sort((a, b) => a - b).map((time, index) => (
                  <div 
                    key={index}
                    className="flex items-center gap-1 bg-water/20 text-water px-3 py-1 rounded-full text-sm font-medium"
                  >
                    <Clock className="h-3 w-3" />
                    {formatTime(time)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pump Manual Control */}
          {pumpMode === 'manual' && (
            <Button
              variant="outline"
              size="sm"
              className="w-full mb-4"
              onClick={() => handleToggle('pump')}
              disabled={isLoading === 'pump'}
            >
              <Power className="h-4 w-4 mr-2" />
              {isPumpOn ? 'Tắt máy bơm' : 'Bật máy bơm'}
            </Button>
          )}
          
          {pumpMode !== 'manual' && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mb-4">
              <Lock className="h-3 w-3" />
              Chuyển sang chế độ thủ công để điều khiển
            </p>
          )}
        </div>

        {/* Light Control Card */}
        <div className={cn(
          "rounded-2xl border-2 p-6 transition-all duration-300",
          isLightOn 
            ? "border-warning bg-warning/5 shadow-lg shadow-warning/20" 
            : "border-border bg-card"
        )}>
          {/* Light Header */}
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className={cn(
                "h-14 w-14 rounded-2xl flex items-center justify-center transition-all",
                isLightOn 
                  ? "bg-warning text-warning-foreground" 
                  : "bg-secondary text-muted-foreground"
              )}>
                <Sun className="h-7 w-7" />
              </div>
              <div>
                <h3 className="font-display text-xl font-semibold">Đèn chiếu sáng</h3>
                <p className={cn(
                  "text-sm font-medium",
                  isLightOn ? "text-warning" : "text-muted-foreground"
                )}>
                  {isLightOn ? 'Đang bật' : 'Đã tắt'}
                </p>
              </div>
            </div>
            <Switch
              checked={isLightOn}
              onCheckedChange={() => handleToggle('light')}
              disabled={isLoading === 'light' || lightMode !== 'manual'}
            />
          </div>

          {/* Light Mode Selector */}
          <div className="mb-4">
            <label className="text-sm font-medium text-muted-foreground mb-2 block">Chế độ điều khiển</label>
            <Select
              value={lightMode}
              onValueChange={(value) => handleLightModeChange(value as ControlMode)}
              disabled={isLoading === 'lightMode'}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn chế độ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-success" />
                    Tự động
                  </div>
                </SelectItem>
                <SelectItem value="schedule">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-accent" />
                    Lập lịch
                  </div>
                </SelectItem>
                <SelectItem value="manual">
                  <div className="flex items-center gap-2">
                    <Power className="h-4 w-4 text-warning" />
                    Thủ công
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Light Schedule Section - Single on/off time */}
          {lightMode === 'schedule' && (
            <div className="mb-4 p-3 rounded-xl bg-warning/10 border border-warning/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-warning" />
                  Lịch chiếu sáng
                </span>
                <Dialog open={lightScheduleDialogOpen} onOpenChange={setLightScheduleDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1 h-7">
                      <Settings className="h-3 w-3" />
                      Cài đặt
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <Sun className="h-5 w-5 text-warning" />
                        Cài đặt lịch chiếu sáng
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <p className="text-sm text-muted-foreground">
                        Cài đặt giờ bật và tắt đèn trong ngày
                      </p>
                      <div className="p-4 bg-secondary/30 rounded-lg space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-sm text-muted-foreground mb-2 block flex items-center gap-1">
                              <Sun className="h-4 w-4 text-warning" /> Giờ bật
                            </label>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={0}
                                max={23}
                                value={lightOnTime}
                                onChange={(e) => setLightOnTime(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                                className="w-20"
                              />
                              <span className="text-muted-foreground">:00</span>
                            </div>
                          </div>
                          <div>
                            <label className="text-sm text-muted-foreground mb-2 block flex items-center gap-1">
                              <Power className="h-4 w-4 text-muted-foreground" /> Giờ tắt
                            </label>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={0}
                                max={23}
                                value={lightOffTime}
                                onChange={(e) => setLightOffTime(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                                className="w-20"
                              />
                              <span className="text-muted-foreground">:00</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <Button 
                        className="w-full" 
                        onClick={handleSaveLightSchedule}
                        disabled={isLoading === 'lightSchedule'}
                      >
                        {isLoading === 'lightSchedule' ? 'Đang lưu...' : 'Lưu lịch đèn'}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="flex items-center gap-3 bg-amber-500/15 border border-amber-500/30 px-4 py-2 rounded-lg">
                <Sun className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                <span className="text-amber-800 dark:text-amber-300 font-semibold">{formatTime(lightOnTime)}</span>
                <span className="text-muted-foreground">→</span>
                <Power className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{formatTime(lightOffTime)}</span>
              </div>
            </div>
          )}

          {/* Light Manual Control */}
          {lightMode === 'manual' && (
            <Button
              variant="outline"
              size="sm"
              className="w-full mb-4"
              onClick={() => handleToggle('light')}
              disabled={isLoading === 'light'}
            >
              <Power className="h-4 w-4 mr-2" />
              {isLightOn ? 'Tắt đèn' : 'Bật đèn'}
            </Button>
          )}
          
          {lightMode !== 'manual' && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mb-4">
              <Lock className="h-3 w-3" />
              Chuyển sang chế độ thủ công để điều khiển
            </p>
          )}
        </div>
      </div>

      {/* Runtime Statistics Section */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h3 className="font-display text-xl font-semibold mb-4 flex items-center gap-2">
          <Timer className="h-5 w-5 text-accent" />
          Thống kê hoạt động
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Pump Stats */}
          <div className="rounded-xl border border-water/30 bg-water/5 p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-xl bg-water/20 flex items-center justify-center">
                <Droplets className="h-5 w-5 text-water" />
              </div>
              <h4 className="font-semibold text-water">Máy bơm</h4>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-background/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">Tổng thời gian hôm nay</p>
                <p className="font-display text-xl font-bold text-water">
                  {pumpInfo.daily_time ?? "--"} phút
                </p>
              </div>
              <div className="rounded-lg bg-background/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">Lần bật cuối</p>
                <p className="font-display text-base font-semibold">
                  {pumpInfo.last_on_time ? formatDateTimeVN(new Date(Number(pumpInfo.last_on_time) * 1000 - 7 * 60 * 60 * 1000)) : "--:--"}
                </p>
              </div>
            </div>
          </div>

          {/* Light Stats */}
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
                <Sun className="h-5 w-5 text-amber-700 dark:text-amber-400" />
              </div>
              <h4 className="font-bold text-amber-800 dark:text-amber-300">Đèn chiếu sáng</h4>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-background/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">Tổng thời gian hôm nay</p>
                <p className="font-display text-xl font-bold text-amber-700 dark:text-amber-400">
                  {lightInfo.daily_time ?? "--"} phút
                </p>
              </div>
              <div className="rounded-lg bg-background/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">Lần bật cuối</p>
                <p className="font-display text-base font-semibold">
                  {lightInfo?.last_on_time ? formatDateTimeVN(new Date(+lightInfo.last_on_time * 1000 - 7 * 60 * 60 * 1000)) : "--:--"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
