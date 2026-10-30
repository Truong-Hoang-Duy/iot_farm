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
  Sprout,
  X,
  AlertOctagon,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn, formatDateVN, formatDateTimeVN } from '@/lib/utils';
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
import { UserForecastSection } from '@/components/forecast/UserForecastSection';

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
          description: 'Hệ thống chưa ghi nhận số liệu đo mới của ngày hôm nay.',
        });
      } else {
        toast({
          title: 'Đã cập nhật phân tích',
          description: `Phát hiện ${bundle.alerts.length} cảnh báo từ mẫu đo ${bundle.sensor_timestamp}.`,
        });
      }
    } catch (e: any) {
      toast({
        title: 'Lỗi phân tích cảnh báo',
        description: e?.message || 'Không thể kết nối máy chủ phân tích.',
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
    const timeStr = formatDateTimeVN(new Date());
    updateLocalOverride(alert.id, {
      acknowledged: true,
      acknowledgedAt: timeStr,
    });
    await acknowledgeAlert(alert.id);
    toast({
      title: 'Đã xử lý cảnh báo',
      description: `Đã đánh dấu xử lý: ${alert.id}`,
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
      description: `Cảnh báo ${alert.id} đã chuyển về trạng thái chờ xử lý.`,
    });
  };

  const handleDismissConfirm = async () => {
    if (!dismissTarget) return;
    const timeStr = formatDateTimeVN(new Date());
    updateLocalOverride(dismissTarget.id, {
      active: false,
      dismissed: true,
      dismissedAt: timeStr,
    });
    await dismissAlert(dismissTarget.id);
    toast({
      title: 'Đã hủy bỏ cảnh báo',
      description: `Cảnh báo ${dismissTarget.id} đã chuyển vào mục đã hủy bỏ.`,
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
      description: `Cảnh báo ${alert.id} đã quay lại danh sách hoạt động.`,
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
    const timeStr = formatDateTimeVN(new Date());
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
      description: `Đã đánh dấu xử lý cho ${unconfirmedAlerts.length} cảnh báo.`,
    });
  };

  const handleDismissAll = async () => {
    const timeStr = formatDateTimeVN(new Date());
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
      return formatDateVN(date);
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

  const filterItems = [
    {
      key: 'active' as const,
      label: 'Đang hoạt động',
      count: activeAlerts.length,
      icon: AlertTriangle,
      activeClass: 'border-primary bg-primary/[0.06] text-primary',
      iconClass: 'text-warning',
    },
    {
      key: 'unconfirmed' as const,
      label: 'Chờ xử lý',
      count: unconfirmedAlerts.length,
      icon: Clock,
      activeClass: 'border-amber-500 bg-amber-500/[0.06] text-amber-600',
      iconClass: 'text-amber-500',
    },
    {
      key: 'confirmed' as const,
      label: 'Đã xử lý',
      count: confirmedAlerts.length,
      icon: ShieldCheck,
      activeClass: 'border-emerald-500 bg-emerald-500/[0.06] text-emerald-600',
      iconClass: 'text-emerald-500',
    },
    {
      key: 'dismissed' as const,
      label: 'Đã hủy bỏ',
      count: dismissedAlerts.length,
      icon: BellOff,
      activeClass: 'border-muted-foreground bg-muted/40 text-foreground',
      iconClass: 'text-muted-foreground',
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Tiêu đề trang tối giản */}
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold">Khuyến nghị & cảnh báo</h1>
        <p className="text-muted-foreground mt-0.5 text-xs sm:text-sm">
          Dự báo xu hướng chỉ số môi trường vùng rễ ớt và cảnh báo vận hành tự động
        </p>
      </div>

      {/* Phần 1: Dự báo xu hướng ngắn hạn & dài hạn */}
      <UserForecastSection />

      {/* Phần 2: Cảnh báo hệ thống */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        {/* Thanh tiêu đề Cảnh báo hệ thống + Thông tin mẫu đo + Nút phân tích */}
        <div className="p-4 sm:p-5 border-b border-border/60 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10 text-warning">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <h2 className="font-display text-base sm:text-lg font-semibold">Cảnh báo hệ thống</h2>
              {aiBundle && (
                <span className="rounded-lg bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground">
                  Mẫu đo: <b className="text-foreground">{formatDateTimeVN(aiBundle.sensor_timestamp)}</b>
                  {aiBundle.plant_context?.growth_stage ? ` • ${aiBundle.plant_context.growth_stage}` : ''}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {aiBundle && aiBundle.status !== 'no_data_today' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPromptDetail((prev) => !prev)}
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
              >
                {showPromptDetail ? (
                  <>
                    Ẩn đối chiếu chuẩn <ChevronUp className="h-3.5 w-3.5 ml-1" />
                  </>
                ) : (
                  <>
                    Đối chiếu ngưỡng chuẩn ({aiBundle.anomalies_detected?.length ?? 0}) <ChevronDown className="h-3.5 w-3.5 ml-1" />
                  </>
                )}
              </Button>
            )}

            {unconfirmedAlerts.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                onClick={() => setConfirmAllOpen(true)}
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
                Xử lý tất cả ({unconfirmedAlerts.length})
              </Button>
            )}

            {activeAlerts.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={() => setDismissAllOpen(true)}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Hủy tất cả
              </Button>
            )}

            <Button
              size="sm"
              disabled={isAnalyzing}
              onClick={handleAnalyzeWithGemini}
              className="h-8 text-xs gap-1.5"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isAnalyzing && 'animate-spin')} />
              {isAnalyzing ? 'Đang kiểm tra...' : 'Phân tích mẫu đo'}
            </Button>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Bảng đối chiếu chỉ số vượt ngưỡng (chỉ mở khi người dùng bấm xem) */}
          {showPromptDetail && aiBundle && (
            <div className="rounded-xl bg-secondary/35 border border-border p-3.5 text-xs space-y-2.5">
              {aiBundle.anomalies_detected && aiBundle.anomalies_detected.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {aiBundle.anomalies_detected.map((item) => (
                    <div
                      key={item.key}
                      className="rounded-lg bg-card border border-border px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-semibold text-foreground block">{item.label}</span>
                        <span className="text-[11px] text-muted-foreground">
                          Chuẩn: {item.min}–{item.max} {item.unit}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-amber-600 dark:text-amber-400 block">
                          {item.value} {item.unit}
                        </span>
                        <span className="text-[11px] text-muted-foreground">Lệch {item.delta}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-emerald-600 dark:text-emerald-400 font-medium">
                  Toàn bộ 9 chỉ số cảm biến trong mẫu đo đều nằm trong ngưỡng chuẩn an toàn.
                </p>
              )}
            </div>
          )}

          {/* Thanh 4 thẻ lọc trạng thái kiêm bộ chuyển tab (loại bỏ thanh tab trùng lặp) */}
          <div className="grid gap-2.5 grid-cols-2 lg:grid-cols-4">
            {filterItems.map((item) => {
              const Icon = item.icon;
              const isSelected = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  className={cn(
                    'rounded-xl border px-3.5 py-2.5 text-left transition-all flex items-center justify-between gap-2',
                    isSelected
                      ? cn(item.activeClass, 'shadow-2xs ring-1 ring-current/20')
                      : 'border-border bg-secondary/20 hover:bg-secondary/50 text-foreground',
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className={cn('h-4 w-4 shrink-0', item.iconClass)} />
                    <span className="text-xs sm:text-sm font-medium truncate">{item.label}</span>
                  </div>
                  <span className="font-display text-lg font-bold shrink-0">{item.count}</span>
                </button>
              );
            })}
          </div>

          {/* Danh sách cảnh báo */}
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary"></div>
            </div>
          ) : displayedAlerts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-secondary/15 py-10 px-4 text-center">
              <BellOff className="h-9 w-9 mx-auto text-muted-foreground/50" />
              <h3 className="mt-2.5 font-display text-base font-semibold">
                {activeTab === 'dismissed'
                  ? 'Không có cảnh báo đã hủy bỏ'
                  : activeTab === 'confirmed'
                  ? 'Chưa có cảnh báo đã xử lý'
                  : aiBundle?.status === 'no_data_today'
                  ? 'Chưa có dữ liệu đo hôm nay'
                  : 'Hệ thống đang hoạt động an toàn'}
              </h3>
              <p className="mt-1 text-muted-foreground text-xs max-w-md mx-auto">
                {activeTab === 'dismissed'
                  ? 'Các cảnh báo được hủy bỏ sẽ lưu trữ tại đây.'
                  : activeTab === 'confirmed'
                  ? 'Các cảnh báo sau khi khắc phục sẽ hiển thị tại mục này.'
                  : aiBundle?.status === 'no_data_today'
                  ? 'Bấm "Phân tích mẫu đo" sau khi thiết bị gửi dữ liệu mới.'
                  : 'Các chỉ số đất và môi trường hiện nằm trong ngưỡng ổn định.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {displayedAlerts.map((alert) => {
                const config = levelConfig[alert.level] || levelConfig[0];
                const Icon = config.icon;
                const isAcknowledged = !!alert.acknowledged;
                const isDismissed = !alert.active || !!alert.dismissed;

                return (
                  <div
                    key={alert.id}
                    className={cn(
                      'rounded-xl border p-4 transition-all bg-card',
                      isDismissed
                        ? 'opacity-70 border-dashed border-border'
                        : isAcknowledged
                        ? 'border-emerald-500/35 bg-emerald-500/[0.02]'
                        : cn(config.borderClass, config.bgClass)
                    )}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3.5 justify-between">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div
                          className={cn(
                            'rounded-xl p-2.5 shrink-0 mt-0.5',
                            isDismissed ? 'bg-muted text-muted-foreground' : config.iconBgClass
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>

                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-semibold text-sm text-foreground">{alert.id}</h4>
                            <span className={cn('text-[11px] px-2 py-0.5 rounded-md font-medium', config.iconBgClass)}>
                              {config.label}
                            </span>

                            {isDismissed ? (
                              <span className="text-[11px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">
                                Đã hủy bỏ
                              </span>
                            ) : isAcknowledged ? (
                              <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 font-medium flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Đã xử lý
                              </span>
                            ) : (
                              <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 font-medium flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                                Chờ xử lý
                              </span>
                            )}

                            <span className="text-[11px] text-muted-foreground ml-auto">
                              {formatTime(alert.time)}
                            </span>
                          </div>

                          <p className="text-xs sm:text-sm text-foreground leading-relaxed">{alert.message}</p>

                          {alert.action && (
                            <div className="rounded-lg bg-background/80 border border-border/70 px-3 py-2 text-xs flex items-start gap-2">
                              <Sprout className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                              <div className="space-y-0.5">
                                <span className="font-semibold text-foreground">Hướng dẫn xử lý: </span>
                                <span className="text-muted-foreground">{alert.action}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex sm:flex-col items-center sm:items-end gap-1.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/60">
                        {!isDismissed ? (
                          <>
                            {!isAcknowledged ? (
                              <Button
                                size="sm"
                                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1 w-full sm:w-auto"
                                onClick={() => handleConfirm(alert)}
                              >
                                <Check className="h-3.5 w-3.5" />
                                Đã xử lý
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 gap-1 w-full sm:w-auto"
                                onClick={() => handleUnconfirm(alert)}
                              >
                                <RotateCcw className="h-3 w-3" />
                                Hoàn tác
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1 w-full sm:w-auto"
                              onClick={() => setDismissTarget(alert)}
                            >
                              <X className="h-3.5 w-3.5" />
                              Bỏ qua
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs gap-1 w-full sm:w-auto"
                              onClick={() => handleReactivate(alert)}
                            >
                              <RotateCcw className="h-3 w-3" />
                              Khôi phục
                            </Button>

                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs text-destructive hover:bg-destructive/10 gap-1 w-full sm:w-auto"
                              onClick={() => setDeleteTarget(alert)}
                            >
                              <Trash2 className="h-3 w-3" />
                              Xóa
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal Dialog: Hủy bỏ 1 cảnh báo */}
      <AlertDialog open={!!dismissTarget} onOpenChange={(open) => !open && setDismissTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertOctagon className="h-5 w-5" />
              Xác nhận bỏ qua cảnh báo
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Bạn có chắc chắn muốn bỏ qua cảnh báo <strong>{dismissTarget?.id}</strong>?
              </p>
              {dismissTarget && (
                <div className="rounded-lg bg-muted p-2.5 text-xs text-foreground">
                  {dismissTarget.message}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Quay lại</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDismissConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Đồng ý
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
              Hành động này sẽ chuyển toàn bộ <strong>{activeAlerts.length}</strong> cảnh báo đang hoạt động vào mục đã hủy bỏ.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Không</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDismissAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Hủy tất cả
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
              Đánh dấu đã xử lý tất cả?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Đánh dấu đã xử lý cho toàn bộ <strong>{unconfirmedAlerts.length}</strong> cảnh báo đang chờ xử lý.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmAll}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Đồng ý
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
              Cảnh báo <strong>{deleteTarget?.id}</strong> sẽ bị xóa hoàn toàn và không thể khôi phục.
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
