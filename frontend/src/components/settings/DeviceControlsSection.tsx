import { useState, useEffect } from 'react';
import { Power, Droplets, Sun, Clock, Lock, Settings, Calendar, Zap, Timer, Info, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  subscribeStreamingConfig,
  setStreamingIrrigationMode,
  setStreamingLightMode,
  setStreamingControlStatus,
  setStreamingIrrigationTime,
  setStreamingLightTime,
  setStreamingLightSlots,
  getControlDeviceStatus,
  normalizeScheduleClock,
  formatDailyRuntimeVi,
  formatLastOnTimeVi,
  StreamingConfig,
  setIrrigationDurationMin,
  subscribeStreamingConfigField,
  DEFAULT_IRRIGATION_DURATION_MIN,
  MIN_IRRIGATION_DURATION_MIN,
  MAX_IRRIGATION_DURATION_MIN,
  DEFAULT_LIGHT_DURATION_MIN,
  MIN_LIGHT_DURATION_MIN,
  MAX_LIGHT_DURATION_MIN,
} from '@/services/firebaseAPI';
import { useToast } from '@/hooks/use-toast';
import { toastFirebaseWriteError } from '@/lib/firebaseErrors';

type ControlMode = 'auto' | 'schedule' | 'manual';
type LightScheduleStyle = 'window' | 'slots';

const modeToNumber: Record<ControlMode, number> = {
  auto: 1,
  schedule: 2,
  manual: 0,
};

const numberToMode = (num: number | string | undefined): ControlMode => {
  if (num === undefined || num === '') return 'manual';
  const n = typeof num === 'string' ? parseInt(num, 10) : num;
  if (n === 0) return 'manual';
  if (n === 2) return 'schedule';
  return 'auto';
};

/** Tính khung giờ bù quang kỳ tự động trên UI khớp với logic trên thiết bị biên. */
function getAutoPhotoperiodLabel(ageDays?: number): string {
  const age = typeof ageDays === 'number' && ageDays > 0 ? ageDays : 45;
  if (age <= 25) return '05:00 – 06:00 và 17:30 – 21:30';
  if (age <= 55) return '05:30 – 06:00 và 17:30 – 21:00';
  if (age <= 135) return '17:30 – 20:30';
  if (age <= 220) return '17:30 – 19:30';
  return '17:30 – 18:30';
}

