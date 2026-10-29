import { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  Info,
  XCircle,
  BellOff,
  Check,
  CheckCheck,
  CheckCircle2,
  RotateCcw,
  Trash2,
  Clock,
  ShieldCheck,
  Sparkles,
  X,
  AlertOctagon,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  subscribeAlerts,
  FirebaseAlertData,
  AlertLevel,
  acknowledgeAlert,
  unacknowledgeAlert,
  dismissAlert,
  reactivateAlert,
  deleteAlert,
} from '@/services/firebaseAPI';
import {
  fetchLatestAIAlerts,
  triggerAnalyzeAIAlerts,
  AIAlertsBundleResponse,
} from '@/services/aiAPI';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

const OVERRIDES_STORAGE_KEY = 'iot_farm_alerts_overrides';

interface AlertOverride {
  acknowledged?: boolean;
  acknowledgedAt?: string;
  active?: boolean;
  dismissed?: boolean;
  dismissedAt?: string;
}

const loadOverrides = (): Record<string, AlertOverride> => {
  try {
    const raw = localStorage.getItem(OVERRIDES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const saveOverrides = (overrides: Record<string, AlertOverride>) => {
  try {
    localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
  } catch (e) {
    console.error('Failed to save alert overrides', e);
  }
};

const levelConfig: Record<
  AlertLevel,
  {
    icon: typeof Info;
    label: string;
    borderClass: string;
    bgClass: string;
    iconBgClass: string;
    textClass: string;
  }
> = {
  0: {
    icon: Info,
    label: 'Thông tin',
    borderClass: 'border-accent/30',
    bgClass: 'bg-accent/5',
    iconBgClass: 'bg-accent/10 text-accent',
    textClass: 'text-accent',
  },
  1: {
    icon: AlertTriangle,
    label: 'Cảnh báo',
    borderClass: 'border-warning/30',
    bgClass: 'bg-warning/5',
    iconBgClass: 'bg-warning/10 text-warning',
    textClass: 'text-warning',
  },
  2: {
    icon: XCircle,
    label: 'Khẩn cấp',
    borderClass: 'border-destructive/30',
    bgClass: 'bg-destructive/5',
    iconBgClass: 'bg-destructive/10 text-destructive',
    textClass: 'text-destructive',
  },
};

export default function AlertsPage() {
  const [rawAlerts, setRawAlerts] = useState<FirebaseAlertData[]>([]);
  const [aiBundle, setAiBundle] = useState<AIAlertsBundleResponse | null>(null);
  const [overrides, setOverrides] = useState<Record<string, AlertOverride>>(loadOverrides);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showPromptDetail, setShowPromptDetail] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'unconfirmed' | 'confirmed' | 'dismissed'>('active');

  const [dismissTarget, setDismissTarget] = useState<FirebaseAlertData | null>(null);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [dismissAllOpen, setDismissAllOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FirebaseAlertData | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    let isMounted = true;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    fetchLatestAIAlerts(false)
      .then((bundle) => {
        if (bundle && isMounted) {
          setAiBundle(bundle);
          setRawAlerts(
            (bundle.alerts || []).map((a) => ({
              id: a.id,
              level: a.level as AlertLevel,
              message: a.message,
              action: a.action,
              time: a.time,
              active: a.active,
            }))
          );
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setIsLoading(false);
      });

    const unsubscribe = subscribeAlerts((data) => {
      if (!isMounted) return;
      // Chỉ giữ các cảnh báo thuộc ngày hiện tại (không hiển thị cảnh báo tồn đọng của ngày cũ)
      const todayAlerts = (data || []).filter((a) => a.time && a.time.startsWith(todayStr));
      setRawAlerts(todayAlerts);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const applyBundleToState = (bundle: AIAlertsBundleResponse) => {
    setAiBundle(bundle);
    setOverrides({});
    saveOverrides({});
    setRawAlerts(
      (bundle.alerts || []).map((a) => ({
        id: a.id,
        level: a.level as AlertLevel,
        message: a.message,
        action: a.action,
        time: a.time,
        active: a.active,
      }))
    );
  };

  const handleAnalyzeWithGemini = async () => {
    setIsAnalyzing(true);
    try {
      const bundle = await triggerAnalyzeAIAlerts();
      applyBundleToState(bundle);
      if (bundle.status === 'no_data_today') {
        toast({
          title: 'Chưa có dữ liệu đo hôm nay',
          description: 'Hệ thống chưa ghi nhận số liệu đo mới của ngày hôm nay trên Firebase.',
        });
      } else {
        toast({
          title: 'Đã phân tích cảnh báo',
          description: `Phát hiện ${bundle.alerts.length} cảnh báo từ mẫu đo ${bundle.sensor_timestamp}.`,
        });
      }
    } catch (e: any) {
      toast({
        title: 'Lỗi phân tích cảnh báo',
        description: e?.message || 'Không thể kết nối Backend AI.',
        variant: 'destructive',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const alerts: FirebaseAlertData[] = useMemo(() => {
    return rawAlerts.map((a) => {
      const ovr = overrides[a.id];
      if (!ovr) return a;
      return {
        ...a,
        acknowledged: ovr.acknowledged !== undefined ? ovr.acknowledged : a.acknowledged,
        acknowledgedAt: ovr.acknowledgedAt !== undefined ? ovr.acknowledgedAt : a.acknowledgedAt,
        active: ovr.active !== undefined ? ovr.active : a.active,
        dismissed: ovr.dismissed !== undefined ? ovr.dismissed : a.dismissed,
        dismissedAt: ovr.dismissedAt !== undefined ? ovr.dismissedAt : a.dismissedAt,
      };
    });
  }, [rawAlerts, overrides]);

  const updateLocalOverride = (id: string, partial: AlertOverride) => {
    setOverrides((prev) => {
      const next = {
        ...prev,
        [id]: {
          ...prev[id],
          ...partial,
        },
      };
      saveOverrides(next);
      return next;
    });
  };

  const activeAlerts = useMemo(() => alerts.filter((a) => a.active && !a.dismissed), [alerts]);
  const unconfirmedAlerts = useMemo(() => activeAlerts.filter((a) => !a.acknowledged), [activeAlerts]);
  const confirmedAlerts = useMemo(() => activeAlerts.filter((a) => a.acknowledged), [activeAlerts]);
  const dismissedAlerts = useMemo(() => alerts.filter((a) => !a.active || a.dismissed), [alerts]);

  const handleConfirm = async (alert: FirebaseAlertData) => {
    const now = new Date();
    const timeStr = `${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${now.toLocaleDateString('vi-VN')}`;

    updateLocalOverride(alert.id, {
      acknowledged: true,
      acknowledgedAt: timeStr,
    });

    await acknowledgeAlert(alert.id);

    toast({
      title: 'Đã xử lý cảnh báo',
      description: `Đã đánh dấu xử lý cảnh báo: ${alert.id}`,
    });
  };

  const handleUnconfirm = async (alert: FirebaseAlertData) => {
    updateLocalOverride(alert.id, {
      acknowledged: false,
      acknowledgedAt: '',
    });

    await unacknowledgeAlert(alert.id);

    toast({
      title: 'Đã chuyển về chờ xử lý',
      description: `Đã chuyển cảnh báo ${alert.id} về trạng thái chờ xử lý.`,
    });
  };

  const handleDismissConfirm = async () => {
    if (!dismissTarget) return;

    const now = new Date();
    const timeStr = `${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${now.toLocaleDateString('vi-VN')}`;

    updateLocalOverride(dismissTarget.id, {
      active: false,
      dismissed: true,
      dismissedAt: timeStr,
    });

    await dismissAlert(dismissTarget.id);

    toast({
      title: 'Đã hủy bỏ cảnh báo',
      description: `Cảnh báo ${dismissTarget.id} đã được chuyển vào mục Đã hủy bỏ.`,
    });

    setDismissTarget(null);
  };

  const handleReactivate = async (alert: FirebaseAlertData) => {
    updateLocalOverride(alert.id, {
      active: true,
      dismissed: false,
    });

    await reactivateAlert(alert.id);

    toast({
      title: 'Đã kích hoạt lại',
      description: `Cảnh báo ${alert.id} đã quay trở lại danh sách hoạt động.`,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    await deleteAlert(deleteTarget.id);

    setOverrides((prev) => {
      const next = { ...prev };
      delete next[deleteTarget.id];
      saveOverrides(next);
      return next;
    });

    toast({
      title: 'Đã xóa cảnh báo',
      description: `Cảnh báo ${deleteTarget.id} đã được xóa vĩnh viễn.`,
    });

    setDeleteTarget(null);
  };

  const handleConfirmAll = async () => {
    const now = new Date();
    const timeStr = `${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${now.toLocaleDateString('vi-VN')}`;

    const newOverrides = { ...overrides };
    for (const a of unconfirmedAlerts) {
      newOverrides[a.id] = {
        ...newOverrides[a.id],
        acknowledged: true,
        acknowledgedAt: timeStr,
      };
      acknowledgeAlert(a.id);
    }

    setOverrides(newOverrides);
    saveOverrides(newOverrides);
    setConfirmAllOpen(false);

    toast({
      title: 'Đã xử lý tất cả',
      description: `Đã đánh dấu đã xử lý cho toàn bộ ${unconfirmedAlerts.length} cảnh báo.`,
    });
  };

  const handleDismissAll = async () => {
    const now = new Date();
    const timeStr = `${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${now.toLocaleDateString('vi-VN')}`;

    const newOverrides = { ...overrides };
    for (const a of activeAlerts) {
      newOverrides[a.id] = {
        ...newOverrides[a.id],
        active: false,
        dismissed: true,
        dismissedAt: timeStr,
      };
      dismissAlert(a.id);
    }

    setOverrides(newOverrides);
    saveOverrides(newOverrides);
    setDismissAllOpen(false);

    toast({
      title: 'Đã hủy bỏ tất cả',
      description: `Đã hủy bỏ toàn bộ ${activeAlerts.length} cảnh báo đang hoạt động.`,
    });
  };

  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp.replace(' ', 'T'));
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (minutes < 1) return 'Vừa xong';
      if (minutes < 60) return `${minutes} phút trước`;
      if (hours < 24) return `${hours} giờ trước`;
      if (days < 7) return `${days} ngày trước`;
      return date.toLocaleDateString('vi-VN');
    } catch {
      return timestamp;
    }
  };

  const displayedAlerts = useMemo(() => {
    let list: FirebaseAlertData[] = [];
    if (activeTab === 'active') list = activeAlerts;
    else if (activeTab === 'unconfirmed') list = unconfirmedAlerts;
    else if (activeTab === 'confirmed') list = confirmedAlerts;
    else if (activeTab === 'dismissed') list = dismissedAlerts;

    return [...list].sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      try {
        return new Date(b.time.replace(' ', 'T')).getTime() - new Date(a.time.replace(' ', 'T')).getTime();
      } catch {
        return 0;
      }
    });
  }, [activeTab, activeAlerts, unconfirmedAlerts, confirmedAlerts, dismissedAlerts]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-3xl font-bold">Cảnh báo hệ thống</h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            Phân tích tự động dữ liệu đo của ngày hôm nay ({aiBundle?.sensor_timestamp || new Date().toISOString().slice(0, 10)})
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            disabled={isAnalyzing}
            onClick={handleAnalyzeWithGemini}
            className="gap-1.5"
          >
            <RefreshCw className={cn('h-4 w-4', isAnalyzing && 'animate-spin')} />
            {isAnalyzing ? 'Đang phân tích...' : 'Phân tích'}
          </Button>
        </div>
      </div>

      {/* Khung thông tin mẫu đo ngày hiện tại & Chi tiết so sánh chỉ số */}
      {aiBundle && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
              <span className="font-semibold text-foreground">
                Mẫu đo ngày hôm nay: <span className="text-primary">{aiBundle.sensor_timestamp}</span>
              </span>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">
                Giai đoạn {aiBundle.plant_context.stage_number}: {aiBundle.plant_context.growth_stage}
              </span>
              {aiBundle.status !== 'no_data_today' && (
                <>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-xs font-medium text-foreground">
                    Ẩm {aiBundle.sensor_reading.moisture}% | pH {aiBundle.sensor_reading.pH} | EC {aiBundle.sensor_reading.EC} | Nhiệt đất {aiBundle.sensor_reading.soiltemp}°C | N:{aiBundle.sensor_reading.N} P:{aiBundle.sensor_reading.P} K:{aiBundle.sensor_reading.K}
                  </span>
                </>
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPromptDetail((prev) => !prev)}
              className="text-xs text-primary h-7 px-2 self-start sm:self-auto"
            >
              {showPromptDetail ? (
                <>
                  Thu gọn chi tiết <ChevronUp className="h-3.5 w-3.5 ml-1" />
                </>
              ) : (
                <>
                  Chi tiết so sánh chỉ số <ChevronDown className="h-3.5 w-3.5 ml-1" />
                </>
              )}
            </Button>
          </div>

          {showPromptDetail && (
            <div className="rounded-lg bg-secondary/40 border border-border p-3.5 text-xs space-y-2.5 text-foreground/90">
              {aiBundle.status === 'no_data_today' ? (
                <p className="text-muted-foreground leading-relaxed">
                  Hệ thống chưa ghi nhận số liệu đo nào trong ngày hôm nay trên Firebase. Sau khi thiết bị đo và gửi dữ liệu mới lên hệ thống, bạn hãy bấm nút <strong>Phân tích</strong> để AI kiểm tra với mức chuẩn và đưa ra cảnh báo.
                </p>
              ) : aiBundle.anomalies_detected && aiBundle.anomalies_detected.length > 0 ? (
                <div className="space-y-2">
                  <p className="font-semibold text-foreground">
                    Các chỉ số vượt mức chuẩn phát hiện từ mẫu đo ({aiBundle.anomalies_detected.length} chỉ số):
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {aiBundle.anomalies_detected.map((item) => (
                      <div
                        key={item.key}
                        className="rounded-lg bg-card border border-border px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <div>
                          <span className="font-semibold text-foreground block">{item.label}</span>
                          <span className="text-[11px] text-muted-foreground">
                            Chuẩn: {item.min} – {item.max}
                            {item.unit}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="font-bold text-amber-600 dark:text-amber-400 block">
                            {item.value}
                            {item.unit}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            Lệch {item.delta}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-emerald-600 dark:text-emerald-400 font-medium">
                  Toàn bộ 9 chỉ số cảm biến trong mẫu đo ngày hôm nay đều nằm trong mức chuẩn an toàn.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Quick Batch Action Buttons */}
      {activeAlerts.length > 0 && (
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {unconfirmedAlerts.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700"
              onClick={() => setConfirmAllOpen(true)}
            >
              <CheckCheck className="h-4 w-4 mr-1.5" />
              Đã xử lý tất cả ({unconfirmedAlerts.length})
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/30 text-destructive hover:bg-destructive/10"
            onClick={() => setDismissAllOpen(true)}
          >
            <X className="h-4 w-4 mr-1.5" />
            Hủy bỏ tất cả ({activeAlerts.length})
          </Button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <div
          onClick={() => setActiveTab('active')}
          className={cn(
            'rounded-xl border p-4 cursor-pointer transition-all hover:shadow-sm',
            activeTab === 'active' ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-card'
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Đang hoạt động</p>
            <AlertTriangle className="h-4 w-4 text-warning" />
          </div>
          <p className="font-display text-2xl font-bold mt-2 text-foreground">{activeAlerts.length}</p>
        </div>

        <div
          onClick={() => setActiveTab('unconfirmed')}
          className={cn(
            'rounded-xl border p-4 cursor-pointer transition-all hover:shadow-sm',
            activeTab === 'unconfirmed' ? 'border-amber-500 bg-amber-500/5 shadow-sm' : 'border-border bg-card'
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Chờ xử lý</p>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <p className="font-display text-2xl font-bold mt-2 text-amber-600">{unconfirmedAlerts.length}</p>
        </div>

        <div
          onClick={() => setActiveTab('confirmed')}
          className={cn(
            'rounded-xl border p-4 cursor-pointer transition-all hover:shadow-sm',
            activeTab === 'confirmed' ? 'border-emerald-500 bg-emerald-500/5 shadow-sm' : 'border-border bg-card'
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Đã xử lý</p>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="font-display text-2xl font-bold mt-2 text-emerald-600">{confirmedAlerts.length}</p>
        </div>

        <div
          onClick={() => setActiveTab('dismissed')}
          className={cn(
            'rounded-xl border p-4 cursor-pointer transition-all hover:shadow-sm',
            activeTab === 'dismissed' ? 'border-muted-foreground bg-muted/30 shadow-sm' : 'border-border bg-card'
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Đã hủy bỏ</p>
            <BellOff className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="font-display text-2xl font-bold mt-2 text-muted-foreground">{dismissedAlerts.length}</p>
        </div>
      </div>

      {/* Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as any)} className="w-full space-y-4">
        <TabsList className="grid grid-cols-4 w-full sm:w-auto sm:inline-flex">
          <TabsTrigger value="active" className="gap-1.5">
            <span>Hoạt động</span>
            <span className="text-xs px-1.5 py-0.2 rounded-full bg-primary/10 text-primary font-semibold">
              {activeAlerts.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="unconfirmed" className="gap-1.5">
            <span>Chờ xử lý</span>
            {unconfirmedAlerts.length > 0 && (
              <span className="text-xs px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-600 font-semibold">
                {unconfirmedAlerts.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="confirmed" className="gap-1.5">
            <span>Đã xử lý</span>
            <span className="text-xs px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-600 font-semibold">
              {confirmedAlerts.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="dismissed" className="gap-1.5">
            <span>Đã hủy bỏ</span>
            <span className="text-xs px-1.5 py-0.2 rounded-full bg-muted text-muted-foreground font-semibold">
              {dismissedAlerts.length}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4 space-y-4">
          {displayedAlerts.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-12 text-center">
              <BellOff className="h-12 w-12 mx-auto text-muted-foreground/60" />
              <h3 className="mt-4 font-display text-xl font-semibold">
                {activeTab === 'dismissed'
                  ? 'Không có cảnh báo nào đã hủy bỏ'
                  : activeTab === 'confirmed'
                  ? 'Chưa có cảnh báo nào đã xử lý'
                  : aiBundle?.status === 'no_data_today'
                  ? 'Chưa có dữ liệu đo của ngày hôm nay trên Firebase'
                  : 'Không có cảnh báo nào'}
              </h3>
              <p className="mt-2 text-muted-foreground text-sm max-w-md mx-auto">
                {activeTab === 'dismissed'
                  ? 'Các cảnh báo bị hủy bỏ sẽ được lưu trữ tại đây.'
                  : activeTab === 'confirmed'
                  ? 'Bấm "Đã xử lý" trên các cảnh báo đang hoạt động sau khi bạn đã khắc phục.'
                  : aiBundle?.status === 'no_data_today'
                  ? 'Sau khi thiết bị đo và đẩy dữ liệu ngày hôm nay lên Firebase (/data), hãy bấm nút "Phân tích" để AI kiểm tra.'
                  : 'Hệ thống cảm biến và các chỉ số đất đang trong giới hạn an toàn.'}
              </p>
            </div>
          ) : (
            displayedAlerts.map((alert) => {
              const config = levelConfig[alert.level] || levelConfig[0];
              const Icon = config.icon;
              const isAcknowledged = !!alert.acknowledged;
              const isDismissed = !alert.active || !!alert.dismissed;

              return (
                <div
                  key={alert.id}
                  className={cn(
                    'rounded-xl border p-5 transition-all hover:shadow-md bg-card',
                    isDismissed
                      ? 'opacity-75 border-dashed border-border'
                      : isAcknowledged
                      ? 'border-emerald-500/40 bg-emerald-500/[0.02]'
                      : cn(config.borderClass, config.bgClass)
                  )}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-4 justify-between">
                    <div className="flex items-start gap-4 flex-1">
                      <div
                        className={cn(
                          'rounded-xl p-3 shrink-0',
                          isDismissed ? 'bg-muted text-muted-foreground' : config.iconBgClass
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </div>

                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold text-base text-foreground">{alert.id}</h4>

                          <span className={cn('text-xs px-2.5 py-0.5 rounded-full font-medium', config.iconBgClass)}>
                            {config.label}
                          </span>

                          {isDismissed ? (
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-medium flex items-center gap-1">
                              <X className="h-3 w-3" /> Đã hủy bỏ {alert.dismissedAt ? `(${alert.dismissedAt})` : ''}
                            </span>
                          ) : isAcknowledged ? (
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 font-medium flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Đã xử lý {alert.acknowledgedAt ? `(${alert.acknowledgedAt})` : ''}
                            </span>
                          ) : (
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30 font-medium flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                              Chờ xử lý
                            </span>
                          )}
                        </div>

                        <p className="text-sm font-medium text-foreground">{alert.message}</p>

                        {alert.action && (
                          <div className="rounded-lg bg-background/80 border border-border/80 p-3 text-sm">
                            <p className="font-medium text-foreground flex items-center gap-1.5">
                              <Sparkles className="h-4 w-4 text-primary shrink-0" />
                              Khuyến nghị xử lý từ AI:
                            </p>
                            <p className="mt-1 text-muted-foreground text-sm pl-5">{alert.action}</p>
                          </div>
                        )}

                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          Thời điểm mẫu đo: {alert.time} ({formatTime(alert.time)})
                        </p>
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
                      {!isDismissed ? (
                        <>
                          {!isAcknowledged ? (
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm flex items-center gap-1.5 w-full sm:w-auto"
                              onClick={() => handleConfirm(alert)}
                            >
                              <Check className="h-4 w-4" />
                              Đã xử lý
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 flex items-center gap-1.5 w-full sm:w-auto text-xs"
                              onClick={() => handleUnconfirm(alert)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Chưa xử lý
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive flex items-center gap-1.5 w-full sm:w-auto"
                            onClick={() => setDismissTarget(alert)}
                          >
                            <X className="h-4 w-4" />
                            Hủy bỏ
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-border text-foreground hover:bg-accent flex items-center gap-1.5 w-full sm:w-auto"
                            onClick={() => handleReactivate(alert)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Kích hoạt lại
                          </Button>

                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10 flex items-center gap-1.5 w-full sm:w-auto text-xs"
                            onClick={() => setDeleteTarget(alert)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Xóa
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </TabsContent>
      </Tabs>

      {/* Modal Dialog: Hủy bỏ 1 cảnh báo */}
      <AlertDialog open={!!dismissTarget} onOpenChange={(open) => !open && setDismissTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertOctagon className="h-5 w-5" />
              Xác nhận hủy bỏ cảnh báo
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Bạn có chắc chắn muốn hủy bỏ cảnh báo <strong>{dismissTarget?.id}</strong>?
              </p>
              {dismissTarget && (
                <div className="rounded-lg bg-muted p-2.5 text-xs text-foreground font-mono">
                  {dismissTarget.message}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Cảnh báo này sẽ được chuyển sang mục "Đã hủy bỏ" và không còn xuất hiện trong danh sách thông báo hoạt động.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Quay lại</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDismissConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Đồng ý hủy bỏ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal Dialog: Hủy bỏ tất cả cảnh báo */}
      <AlertDialog open={dismissAllOpen} onOpenChange={setDismissAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertOctagon className="h-5 w-5" />
              Hủy bỏ tất cả cảnh báo?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Hành động này sẽ hủy bỏ toàn bộ <strong>{activeAlerts.length}</strong> cảnh báo đang hoạt động và chuyển chúng vào mục lưu trữ.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Không, giữ lại</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDismissAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Hủy bỏ tất cả
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal Dialog: Đánh dấu đã xử lý tất cả cảnh báo */}
      <AlertDialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-600">
              <CheckCheck className="h-5 w-5" />
              Đánh dấu đã xử lý toàn bộ cảnh báo?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Đánh dấu đã xử lý cho tất cả <strong>{unconfirmedAlerts.length}</strong> cảnh báo đang chờ xử lý.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmAll}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Đã xử lý tất cả
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal Dialog: Xóa vĩnh viễn 1 cảnh báo */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Xóa vĩnh viễn cảnh báo?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cảnh báo <strong>{deleteTarget?.id}</strong> sẽ bị xóa hoàn toàn khỏi cơ sở dữ liệu và không thể khôi phục lại.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteTarget ? handleDeleteConfirm : undefined}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Xóa vĩnh viễn
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
