import { cn } from '@/lib/utils';
import { useDeviceStatus } from '@/hooks/useDeviceStatus';
import { formatRelativeVi } from '@/lib/timeKeys';

interface DeviceOnlineIndicatorProps {
  className?: string;
  /** Hiển thị thêm dòng "lần cuối liên lạc" */
  showLastSeen?: boolean;
}

/** Chấm trạng thái Online/Offline của Jetson (dùng ở Sidebar / header). */
export function DeviceOnlineIndicator({ className, showLastSeen = true }: DeviceOnlineIndicatorProps) {
  const { online, exists, loaded, sinceLastSeenMs } = useDeviceStatus();

  const label = !loaded ? 'Đang kiểm tra…' : online ? 'Trực tuyến' : exists ? 'Ngoại tuyến' : 'Chưa kết nối';
  const dot = online ? 'bg-success animate-pulse' : exists ? 'bg-destructive' : 'bg-muted-foreground';
  const text = online ? 'text-success' : exists ? 'text-destructive' : 'text-muted-foreground';

  return (
    <div className={cn('text-xs text-muted-foreground', className)}>
      <p className="flex items-center gap-2">
        <span className={cn('h-2 w-2 rounded-full shrink-0', dot)} />
        Jetson: <span className={cn('font-medium', text)}>{label}</span>
      </p>
      {showLastSeen && sinceLastSeenMs !== null && (
        <p className="mt-1 pl-4">Liên lạc: {formatRelativeVi(sinceLastSeenMs)}</p>
      )}
    </div>
  );
}

export default DeviceOnlineIndicator;