export function DeviceControlsSection() {
  const [streamingConfig, setStreamingConfig] = useState<StreamingConfig | null>(null);
  const [isLoading, setIsLoading] = useState<string | null>(null);

  // Chế độ riêng biệt cho máy bơm và đèn chiếu sáng
  const [pumpMode, setPumpMode] = useState<ControlMode>('auto');
  const [lightMode, setLightMode] = useState<ControlMode>('auto');

  // Trạng thái lập lịch máy bơm
  const [pumpScheduleDialogOpen, setPumpScheduleDialogOpen] = useState(false);
  const [pumpTime1, setPumpTime1] = useState<string>('06:00');
  const [pumpTime2, setPumpTime2] = useState<string>('17:00');
  const [pumpTime3Enabled, setPumpTime3Enabled] = useState<boolean>(false);
  const [pumpTime3, setPumpTime3] = useState<string>('11:30');
  const [pumpDuration, setPumpDuration] = useState<number>(DEFAULT_IRRIGATION_DURATION_MIN);
  const [editPumpDuration, setEditPumpDuration] = useState<number>(DEFAULT_IRRIGATION_DURATION_MIN);

  // Trạng thái lập lịch đèn - hỗ trợ cả theo khoảng giờ (window) & theo cữ (slots)
  const [lightScheduleDialogOpen, setLightScheduleDialogOpen] = useState(false);
  const [lightScheduleStyle, setLightScheduleStyle] = useState<LightScheduleStyle>('window');
  const [lightOnTime, setLightOnTime] = useState<string>('06:00');
  const [lightOffTime, setLightOffTime] = useState<string>('18:00');
  const [lightWindow2Enabled, setLightWindow2Enabled] = useState<boolean>(false);
  const [lightOnTime2, setLightOnTime2] = useState<string>('18:30');
  const [lightOffTime2, setLightOffTime2] = useState<string>('21:00');

  const [lightSlot1, setLightSlot1] = useState<string>('05:30');
  const [lightSlot2, setLightSlot2] = useState<string>('18:00');
  const [lightSlot3Enabled, setLightSlot3Enabled] = useState<boolean>(false);
  const [lightSlot3, setLightSlot3] = useState<string>('21:00');
  const [lightDuration, setLightDuration] = useState<number>(DEFAULT_LIGHT_DURATION_MIN);
  const [editLightDuration, setEditLightDuration] = useState<number>(DEFAULT_LIGHT_DURATION_MIN);

  const { toast } = useToast();

  // Đọc trạng thái thiết bị theo đúng chế độ đang vận hành
  const pumpInfo = getControlDeviceStatus(streamingConfig?.control?.pump, pumpMode);
  const lightInfo = getControlDeviceStatus(streamingConfig?.control?.light, lightMode);

  const isPumpOn = pumpInfo.status;
  const isLightOn = lightInfo.status;

  const moistureThreshold = streamingConfig?.config?.threshold?.soil_moisture ?? { low: 40, high: 80 };
  const plantAgeDays = streamingConfig?.config?.plant?.age_days;
  const plantStageName = streamingConfig?.config?.plant?.growth_stage;

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
        const it = config.config.irrigation_time;
        if (it.time1 !== undefined && it.time1 !== '') {
          setPumpTime1(normalizeScheduleClock(it.time1, '06:00'));
        }
        if (it.time2 !== undefined && it.time2 !== '') {
          setPumpTime2(normalizeScheduleClock(it.time2, '17:00'));
        }
        if (it.time3 !== undefined && it.time3 !== '') {
          setPumpTime3Enabled(true);
          setPumpTime3(normalizeScheduleClock(it.time3, '11:30'));
        } else {
          setPumpTime3Enabled(false);
        }
      }

      if (config?.config?.light_time) {
        const lt = config.config.light_time;
        const style: LightScheduleStyle =
          lt.mode === 'slots' || (lt.time1 !== undefined && lt.on === undefined) ? 'slots' : 'window';
        setLightScheduleStyle(style);

        if (lt.on !== undefined && lt.on !== '') {
          setLightOnTime(normalizeScheduleClock(lt.on, '06:00'));
        }
        if (lt.off !== undefined && lt.off !== '') {
          setLightOffTime(normalizeScheduleClock(lt.off, '18:00'));
        }
        if (lt.on2 && lt.off2) {
          setLightWindow2Enabled(true);
          setLightOnTime2(normalizeScheduleClock(lt.on2, '18:30'));
          setLightOffTime2(normalizeScheduleClock(lt.off2, '21:00'));
        } else {
          setLightWindow2Enabled(false);
        }

        if (lt.time1 !== undefined && lt.time1 !== '') {
          setLightSlot1(normalizeScheduleClock(lt.time1, '05:30'));
        }
        if (lt.time2 !== undefined && lt.time2 !== '') {
          setLightSlot2(normalizeScheduleClock(lt.time2, '18:00'));
        }
        if (lt.time3 !== undefined && lt.time3 !== '') {
          setLightSlot3Enabled(true);
          setLightSlot3(normalizeScheduleClock(lt.time3, '21:00'));
        } else {
          setLightSlot3Enabled(false);
        }
      }
    });

    const unsubscribeIrrDuration = subscribeStreamingConfigField('irrigation_duration_min', (val) => {
      if (typeof val === 'number') {
        setPumpDuration(val);
        setEditPumpDuration(val);
      }
    });

    const unsubscribeLightDuration = subscribeStreamingConfigField('light_duration_min', (val) => {
      if (typeof val === 'number') {
        setLightDuration(val);
        setEditLightDuration(val);
      }
    });

    return () => {
      unsubscribeConfig();
      unsubscribeIrrDuration();
      unsubscribeLightDuration();
    };
  }, []);

  const handlePumpModeChange = async (mode: ControlMode) => {
    try {
      setIsLoading('pumpMode');
      setPumpMode(mode);
      await setStreamingIrrigationMode(modeToNumber[mode]);

      const modeLabels: Record<ControlMode, string> = {
        auto: 'tự động',
        schedule: 'lập lịch',
        manual: 'thủ công',
      };
      toast({
        title: 'Đã thay đổi chế độ máy bơm',
        description: `Máy bơm nước đã chuyển sang chế độ ${modeLabels[mode]}.`,
      });
    } catch (error) {
      toastFirebaseWriteError(error, 'Không thể thay đổi chế độ máy bơm');
    } finally {
      setIsLoading(null);
    }
  };

  const handleLightModeChange = async (mode: ControlMode) => {
    try {
      setIsLoading('lightMode');
      setLightMode(mode);
      await setStreamingLightMode(modeToNumber[mode]);

      const modeLabels: Record<ControlMode, string> = {
        auto: 'tự động',
        schedule: 'lập lịch',
        manual: 'thủ công',
      };
      toast({
        title: 'Đã thay đổi chế độ đèn',
        description: `Đèn chiếu sáng đã chuyển sang chế độ ${modeLabels[mode]}.`,
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
        title: 'Không thể điều khiển trực tiếp',
        description: 'Vui lòng chuyển sang chế độ thủ công để bật/tắt thiết bị.',
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
        title: device === 'pump' ? 'Máy bơm nước' : 'Đèn chiếu sáng',
        description: `Đã gửi lệnh ${newStatus ? 'bật' : 'tắt'} ${device === 'pump' ? 'máy bơm' : 'đèn chiếu sáng'}.`,
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
      const t1 = normalizeScheduleClock(pumpTime1, '06:00');
      const t2 = normalizeScheduleClock(pumpTime2, '17:00');
      const t3 = pumpTime3Enabled ? normalizeScheduleClock(pumpTime3, '11:30') : null;

      await setStreamingIrrigationTime({ time1: t1, time2: t2, time3: t3 });

      const validDuration = Math.min(
        MAX_IRRIGATION_DURATION_MIN,
        Math.max(MIN_IRRIGATION_DURATION_MIN, Math.round(editPumpDuration || DEFAULT_IRRIGATION_DURATION_MIN)),
      );
      await setIrrigationDurationMin(validDuration);
      setPumpDuration(validDuration);

      const slotsSummary = [t1, t2, ...(t3 ? [t3] : [])].sort().join(', ');
      toast({
        title: 'Đã lưu lịch tưới',
        description: `Máy bơm sẽ bật tưới lúc ${slotsSummary} (${validDuration} phút/lần).`,
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
      if (lightScheduleStyle === 'slots') {
        const s1 = normalizeScheduleClock(lightSlot1, '05:30');
        const s2 = normalizeScheduleClock(lightSlot2, '18:00');
        const s3 = lightSlot3Enabled ? normalizeScheduleClock(lightSlot3, '21:00') : null;
        const validDur = Math.min(
          MAX_LIGHT_DURATION_MIN,
          Math.max(MIN_LIGHT_DURATION_MIN, Math.round(editLightDuration || DEFAULT_LIGHT_DURATION_MIN)),
        );
        await setStreamingLightSlots({ time1: s1, time2: s2, time3: s3 }, validDur);
        setLightDuration(validDur);

        const slotsSummary = [s1, s2, ...(s3 ? [s3] : [])].sort().join(', ');
        toast({
          title: 'Đã lưu lịch đèn theo cữ',
          description: `Đèn chiếu sáng sẽ bật lúc ${slotsSummary} (${validDur} phút/lần).`,
        });
      } else {
        const on1 = normalizeScheduleClock(lightOnTime, '06:00');
        const off1 = normalizeScheduleClock(lightOffTime, '18:00');
        const extra = lightWindow2Enabled
          ? {
              on2: normalizeScheduleClock(lightOnTime2, '18:30'),
              off2: normalizeScheduleClock(lightOffTime2, '21:00'),
            }
          : undefined;
        await setStreamingLightTime(on1, off1, extra);

        toast({
          title: 'Đã lưu lịch chiếu sáng',
          description: extra
            ? `Đèn chiếu sáng bật khung ${on1} → ${off1} và ${extra.on2} → ${extra.off2}.`
            : `Đèn chiếu sáng bật lúc ${on1}, tắt lúc ${off1}.`,
        });
      }
      setLightScheduleDialogOpen(false);
    } catch (error) {
      toastFirebaseWriteError(error, 'Không thể lưu lịch đèn');
    } finally {
      setIsLoading(null);
    }
  };

  const activePumpSlots = [pumpTime1, pumpTime2, ...(pumpTime3Enabled ? [pumpTime3] : [])].sort();
  const activeLightSlots = [lightSlot1, lightSlot2, ...(lightSlot3Enabled ? [lightSlot3] : [])].sort();

  return (
    <div className="space-y-6">
      {/* 2 Thẻ điều khiển thiết bị */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {/* THẺ 1: ĐÈN CHIẾU SÁNG */}
        <div
          className={cn(
            'rounded-2xl border p-5 sm:p-6 transition-all duration-300 space-y-4',
            isLightOn
              ? 'border-amber-500/40 bg-amber-500/5 shadow-xs'
              : 'border-border bg-card shadow-xs',
          )}
        >
          {/* Header đèn */}
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-border/60">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'h-11 w-11 rounded-xl flex items-center justify-center transition-all shrink-0',
                  isLightOn
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'bg-secondary text-muted-foreground',
                )}
              >
                <Sun className="h-6 w-6" />
              </div>
              <div className="space-y-0.5">
                <h3 className="font-display text-base sm:text-lg font-bold">
                  Đèn chiếu sáng
                </h3>
                <p
                  className={cn(
                    'text-xs font-semibold flex items-center gap-1.5',
                    isLightOn ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      isLightOn ? 'bg-amber-500 animate-pulse' : 'bg-muted-foreground/40',
                    )}
                  />
                  {isLightOn ? 'Đang bật' : 'Đã tắt'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={isLightOn}
                onCheckedChange={() => handleToggle('light')}
                disabled={isLoading === 'light' || lightMode !== 'manual'}
                title={
                  lightMode === 'manual'
                    ? 'Bật/tắt đèn thủ công'
                    : 'Chuyển sang chế độ thủ công để bật/tắt trực tiếp'
                }
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
                    Tự động (theo quang kỳ cây &amp; nhiệt độ)
                  </div>
                </SelectItem>
                <SelectItem value="schedule">
                  <div className="flex items-center gap-2 text-xs">
                    <Calendar className="h-3.5 w-3.5 text-amber-500" />
                    Lập lịch (theo khung giờ hoặc theo cữ)
                  </div>
                </SelectItem>
                <SelectItem value="manual">
                  <div className="flex items-center gap-2 text-xs">
                    <Power className="h-3.5 w-3.5 text-amber-500" />
                    Thủ công (bật/tắt trực tiếp)
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Chi tiết chế độ Lập lịch của Đèn */}
          {lightMode === 'schedule' && (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                  <Sun className="h-3.5 w-3.5 text-amber-600" />
                  {lightScheduleStyle === 'slots'
                    ? `Lịch bật đèn (${activeLightSlots.length} cữ/ngày)`
                    : 'Lịch chiếu sáng hàng ngày'}
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
                        Cài đặt lịch bật đèn
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      {/* Chuyển đổi giữa 2 kiểu lập lịch đèn */}
                      <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-secondary/60">
                        <button
                          type="button"
                          onClick={() => setLightScheduleStyle('window')}
                          className={cn(
                            'rounded-lg py-1.5 px-2 text-xs font-medium transition-all',
                            lightScheduleStyle === 'window'
                              ? 'bg-card text-foreground shadow-xs'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          Theo khoảng giờ bật – tắt
                        </button>
                        <button
                          type="button"
                          onClick={() => setLightScheduleStyle('slots')}
                          className={cn(
                            'rounded-lg py-1.5 px-2 text-xs font-medium transition-all',
                            lightScheduleStyle === 'slots'
                              ? 'bg-card text-foreground shadow-xs'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          Theo cữ &amp; thời lượng
                        </button>
                      </div>

                      {lightScheduleStyle === 'window' ? (
                        <div className="space-y-3">
                          <p className="text-xs text-muted-foreground">
                            Cài đặt giờ bật và giờ tắt đèn chính xác đến từng phút (hỗ trợ cả khung giờ qua nửa đêm).
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                              <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <Sun className="h-3 w-3 text-amber-500" />
                                Giờ bật (khung 1)
                              </label>
                              <Input
                                type="time"
                                value={lightOnTime}
                                onChange={(e) => setLightOnTime(e.target.value || '06:00')}
                                className="h-8 text-xs font-semibold"
                              />
                            </div>
                            <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                              <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <Power className="h-3 w-3 text-muted-foreground" />
                                Giờ tắt (khung 1)
                              </label>
                              <Input
                                type="time"
                                value={lightOffTime}
                                onChange={(e) => setLightOffTime(e.target.value || '18:00')}
                                className="h-8 text-xs font-semibold"
                              />
                            </div>
                          </div>

                          {!lightWindow2Enabled ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setLightWindow2Enabled(true)}
                              className="w-full h-8 text-xs gap-1.5 border-dashed"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Thêm khung giờ chiếu sáng thứ 2 trong ngày
                            </Button>
                          ) : (
                            <div className="p-3 bg-secondary/30 rounded-xl border border-border space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-medium text-foreground">
                                  Khung giờ chiếu sáng 2
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setLightWindow2Enabled(false)}
                                  className="text-muted-foreground hover:text-destructive"
                                  title="Xóa khung giờ 2"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <label className="text-[11px] text-muted-foreground">Giờ bật</label>
                                  <Input
                                    type="time"
                                    value={lightOnTime2}
                                    onChange={(e) => setLightOnTime2(e.target.value || '18:30')}
                                    className="h-8 text-xs font-semibold"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[11px] text-muted-foreground">Giờ tắt</label>
                                  <Input
                                    type="time"
                                    value={lightOffTime2}
                                    onChange={(e) => setLightOffTime2(e.target.value || '21:00')}
                                    className="h-8 text-xs font-semibold"
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-xs text-muted-foreground">
                            Cài đặt các mốc giờ bật đèn và thời lượng duy trì mỗi cữ (tương tự lịch tưới máy bơm).
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                              <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3 text-amber-500" />
                                Cữ 1 (sáng)
                              </label>
                              <Input
                                type="time"
                                value={lightSlot1}
                                onChange={(e) => setLightSlot1(e.target.value || '05:30')}
                                className="h-8 text-xs font-semibold"
                              />
                            </div>
                            <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                              <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3 text-amber-500" />
                                Cữ 2 (tối)
                              </label>
                              <Input
                                type="time"
                                value={lightSlot2}
                                onChange={(e) => setLightSlot2(e.target.value || '18:00')}
                                className="h-8 text-xs font-semibold"
                              />
                            </div>
                          </div>

                          {!lightSlot3Enabled ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setLightSlot3Enabled(true)}
                              className="w-full h-8 text-xs gap-1.5 border-dashed"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Thêm cữ bật đèn thứ 3
                            </Button>
                          ) : (
                            <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                              <div className="flex items-center justify-between">
                                <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                                  <Clock className="h-3 w-3 text-amber-500" />
                                  Cữ 3 (bổ sung)
                                </label>
                                <button
                                  type="button"
                                  onClick={() => setLightSlot3Enabled(false)}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <Input
                                type="time"
                                value={lightSlot3}
                                onChange={(e) => setLightSlot3(e.target.value || '21:00')}
                                className="h-8 text-xs font-semibold"
                              />
                            </div>
                          )}

                          <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                            <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Timer className="h-3 w-3 text-amber-500" />
                              Thời lượng bật mỗi cữ (phút)
                            </label>
                            <Input
                              type="number"
                              min={MIN_LIGHT_DURATION_MIN}
                              max={MAX_LIGHT_DURATION_MIN}
                              value={editLightDuration}
                              onChange={(e) => setEditLightDuration(parseInt(e.target.value, 10) || 1)}
                              className="h-8 text-xs font-semibold"
                            />
                          </div>
                        </div>
                      )}

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

              {lightScheduleStyle === 'slots' ? (
                <div className="flex flex-wrap items-center gap-2">
                  {activeLightSlots.map((slot, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 bg-amber-500/20 text-amber-800 dark:text-amber-300 px-2.5 py-0.5 rounded-full font-medium"
                    >
                      <Clock className="h-3 w-3" />
                      {slot}
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1 bg-amber-500/15 text-amber-800 dark:text-amber-300 px-2.5 py-0.5 rounded-full font-medium">
                    <Timer className="h-3 w-3" />
                    {lightDuration} phút / cữ
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 bg-background/80 px-3 py-1.5 rounded-lg border border-border">
                    <Sun className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    <span className="font-semibold text-amber-800 dark:text-amber-300">{lightOnTime}</span>
                    <span className="text-muted-foreground">→</span>
                    <Power className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium text-foreground">{lightOffTime}</span>
                  </div>
                  {lightWindow2Enabled && (
                    <div className="inline-flex items-center gap-2 bg-background/80 px-3 py-1.5 rounded-lg border border-border">
                      <Sun className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                      <span className="font-semibold text-amber-800 dark:text-amber-300">{lightOnTime2}</span>
                      <span className="text-muted-foreground">→</span>
                      <Power className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium text-foreground">{lightOffTime2}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Chi tiết chế độ Thủ công của Đèn */}
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

          {/* Thông báo chế độ Tự động của Đèn */}
          {lightMode === 'auto' && (
            <div className="p-3 rounded-xl bg-secondary/50 border border-border text-xs text-muted-foreground flex items-start gap-2">
              <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <span>
                Tự động bật bù quang kỳ khung{' '}
                <strong className="text-foreground">{getAutoPhotoperiodLabel(plantAgeDays)}</strong>
                {plantStageName ? ` (${plantStageName})` : ''}; tự ngắt bảo vệ nếu nhiệt độ không khí &gt; 35 °C và bật bù ấm khi &lt; 18 °C.
              </span>
            </div>
          )}

          {lightMode !== 'manual' && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1 pt-0.5">
              <Lock className="h-3 w-3" />
              Chuyển sang chế độ thủ công nếu muốn bật/tắt đèn tức thời.
            </p>
          )}
        </div>

        {/* THẺ 2: MÁY BƠM NƯỚC */}
        <div
          className={cn(
            'rounded-2xl border p-5 sm:p-6 transition-all duration-300 space-y-4',
            isPumpOn
              ? 'border-emerald-500/40 bg-emerald-500/5 shadow-xs'
              : 'border-border bg-card shadow-xs',
          )}
        >
          {/* Header máy bơm */}
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-border/60">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'h-11 w-11 rounded-xl flex items-center justify-center transition-all shrink-0',
                  isPumpOn
                    ? 'bg-emerald-500 text-white shadow-xs'
                    : 'bg-secondary text-muted-foreground',
                )}
              >
                <Droplets className="h-6 w-6" />
              </div>
              <div className="space-y-0.5">
                <h3 className="font-display text-base sm:text-lg font-bold">Máy bơm nước</h3>
                <p
                  className={cn(
                    'text-xs font-semibold flex items-center gap-1.5',
                    isPumpOn ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'h-2 w-2 rounded-full',
                      isPumpOn ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/40',
                    )}
                  />
                  {isPumpOn ? 'Đang bật' : 'Đã tắt'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={isPumpOn}
                onCheckedChange={() => handleToggle('pump')}
                disabled={isLoading === 'pump' || pumpMode !== 'manual'}
                title={
                  pumpMode === 'manual'
                    ? 'Bật/tắt máy bơm thủ công'
                    : 'Chuyển sang chế độ thủ công để bật/tắt trực tiếp'
                }
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
                    Tự động (theo ngưỡng độ ẩm đất)
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
                    Thủ công (bật/tắt trực tiếp)
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Chi tiết chế độ Lập lịch của Máy bơm */}
          {pumpMode === 'schedule' && (
            <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/20 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sky-700 dark:text-sky-400 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Lịch tưới hàng ngày ({activePumpSlots.length} cữ)
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
                        Cài đặt các mốc giờ tưới chính xác đến từng phút và thời lượng mỗi lần tưới cho cây trồng.
                      </p>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                          <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3 text-sky-500" />
                            Cữ 1 (sáng)
                          </label>
                          <Input
                            type="time"
                            value={pumpTime1}
                            onChange={(e) => setPumpTime1(e.target.value || '06:00')}
                            className="h-8 text-xs font-semibold"
                          />
                        </div>

                        <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                          <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3 text-sky-500" />
                            Cữ 2 (chiều)
                          </label>
                          <Input
                            type="time"
                            value={pumpTime2}
                            onChange={(e) => setPumpTime2(e.target.value || '17:00')}
                            className="h-8 text-xs font-semibold"
                          />
                        </div>
                      </div>

                      {!pumpTime3Enabled ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setPumpTime3Enabled(true)}
                          className="w-full h-8 text-xs gap-1.5 border-dashed"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Thêm cữ tưới thứ 3 trong ngày
                        </Button>
                      ) : (
                        <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3 text-sky-500" />
                              Cữ 3 (bổ sung)
                            </label>
                            <button
                              type="button"
                              onClick={() => setPumpTime3Enabled(false)}
                              className="text-muted-foreground hover:text-destructive"
                              title="Xóa cữ tưới 3"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <Input
                            type="time"
                            value={pumpTime3}
                            onChange={(e) => setPumpTime3(e.target.value || '11:30')}
                            className="h-8 text-xs font-semibold"
                          />
                        </div>
                      )}

                      <div className="p-3 bg-secondary/40 rounded-xl space-y-1.5">
                        <label className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Timer className="h-3 w-3 text-emerald-500" />
                          Thời lượng mỗi lần tưới (phút)
                        </label>
                        <Input
                          type="number"
                          min={MIN_IRRIGATION_DURATION_MIN}
                          max={MAX_IRRIGATION_DURATION_MIN}
                          value={editPumpDuration}
                          onChange={(e) => setEditPumpDuration(parseInt(e.target.value, 10) || 1)}
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
                {activePumpSlots.map((time, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 bg-sky-500/20 text-sky-800 dark:text-sky-300 px-2.5 py-0.5 rounded-full font-medium"
                  >
                    <Clock className="h-3 w-3" />
                    {time}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2.5 py-0.5 rounded-full font-medium">
                  <Timer className="h-3 w-3" />
                  {pumpDuration} phút / lần
                </span>
              </div>
            </div>
          )}

          {/* Chi tiết chế độ Thủ công của Máy bơm */}
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

          {/* Thông báo chế độ Tự động của Máy bơm */}
          {pumpMode === 'auto' && (
            <div className="p-3 rounded-xl bg-secondary/50 border border-border text-xs text-muted-foreground flex items-start gap-2">
              <Info className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
              <span>
                Tự động bật máy bơm khi độ ẩm đất &lt;{' '}
                <strong className="text-foreground">{moistureThreshold.low}%</strong> và tắt khi đạt &gt;{' '}
                <strong className="text-foreground">{moistureThreshold.high}%</strong> (cấu hình tại mục Cây trồng &amp; ngưỡng; khoá bảo vệ tối đa 30 phút).
              </span>
            </div>
          )}

          {pumpMode !== 'manual' && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1 pt-0.5">
              <Lock className="h-3 w-3" />
              Chuyển sang chế độ thủ công nếu muốn bật/tắt máy bơm tức thời.
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
          <span className="text-xs text-muted-foreground">Theo giờ Việt Nam (UTC+7)</span>
        </div>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          {/* Thống kê đèn chiếu sáng */}
          <div className="rounded-xl border border-border/80 bg-secondary/20 p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-center justify-center">
                <Sun className="h-4 w-4" />
              </div>
              <div>
                <h4 className="font-semibold text-xs text-foreground">Đèn chiếu sáng</h4>
                <p className="text-[11px] text-muted-foreground">Thời gian chiếu sáng hôm nay</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-background/80 p-2.5 rounded-lg border border-border">
                <p className="text-[11px] text-muted-foreground mb-0.5">Tổng hôm nay</p>
                <p className="font-display text-lg font-bold text-amber-700 dark:text-amber-400">
                  {formatDailyRuntimeVi(lightInfo.daily_time)}
                </p>
              </div>
              <div className="bg-background/80 p-2.5 rounded-lg border border-border">
                <p className="text-[11px] text-muted-foreground mb-0.5">Lần bật cuối</p>
                <p
                  className="font-medium text-xs truncate"
                  title={formatLastOnTimeVi(lightInfo.last_on_time)}
                >
                  {formatLastOnTimeVi(lightInfo.last_on_time)}
                </p>
              </div>
            </div>
          </div>

          {/* Thống kê máy bơm */}
          <div className="rounded-xl border border-border/80 bg-secondary/20 p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Droplets className="h-4 w-4" />
              </div>
              <div>
                <h4 className="font-semibold text-xs text-foreground">Máy bơm nước</h4>
                <p className="text-[11px] text-muted-foreground">Thời gian kích hoạt tưới hôm nay</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-background/80 p-2.5 rounded-lg border border-border">
                <p className="text-[11px] text-muted-foreground mb-0.5">Tổng hôm nay</p>
                <p className="font-display text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  {formatDailyRuntimeVi(pumpInfo.daily_time)}
                </p>
              </div>
              <div className="bg-background/80 p-2.5 rounded-lg border border-border">
                <p className="text-[11px] text-muted-foreground mb-0.5">Lần bật cuối</p>
                <p
                  className="font-medium text-xs truncate"
                  title={formatLastOnTimeVi(pumpInfo.last_on_time)}
                >
                  {formatLastOnTimeVi(pumpInfo.last_on_time)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
