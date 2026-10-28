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
  AlertOctagon
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
  deleteAlert
} from '@/services/firebaseAPI';
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

// Storage key for caching local user actions
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

// Level mapping: 0 = info, 1 = warning, 2 = urgent
const levelConfig: Record<AlertLevel, { 
  icon: typeof Info; 
  label: string; 
  borderClass: string; 
  bgClass: string; 
  iconBgClass: string;
  textClass: string;
}> = {
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
  const [overrides, setOverrides] = useState<Record<string, AlertOverride>>(loadOverrides);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'active' | 'unconfirmed' | 'confirmed' | 'dismissed'>('active');
  
  // Dialog state
  const [dismissTarget, setDismissTarget] = useState<FirebaseAlertData | null>(null);
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [dismissAllOpen, setDismissAllOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FirebaseAlertData | null>(null);

  const { toast } = useToast();

  useEffect(() => {
    const unsubscribe = subscribeAlerts((data) => {
      setRawAlerts(data);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Merge raw Firebase alerts with local state overrides
  const alerts: FirebaseAlertData[] = useMemo(() => {
    return rawAlerts.map(a => {
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

  // Update override and persist
  const updateLocalOverride = (id: string, partial: AlertOverride) => {
    setOverrides(prev => {
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

  // Categorized alerts
  const activeAlerts = useMemo(() => alerts.filter(a => a.active && !a.dismissed), [alerts]);
  const unconfirmedAlerts = useMemo(() => activeAlerts.filter(a => !a.acknowledged), [activeAlerts]);
  const confirmedAlerts = useMemo(() => activeAlerts.filter(a => a.acknowledged), [activeAlerts]);
  const dismissedAlerts = useMemo(() => alerts.filter(a => !a.active || a.dismissed), [alerts]);

  // Actions: Xác nhận (Confirm / Acknowledge)
  const handleConfirm = async (alert: FirebaseAlertData) => {
    const now = new Date();
    const timeStr = `${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} ${now.toLocaleDateString('vi-VN')}`;
    
    updateLocalOverride(alert.id, {
      acknowledged: true,
      acknowledgedAt: timeStr,
    });
    
    await acknowledgeAlert(alert.id);
    
    toast({
      title: 'Đã xác nhận cảnh báo',
      description: `Đã ghi nhận xử lý cảnh báo: ${alert.id}`,
    });
  };

  // Actions: Bỏ xác nhận (Un-acknowledge)
  const handleUnconfirm = async (alert: FirebaseAlertData) => {
    updateLocalOverride(alert.id, {
      acknowledged: false,
      acknowledgedAt: '',
    });
    
    await unacknowledgeAlert(alert.id);
    
    toast({
      title: 'Đã bỏ xác nhận',
      description: `Đã chuyển cảnh báo ${alert.id} về trạng thái chờ xử lý.`,
    });
  };

  // Actions: Hủy bỏ cảnh báo (Dismiss / Cancel)
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

  // Actions: Kích hoạt lại cảnh báo đã hủy (Reactivate)
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

  // Actions: Xóa vĩnh viễn
  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    
    await deleteAlert(deleteTarget.id);
    
    setOverrides(prev => {
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

  // Batch action: Xác nhận tất cả
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
      title: 'Xác nhận thành công',
      description: `Đã xác nhận toàn bộ ${unconfirmedAlerts.length} cảnh báo đang chờ xử lý.`,
    });
  };

  // Batch action: Hủy bỏ tất cả
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

  // Filter list by selected tab
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
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Cảnh báo hệ thống</h1>
          <p className="text-muted-foreground mt-1">
            Theo dõi bất thường môi trường, cho phép xác nhận và hủy bỏ cảnh báo
          </p>
        </div>

        {/* Quick Batch Action Buttons */}
        {activeAlerts.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {unconfirmedAlerts.length > 0 && (
              <Button 
                variant="outline" 
                size="sm"
                className="border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700"
                onClick={() => setConfirmAllOpen(true)}
              >
                <CheckCheck className="h-4 w-4 mr-1.5" />
                Xác nhận tất cả ({unconfirmedAlerts.length})
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
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {/* Active Alerts */}
        <div 
          onClick={() => setActiveTab('active')}
          className={cn(
            "rounded-xl border p-4 cursor-pointer transition-all hover:shadow-sm",
            activeTab === 'active' ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card"
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Đang hoạt động</p>
            <AlertTriangle className="h-4 w-4 text-warning" />
          </div>
          <p className="font-display text-2xl font-bold mt-2 text-foreground">
            {activeAlerts.length}
          </p>
        </div>

        {/* Unconfirmed / Pending */}
        <div 
          onClick={() => setActiveTab('unconfirmed')}
          className={cn(
            "rounded-xl border p-4 cursor-pointer transition-all hover:shadow-sm",
            activeTab === 'unconfirmed' ? "border-amber-500 bg-amber-500/5 shadow-sm" : "border-border bg-card"
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Chờ xử lý</p>
            <Clock className="h-4 w-4 text-amber-500" />
          </div>
          <p className="font-display text-2xl font-bold mt-2 text-amber-600">
            {unconfirmedAlerts.length}
          </p>
        </div>

        {/* Confirmed */}
        <div 
          onClick={() => setActiveTab('confirmed')}
          className={cn(
            "rounded-xl border p-4 cursor-pointer transition-all hover:shadow-sm",
            activeTab === 'confirmed' ? "border-emerald-500 bg-emerald-500/5 shadow-sm" : "border-border bg-card"
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Đã xác nhận</p>
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="font-display text-2xl font-bold mt-2 text-emerald-600">
            {confirmedAlerts.length}
          </p>
        </div>

        {/* Dismissed */}
        <div 
          onClick={() => setActiveTab('dismissed')}
          className={cn(
            "rounded-xl border p-4 cursor-pointer transition-all hover:shadow-sm",
            activeTab === 'dismissed' ? "border-muted-foreground bg-muted/30 shadow-sm" : "border-border bg-card"
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Đã hủy bỏ</p>
            <BellOff className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="font-display text-2xl font-bold mt-2 text-muted-foreground">
            {dismissedAlerts.length}
          </p>
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
            <span>Đã xác nhận</span>
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
                  ? 'Chưa có cảnh báo nào được xác nhận'
                  : 'Không có cảnh báo nào'}
              </h3>
              <p className="mt-2 text-muted-foreground text-sm max-w-md mx-auto">
                {activeTab === 'dismissed'
                  ? 'Các cảnh báo bị hủy bỏ sẽ được lưu trữ tại đây.'
                  : activeTab === 'confirmed'
                  ? 'Bấm "Xác nhận" trên các cảnh báo đang hoạt động để đánh dấu đã xử lý.'
                  : 'Hệ thống cảm biến và các chỉ số sinh học đất đang trong giới hạn an toàn.'}
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
                    "rounded-xl border p-5 transition-all hover:shadow-md bg-card",
                    isDismissed
                      ? "opacity-75 border-dashed border-border"
                      : isAcknowledged
                      ? "border-emerald-500/40 bg-emerald-500/[0.02]"
                      : cn(config.borderClass, config.bgClass)
                  )}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-4 justify-between">
                    <div className="flex items-start gap-4 flex-1">
                      {/* Alert Icon */}
                      <div className={cn(
                        "rounded-xl p-3 shrink-0", 
                        isDismissed ? "bg-muted text-muted-foreground" : config.iconBgClass
                      )}>
                        <Icon className="h-5 w-5" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-2">
                        {/* Title and Badges */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold text-base text-foreground">
                            Cảm biến {alert.id}
                          </h4>
                          
                          {/* Severity badge */}
                          <span className={cn("text-xs px-2.5 py-0.5 rounded-full font-medium", config.iconBgClass)}>
                            {config.label}
                          </span>

                          {/* Status Badge */}
                          {isDismissed ? (
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-medium flex items-center gap-1">
                              <X className="h-3 w-3" /> Đã hủy bỏ {alert.dismissedAt ? `(${alert.dismissedAt})` : ''}
                            </span>
                          ) : isAcknowledged ? (
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 font-medium flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Đã xác nhận {alert.acknowledgedAt ? `(${alert.acknowledgedAt})` : ''}
                            </span>
                          ) : (
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30 font-medium flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                              Chờ xử lý
                            </span>
                          )}
                        </div>

                        {/* Alert Message */}
                        <p className="text-sm font-medium text-foreground">
                          {alert.message}
                        </p>

                        {/* Action / Recommended Guide */}
                        {alert.action && (
                          <div className="rounded-lg bg-background/80 border border-border/80 p-3 text-sm">
                            <p className="font-medium text-foreground flex items-center gap-1.5">
                              <Sparkles className="h-4 w-4 text-primary shrink-0" />
                              Khuyến nghị xử lý nông học:
                            </p>
                            <p className="mt-1 text-muted-foreground text-sm pl-5">
                              {alert.action}
                            </p>
                          </div>
                        )}

                        {/* Detected Time */}
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          Thời điểm phát hiện: {alert.time} ({formatTime(alert.time)})
                        </p>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex sm:flex-col items-center sm:items-end gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
                      {!isDismissed ? (
                        <>
                          {/* Button Xác nhận / Bỏ xác nhận */}
                          {!isAcknowledged ? (
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm flex items-center gap-1.5 w-full sm:w-auto"
                              onClick={() => handleConfirm(alert)}
                            >
                              <Check className="h-4 w-4" />
                              Xác nhận
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 flex items-center gap-1.5 w-full sm:w-auto text-xs"
                              onClick={() => handleUnconfirm(alert)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Bỏ xác nhận
                            </Button>
                          )}

                          {/* Button Hủy bỏ */}
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
                          {/* Khôi phục lại cảnh báo đã hủy */}
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-border text-foreground hover:bg-accent flex items-center gap-1.5 w-full sm:w-auto"
                            onClick={() => handleReactivate(alert)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Kích hoạt lại
                          </Button>

                          {/* Xóa vĩnh viễn */}
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
                Cảnh báo này sẽ được chuyển sang mục "Đã hủy bỏ" và không còn xuất hiện trong danh sách thông báo hoạt động. Bạn vẫn có thể kích hoạt lại nếu muốn.
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

      {/* Modal Dialog: Xác nhận tất cả cảnh báo */}
      <AlertDialog open={confirmAllOpen} onOpenChange={setConfirmAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-emerald-600">
              <CheckCheck className="h-5 w-5" />
              Xác nhận toàn bộ cảnh báo?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Đánh dấu xác nhận xử lý cho tất cả <strong>{unconfirmedAlerts.length}</strong> cảnh báo đang chờ xử lý.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmAll}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Xác nhận tất cả
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