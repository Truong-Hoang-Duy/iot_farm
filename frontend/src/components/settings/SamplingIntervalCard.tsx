import { useEffect, useMemo, useState } from 'react';
import { Timer, Save, AlertCircle, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useDeviceStatus } from '@/hooks/useDeviceStatus';
import { toastFirebaseWriteError } from '@/lib/firebaseErrors';
import { formatIntervalVi } from '@/lib/timeKeys';
import {
  DEFAULT_SAMPLING_INTERVAL_SEC,
  MAX_SAMPLING_INTERVAL_SEC,
  MIN_SAMPLING_INTERVAL_SEC,
  setSamplingIntervalSec,
  subscribeStreamingConfigField,
} from '@/services/firebaseAPI';

type Unit = 'sec' | 'min' | 'hour';

const UNIT_FACTOR: Record<Unit, number> = { sec: 1, min: 60, hour: 3600 };
const UNIT_LABEL: Record<Unit, string> = { sec: 'giây', min: 'phút', hour: 'giờ' };

const PRESETS: Array<{ label: string; sec: number }> = [
  { label: '5 giây', sec: 5 },
  { label: '10 giây', sec: 10 },
  { label: '30 giây', sec: 30 },
  { label: '1 phút', sec: 60 },
  { label: '5 phút', sec: 300 },
  { label: '10 phút', sec: 600 },
  { label: '15 phút', sec: 900 },
  { label: '30 phút', sec: 1800 },
  { label: '1 giờ', sec: 3600 },
  { label: '6 giờ', sec: 21600 },
  { label: '12 giờ', sec: 43200 },
  { label: '24 giờ', sec: 86400 },
];

const bestUnit = (sec: number): Unit => (sec % 3600 === 0 ? 'hour' : sec % 60 === 0 ? 'min' : 'sec');

/** Kiểm tra giá trị nhập → số giây hợp lệ hoặc thông báo lỗi. */
function validateInterval(raw: string, unit: Unit): { seconds: number | null; error: string | null } {
  const text = raw.trim().replace(',', '.');
  if (!text) return { seconds: null, error: 'Vui lòng nhập chu kỳ lấy mẫu.' };
  const value = Number(text);
  if (!Number.isFinite(value)) return { seconds: null, error: 'Giá trị không hợp lệ – chỉ nhập số.' };
  if (value <= 0) return { seconds: null, error: 'Chu kỳ phải lớn hơn 0.' };
  const secondsRaw = value * UNIT_FACTOR[unit];
  const seconds = Math.round(secondsRaw);
  if (Math.abs(secondsRaw - seconds) > 1e-6) {
    return {
      seconds: null,
      error: `Chu kỳ quy đổi phải là số nguyên giây (hiện là ${secondsRaw.toFixed(2)} giây).`,
    };
  }
  if (seconds < MIN_SAMPLING_INTERVAL_SEC) {
    return { seconds: null, error: `Chu kỳ tối thiểu là ${MIN_SAMPLING_INTERVAL_SEC} giây.` };
  }
  if (seconds > MAX_SAMPLING_INTERVAL_SEC) {
    return { seconds: null, error: `Chu kỳ tối đa là 24 giờ (${MAX_SAMPLING_INTERVAL_SEC.toLocaleString('vi-VN')} giây).` };
  }
  return { seconds, error: null };
}

