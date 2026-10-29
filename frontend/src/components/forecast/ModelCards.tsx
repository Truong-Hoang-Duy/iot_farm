import { useMemo } from 'react';
import { CheckCircle2, CircleDashed, Cpu, ExternalLink, HelpCircle, Microchip } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { MODELS, modelColor, toMs, type ModelInfo } from '@/services/backendAPI';
import { fmtDateTime, fmtRelative } from './chartUtils';

interface MergedModel {
  key: string;
  name: string;
  family?: string;
  paper?: string;
  doiUrl?: string;
  year?: number;
  baseline: boolean;
  available?: boolean;
  trainedAt?: string;
  device?: string;
  gpuName?: string;
  status?: ModelInfo['status'];
  hyperparameters?: Record<string, unknown>;
  description?: string;
}

function mergeModels(remote: ModelInfo[] | undefined): MergedModel[] {
  const byKey = new Map((remote ?? []).map((m) => [m.key, m]));
  const out: MergedModel[] = MODELS.filter((m) => m.key !== 'best').map((d) => {
    const r = byKey.get(d.key);
    byKey.delete(d.key);
    return {
      key: d.key,
      name: r?.name ?? d.label,
      family: r?.family ?? d.family,
      paper: r?.paper ?? d.paper,
      doiUrl: r?.doi_url ?? (d.doi ? `https://doi.org/${d.doi}` : undefined),
      year: r?.year ?? d.year,
      baseline: !!d.baseline,
      available: r?.available,
      trainedAt: r?.trained_at,
      device: r?.device,
      gpuName: r?.gpu_name,
      status: r?.status,
      hyperparameters: r?.hyperparameters,
      description: r?.description,
    };
  });
  for (const r of byKey.values()) {
    if (r.key === 'best') continue;
    out.push({
      key: r.key,
      name: r.name,
      family: r.family,
      paper: r.paper,
      doiUrl: r.doi_url,
      year: r.year,
      baseline: /naive|baseline/i.test(r.key),
      available: r.available,
      trainedAt: r.trained_at,
      device: r.device,
      gpuName: r.gpu_name,
      status: r.status,
      hyperparameters: r.hyperparameters,
      description: r.description,
    });
  }
  return out;
}

export function DeviceBadge({ device }: { device?: string }) {
  if (!device) return null;
  const gpu = /cuda|gpu/i.test(device);
  return (
    <Badge
      variant="outline"
      className={cn('gap-1 font-medium', gpu ? 'border-success/40 bg-success/10 text-success' : 'border-border bg-secondary/50')}
      title={device}
    >
      {gpu ? <Microchip className="h-3 w-3" /> : <Cpu className="h-3 w-3" />}
      {gpu ? 'GPU' : 'CPU'}
      <span className="font-normal opacity-70 max-w-[110px] truncate">{device}</span>
    </Badge>
  );
}

function fmtHp(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toPrecision(3);
  if (typeof v === 'string' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

const GROUP_SHORT: Record<string, string> = { short: 'Ngắn hạn', long: 'Dài hạn' };

/** Làm phẳng siêu tham số; dạng {short:{...}, long:{...}} → "Ngắn hạn · key". */
function flattenHp(hp?: Record<string, unknown>): [string, unknown][] {
  if (!hp) return [];
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(hp)) {
    if ((k === 'short' || k === 'long') && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) out.push([`${GROUP_SHORT[k]} · ${k2}`, v2]);
    } else out.push([k, v]);
  }
  return out;
}

function fmtSeconds(s?: number): string {
  if (s === undefined) return '';
  if (s < 60) return `${s.toFixed(0)} s`;
  if (s < 3600) return `${(s / 60).toFixed(1)} phút`;
  return `${(s / 3600).toFixed(1)} giờ`;
}

export function ModelCards({ models, isLoading, backendDown }: { models?: ModelInfo[]; isLoading?: boolean; backendDown?: boolean }) {
  const merged = useMemo(() => mergeModels(models), [models]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {merged.map((m, idx) => {
        const color = modelColor(m.key, idx);
        const hp = flattenHp(m.hyperparameters).slice(0, 14);
        return (
          <div
            key={m.key}
            className={cn(
              'relative rounded-2xl border border-border bg-card p-4 flex flex-col gap-3 overflow-hidden',
              m.baseline && 'bg-secondary/20',
            )}
          >
            <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} />
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-display text-lg font-semibold leading-tight">{m.name}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {m.family}
                  {m.year ? ` · ${m.year}` : ''}
                </p>
              </div>
              {isLoading ? (
                <Skeleton className="h-5 w-16" />
              ) : m.available === true ? (
                <Badge className="gap-1 bg-success/15 text-success border-transparent hover:bg-success/20">
                  <CheckCircle2 className="h-3 w-3" /> Đã train
                </Badge>
              ) : m.available === false ? (
                <Badge variant="outline" className="gap-1 text-muted-foreground">
                  <CircleDashed className="h-3 w-3" /> Chưa train
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 text-muted-foreground" title={backendDown ? 'Backend chưa kết nối' : undefined}>
                  <HelpCircle className="h-3 w-3" /> Chưa rõ
                </Badge>
              )}
            </div>

            {m.baseline && (
              <Badge variant="secondary" className="w-fit text-[10px]">
                Baseline – mốc so sánh để tính MASE
              </Badge>
            )}

            {m.description && <p className="text-xs text-muted-foreground">{m.description}</p>}

            {m.paper && (
              <p className="text-xs leading-relaxed">
                <span className="italic">{m.paper}</span>
              </p>
            )}
            {m.doiUrl && (
              <a
                href={m.doiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline w-fit break-all"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                {m.doiUrl.replace(/^https?:\/\/(dx\.)?doi\.org\//, 'doi:')}
              </a>
            )}

            <div className="mt-auto space-y-2 pt-1">
              {m.status && (
                <div className="space-y-0.5 text-[11px]">
                  {Object.entries(m.status).map(([g, s]) => (
                    <div key={g} className="flex items-center gap-1.5">
                      <span className={cn('h-1.5 w-1.5 rounded-full', s.available ? 'bg-success' : 'bg-muted-foreground/40')} />
                      <span className="font-medium">{GROUP_SHORT[g] ?? g}:</span>
                      <span className="text-muted-foreground">
                        {s.available ? 'sẵn sàng' : 'chưa có'}
                        {s.device ? ` · ${/cuda|gpu/i.test(s.device) ? 'GPU' : 'CPU'}` : ''}
                        {s.train_seconds !== undefined ? ` · train ${fmtSeconds(s.train_seconds)}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <DeviceBadge device={m.gpuName && m.device && /cuda|gpu/i.test(m.device) ? `${m.device} · ${m.gpuName}` : m.device} />
                {m.trainedAt && (
                  <span className="text-[11px] text-muted-foreground" title={fmtDateTime(toMs(m.trainedAt))}>
                    Train: {fmtDateTime(toMs(m.trainedAt))} ({fmtRelative(toMs(m.trainedAt))})
                  </span>
                )}
              </div>
              {hp.length > 0 && (
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Siêu tham số</summary>
                  <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono">
                    {hp.map(([k, v]) => (
                      <div key={k} className="contents">
                        <span className="text-muted-foreground truncate" title={k}>
                          {k}
                        </span>
                        <span className="truncate" title={fmtHp(v)}>
                          {fmtHp(v)}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
