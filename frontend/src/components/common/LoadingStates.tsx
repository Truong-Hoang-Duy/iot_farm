import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sparkles, Loader2 } from 'lucide-react';

/** Khung xương tải bảng biểu tổng quát, chống tràn ngang và tương thích mobile */
export function TableSkeleton({
  columns = 6,
  rows = 5,
  className,
}: {
  columns?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-border overflow-hidden bg-card/50', className)}>
      <div className="overflow-x-auto">
        <Table className="min-w-[700px]">
          <TableHeader>
            <TableRow className="bg-secondary/40">
              {Array.from({ length: columns }).map((_, i) => (
                <TableHead key={i} className="py-3">
                  <Skeleton className="h-4 w-20" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }).map((_, r) => (
              <TableRow key={r} className="border-b border-border/50">
                {Array.from({ length: columns }).map((_, c) => (
                  <TableCell key={c} className="py-3.5">
                    <Skeleton
                      className={cn(
                        'h-4',
                        c === 0 ? 'w-24' : c === 1 ? 'w-16' : c % 2 === 0 ? 'w-20' : 'w-14',
                      )}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Khung xương cho thẻ chỉ số cảm biến */
export function MetricCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-xs space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-9 rounded-xl" />
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-3 w-36" />
      </div>
      <div className="pt-2">
        <Skeleton className="h-2 w-full rounded-full" />
      </div>
    </div>
  );
}

/** Khung xương hiệu ứng tải toàn trang Tổng quan (Dashboard) */
export function DashboardSkeleton() {
  return (
    <div className="space-y-8 animate-fade-in w-full max-w-7xl mx-auto">
      {/* Header Skeleton */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-5 w-48 rounded-full" />
          </div>
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-5 w-40" />
      </div>

      {/* Device Status Skeleton */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/60">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <Skeleton className="h-8 w-28 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>

      {/* 4 Main Soil Sensors */}
      <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>

      {/* 2 Environment Sensors */}
      <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2">
        <MetricCardSkeleton />
        <MetricCardSkeleton />
      </div>

      {/* NPK Nutrition Section Skeleton */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-4">
        <Skeleton className="h-6 w-72" />
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/70 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Chart Skeleton */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <Skeleton className="h-6 w-48" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-32 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** Khung xương hiệu ứng tải trang Thông tin cây trồng (PlantInfo) */
export function PlantInfoSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in w-full max-w-7xl mx-auto pb-8">
      {/* Header Skeleton */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      {/* Hero Banner Skeleton */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
        <div className="p-6 bg-primary/10 space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      </div>

      {/* Growth Stages Navigation Skeleton */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-4">
        <Skeleton className="h-6 w-60" />
        <div className="flex gap-2 overflow-x-auto pb-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-32 shrink-0 rounded-xl" />
          ))}
        </div>
      </div>

      {/* Target Metrics Grid Skeleton */}
      <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/** Khung xương hiệu ứng tải trang Cảnh báo & Khuyến nghị (Alerts) */
export function AlertsSkeleton() {
  return (
    <div className="space-y-8 animate-fade-in w-full max-w-7xl mx-auto">
      {/* Header Skeleton */}
      <div className="space-y-1.5">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* Forecast Section Skeleton */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <Skeleton className="h-6 w-72" />
          <Skeleton className="h-8 w-48 rounded-lg" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>

      {/* Alerts Tabs & Cards Skeleton */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border p-4 bg-card shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-5 rounded-full" />
                  <Skeleton className="h-5 w-40" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Khung xương hiệu ứng tải trang Điều khiển thiết bị (Controls) */
export function ControlsSkeleton() {
  return (
    <div className="space-y-8 animate-fade-in w-full max-w-7xl mx-auto pb-8">
      {/* Header Skeleton */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-40 rounded-lg" />
      </div>

      {/* 2 Device Control Cards */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        {/* Pump Card */}
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-7 w-14 rounded-full" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
          </div>
          <Skeleton className="h-28 rounded-xl" />
        </div>

        {/* Light Card */}
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-7 w-14 rounded-full" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
          </div>
          <Skeleton className="h-28 rounded-xl" />
        </div>
      </div>

      {/* Activity Log Table Skeleton */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs space-y-4">
        <Skeleton className="h-6 w-44" />
        <TableSkeleton columns={5} rows={4} />
      </div>
    </div>
  );
}

/** Banner trạng thái AI đang phân tích với hiệu ứng pulse cao cấp */
export function AiAnalysisBanner({
  message = 'Google Gemini đang phân tích dữ liệu cảm biến & đối soát ngưỡng chuẩn...',
}: {
  message?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5 shadow-xs animate-pulse">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Sparkles className="h-5 w-5 animate-spin text-primary" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold text-foreground flex items-center gap-2">
          <span>Trợ lý AI đang xử lý</span>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        </p>
        <p className="text-xs text-muted-foreground break-words">{message}</p>
      </div>
    </div>
  );
}
