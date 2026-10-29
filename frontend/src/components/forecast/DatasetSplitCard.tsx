import { CalendarRange, Database } from 'lucide-react';
import { GROUP_LABELS, toMs, type DatasetInfo } from '@/services/backendAPI';
import { fmtDate, fmtNum } from './chartUtils';

const SEG = [
  { key: 'train', label: 'Train', pct: 70, cls: 'bg-primary', text: 'text-primary' },
  { key: 'val', label: 'Validation', pct: 10, cls: 'bg-warning', text: 'text-warning' },
  { key: 'test', label: 'Test', pct: 20, cls: 'bg-destructive/80', text: 'text-destructive' },
] as const;

function Timeline({ info }: { info?: DatasetInfo }) {
  const s = toMs(info?.start);
  const trainEnd = toMs(info?.split?.train_end);
  const valEnd = toMs(info?.split?.val_end);
  const testStart = toMs(info?.split?.test_start) ?? valEnd;
  const e = toMs(info?.split?.test_end) ?? toMs(info?.end);

  let widths: number[] = SEG.map((x) => x.pct);
  const real = s !== undefined && e !== undefined && trainEnd !== undefined && valEnd !== undefined && e > s;
  if (real) {
    const total = e! - s!;
    widths = [((trainEnd! - s!) / total) * 100, ((valEnd! - trainEnd!) / total) * 100, ((e! - valEnd!) / total) * 100].map((w) =>
      Math.max(2, w),
    );
  }
  const ranges = [
    [s, trainEnd],
    [trainEnd, valEnd],
    [testStart, e],
  ];

  return (
    <div className="space-y-2">
      <div className="flex h-7 w-full overflow-hidden rounded-lg border border-border">
        {SEG.map((seg, i) => (
          <div
            key={seg.key}
            className={`${seg.cls} flex items-center justify-center text-[11px] font-semibold text-white`}
            style={{ width: `${widths[i]}%` }}
            title={`${seg.label}: ${fmtDate(ranges[i][0])} → ${fmtDate(ranges[i][1])}`}
          >
            {widths[i] > 8 ? `${seg.label} ${real ? `${fmtNum(widths[i], 0)}%` : `${seg.pct}%`}` : ''}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{fmtDate(s)}</span>
        <span>{fmtDate(e)}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {SEG.map((seg, i) => (
          <div key={seg.key} className="rounded-lg bg-secondary/40 px-3 py-2 text-xs">
            <div className={`font-semibold ${seg.text}`}>
              {seg.label} ({seg.pct}%)
            </div>
            <div className="text-muted-foreground">
              {ranges[i][0] !== undefined || ranges[i][1] !== undefined
                ? `${fmtDate(ranges[i][0])} → ${fmtDate(ranges[i][1])}`
                : 'Chưa có thông tin'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DatasetSplitCard({ datasets, device }: { datasets: Record<string, DatasetInfo>; device?: string }) {
  const entries = Object.entries(datasets);
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-display text-lg sm:text-xl font-semibold flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          Tập dữ liệu &amp; cách chia
        </h2>
        {device && <span className="text-xs text-muted-foreground">Thiết bị huấn luyện: {device}</span>}
      </div>
      {entries.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <CalendarRange className="h-4 w-4" />
            Chưa có thông tin tập dữ liệu từ backend – hiển thị tỷ lệ chia theo thiết kế (chia theo thời gian, không xáo trộn).
          </p>
          <Timeline />
        </div>
      ) : (
        entries.map(([k, info]) => (
          <div key={k} className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium">{k === 'default' ? 'Toàn bộ chuỗi' : GROUP_LABELS[k as 'short' | 'long'] ?? k}</span>
              {info.n_points !== undefined && (
                <span className="text-muted-foreground">
                  <b className="text-foreground">{fmtNum(info.n_points, 0)}</b> điểm
                </span>
              )}
              {info.resolution_minutes && (
                <span className="text-muted-foreground">
                  lưới {info.resolution_minutes >= 60 ? `${info.resolution_minutes / 60} giờ` : `${info.resolution_minutes} phút`}
                </span>
              )}
              {info.start && info.end && (
                <span className="text-muted-foreground">
                  {fmtDate(toMs(info.start))} → {fmtDate(toMs(info.end))} (
                  {fmtNum(((toMs(info.end) ?? 0) - (toMs(info.start) ?? 0)) / 86400_000, 0)} ngày)
                </span>
              )}
            </div>
            <Timeline info={info} />
          </div>
        ))
      )}
    </div>
  );
}