export function SamplingIntervalCard() {
  const { toast } = useToast();
  const device = useDeviceStatus();

  // Giá trị hiện tại trên Firebase
  const [currentSec, setCurrentSec] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Bản nháp
  const [rawValue, setRawValue] = useState('');
  const [unit, setUnit] = useState<Unit>('min');
  const [dirty, setDirty] = useState(false);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsubInterval = subscribeStreamingConfigField('sampling_interval_sec', (v) => {
      setCurrentSec(v);
      setLoaded(true);
    });
    return () => {
      unsubInterval();
    };
  }, []);

  const effectiveSec = currentSec ?? DEFAULT_SAMPLING_INTERVAL_SEC;

  // Đồng bộ bản nháp với Firebase khi người dùng chưa sửa
  useEffect(() => {
    if (dirty) return;
    const u = bestUnit(effectiveSec);
    setUnit(u);
    setRawValue(String(effectiveSec / UNIT_FACTOR[u]));
  }, [effectiveSec, dirty]);

  const { seconds, error } = useMemo(() => validateInterval(rawValue, unit), [rawValue, unit]);

  const unchanged = seconds !== null && seconds === currentSec;
  const showError = (touched || dirty) && error;

  const applyPreset = (sec: number) => {
    const u = bestUnit(sec);
    setUnit(u);
    setRawValue(String(sec / UNIT_FACTOR[u]));
    setDirty(true);
    setTouched(true);
  };

  const handleSave = async () => {
    setTouched(true);
    if (seconds === null) return;
    setSaving(true);
    try {
      await setSamplingIntervalSec(seconds);
      setDirty(false);
      toast({
        title: 'Đã lưu chu kỳ lấy mẫu',
        description: `Jetson sẽ lấy mẫu mỗi ${formatIntervalVi(seconds)} (áp dụng trong khoảng 15 giây).`,
      });
    } catch (err) {
      toastFirebaseWriteError(err, 'Không thể lưu chu kỳ lấy mẫu');
    } finally {
      setSaving(false);
    }
  };

  const appliedSec = device.status?.interval_sec;
  const recordsPerDay = seconds ? Math.floor(86400 / seconds) : null;

  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <h3 className="font-display text-xl font-semibold flex items-center gap-2">
            <Timer className="h-5 w-5 text-primary" />
            Chu kỳ lấy mẫu cảm biến
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Khoảng thời gian giữa 2 lần Jetson đọc cảm biến (CWT 7in1 + DHT20) và lưu bản ghi.
          </p>
        </div>
        <div className="text-sm sm:text-right shrink-0">
          <p>
            Hiện tại:{' '}
            <span className="font-semibold text-primary">
              {loaded ? formatIntervalVi(effectiveSec) : '…'}
            </span>
            {loaded && currentSec === null && <span className="text-xs text-muted-foreground"> (mặc định)</span>}
          </p>
          {typeof appliedSec === 'number' && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 sm:justify-end">
              <Cpu className="h-3 w-3" />
              Jetson đang áp dụng: {formatIntervalVi(appliedSec)}
              {appliedSec !== effectiveSec && ' (đang chờ cập nhật)'}
            </p>
          )}
        </div>
      </div>

      {/* Presets */}
      <div className="space-y-2 mb-6">
        <Label>Chọn nhanh</Label>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.sec}
              type="button"
              onClick={() => applyPreset(p.sec)}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                seconds === p.sec
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-secondary/40 hover:bg-secondary hover:border-primary/40',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Manual input */}
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="samplingInterval">Hoặc nhập thủ công</Label>
          <div className="flex gap-2">
            <Input
              id="samplingInterval"
              inputMode="decimal"
              value={rawValue}
              onChange={(e) => {
                setRawValue(e.target.value);
                setDirty(true);
              }}
              onBlur={() => setTouched(true)}
              className={cn('flex-1', showError && 'border-destructive focus-visible:ring-destructive')}
              aria-invalid={!!showError}
              aria-describedby="samplingIntervalHelp"
            />
            <Select
              value={unit}
              onValueChange={(v) => {
                setUnit(v as Unit);
                setDirty(true);
              }}
            >
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(UNIT_LABEL) as Unit[]).map((u) => (
                  <SelectItem key={u} value={u}>
                    {UNIT_LABEL[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving || seconds === null || unchanged} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? 'Đang lưu...' : 'Lưu chu kỳ'}
        </Button>
      </div>

      <div id="samplingIntervalHelp" className="mt-2 min-h-[1.25rem] text-xs">
        {showError ? (
          <p className="text-destructive flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" /> {error}
          </p>
        ) : seconds !== null ? (
          <p className="text-muted-foreground">
            = {seconds.toLocaleString('vi-VN')} giây · khoảng {recordsPerDay?.toLocaleString('vi-VN')} bản ghi/ngày
            {seconds < 30 && ' · Chu kỳ ngắn tạo nhiều dữ liệu và tốn băng thông Firebase'}
          </p>
        ) : (
          <p className="text-muted-foreground">
            Cho phép từ {MIN_SAMPLING_INTERVAL_SEC} giây đến 24 giờ.
          </p>
        )}
      </div>
    </div>
  );
}

export default SamplingIntervalCard;
