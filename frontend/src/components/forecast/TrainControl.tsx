import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, PlayCircle, Rocket, XCircle, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { backendAPI, describeError, queryKeys, toMs, type TrainStatus } from '@/services/backendAPI';
import { fmtDateTime } from './chartUtils';

export function TrainControl({ className }: { className?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [kickUntil, setKickUntil] = useState(0);
  const prevRunning = useRef<boolean | undefined>(undefined);

  const statusQ = useQuery({
    queryKey: queryKeys.trainStatus,
    queryFn: ({ signal }) => backendAPI.getTrainStatus(signal),
    retry: false,
    refetchInterval: (query) => {
      const d = query.state.data as TrainStatus | undefined;
      if (d?.running || Date.now() < kickUntil) return 2000;
      return query.state.status === 'error' ? 30_000 : 15_000;
    },
  });

  const status = statusQ.data;
  const running = !!status?.running;

  // Khi huấn luyện kết thúc → làm mới mọi query dự báo / chỉ số
  useEffect(() => {
    if (prevRunning.current === true && status && !status.running) {
      qc.invalidateQueries({ queryKey: ['forecast'] });
      toast({
        title: status.state === 'error' ? 'Huấn luyện thất bại' : 'Huấn luyện hoàn tất',
        description: status.state === 'error' ? status.error ?? status.message : 'Đã cập nhật mô hình và bảng chỉ số.',
        variant: status.state === 'error' ? 'destructive' : 'default',
      });
    }
    prevRunning.current = status?.running;
  }, [status, qc, toast]);

  const train = useMutation({
    mutationFn: (quick: boolean) => backendAPI.startTraining(quick),
    onSuccess: (s, quick) => {
      setKickUntil(Date.now() + 15_000);
      if (s.state !== 'unknown') qc.setQueryData(queryKeys.trainStatus, s);
      qc.invalidateQueries({ queryKey: queryKeys.trainStatus });
      toast({
        title: quick ? 'Bắt đầu huấn luyện nhanh' : 'Bắt đầu huấn luyện đầy đủ',
        description: 'Quá trình chạy nền trên backend – có thể theo dõi tiến độ tại đây.',
      });
    },
    onError: (e) => {
      const d = describeError(e);
      toast({ title: d.title, description: d.description, variant: 'destructive' });
    },
  });

  const backendDown = statusQ.isError;
  const busy = running || train.isPending;

  return (
    <div className={cn('rounded-2xl border border-border bg-card p-4 sm:p-5 space-y-3', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            Huấn luyện mô hình
          </h2>
          <p className="text-xs text-muted-foreground">
            Nhanh: ít epoch / ít điểm phát dự báo để kiểm tra luồng. Đầy đủ: chạy toàn bộ trên GPU (có thể mất nhiều phút).
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || backendDown} onClick={() => train.mutate(true)}>
            <Zap className="h-4 w-4" /> Nhanh
          </Button>
          <Button size="sm" className="gap-1.5" disabled={busy || backendDown} onClick={() => train.mutate(false)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Đầy đủ
          </Button>
        </div>
      </div>

      {backendDown ? (
        <p className="text-xs text-warning">Không kết nối được backend – không thể huấn luyện lúc này.</p>
      ) : status ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {running ? (
              <span className="inline-flex items-center gap-1 font-medium text-primary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang huấn luyện{status.quick !== undefined ? (status.quick ? ' (nhanh)' : ' (đầy đủ)') : ''}
              </span>
            ) : status.state === 'done' ? (
              <span className="inline-flex items-center gap-1 font-medium text-success">
                <CheckCircle2 className="h-3.5 w-3.5" /> Đã hoàn tất
              </span>
            ) : status.state === 'error' ? (
              <span className="inline-flex items-center gap-1 font-medium text-destructive">
                <XCircle className="h-3.5 w-3.5" /> Lỗi
              </span>
            ) : (
              <span className="text-muted-foreground">Đang rảnh</span>
            )}
            {status.stage && <span className="text-muted-foreground">· {status.stage}</span>}
            {status.progress !== undefined && <span className="font-semibold tabular-nums">{Math.round(status.progress)}%</span>}
            {status.started_at && <span className="text-muted-foreground">· bắt đầu {fmtDateTime(toMs(status.started_at))}</span>}
            {status.finished_at && !running && <span className="text-muted-foreground">· xong {fmtDateTime(toMs(status.finished_at))}</span>}
          </div>
          {(running || status.progress !== undefined) && <Progress value={status.progress ?? (running ? 5 : 0)} className="h-2" />}
          {status.message && <p className="text-xs text-muted-foreground">{status.message}</p>}
          {status.error && <p className="text-xs text-destructive break-words">{status.error}</p>}
          {status.log.length > 0 && (
            <pre className="max-h-32 overflow-auto rounded-lg bg-secondary/50 p-2 text-[10px] leading-relaxed font-mono whitespace-pre-wrap">
              {status.log.slice(-10).join('\n')}
            </pre>
          )}
        </div>
      ) : statusQ.isLoading ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Đang kiểm tra trạng thái…
        </p>
      ) : null}
    </div>
  );
}
