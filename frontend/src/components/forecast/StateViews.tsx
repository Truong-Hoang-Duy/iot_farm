import { AlertTriangle, BrainCircuit, PlugZap, RefreshCw, SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { describeError } from '@/services/backendAPI';

interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  /** Hiện link tới trang /models khi lỗi "chưa train" */
  showTrainLink?: boolean;
}

/** Trạng thái lỗi thân thiện: backend tắt / chưa train / lỗi khác. Không bao giờ throw. */
export function ErrorState({ error, onRetry, className, showTrainLink = true }: ErrorStateProps) {
  const { title, description, kind } = describeError(error);
  const Icon = kind === 'network' ? PlugZap : kind === 'not_trained' ? BrainCircuit : kind === 'not_found' ? SearchX : AlertTriangle;
  const tone =
    kind === 'not_trained' ? 'text-primary bg-primary/10' : kind === 'network' ? 'text-warning bg-warning/10' : 'text-destructive bg-destructive/10';
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 text-center p-6', className)}>
      <div className={cn('h-12 w-12 rounded-full flex items-center justify-center', tone)}>
        <Icon className="h-6 w-6" />
      </div>
      <div className="space-y-1 max-w-md">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex gap-2">
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} className="gap-1.5 h-8">
            <RefreshCw className="h-3.5 w-3.5" /> Thử lại
          </Button>
        )}
        {showTrainLink && kind === 'not_trained' && (
          <Button size="sm" asChild className="h-8">
            <Link to="/models">Tới Phòng thí nghiệm</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ message, icon: Icon = SearchX, className }: { message: string; icon?: typeof SearchX; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm p-6 text-center', className)}>
      <Icon className="h-8 w-8 opacity-50" />
      <span>{message}</span>
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 p-2', className)}>
      <div className="flex gap-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-5 w-20" />
      </div>
      <Skeleton className="flex-1 min-h-[180px] w-full rounded-xl" />
    </div>
  );
}
