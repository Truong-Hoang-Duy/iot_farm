import { cn } from '@/lib/utils';

type Status = 'stable' | 'nutrient-deficient' | 'over-watered' | 'under-watered' | 'disease';

interface StatusBadgeProps {
  status: Status;
}

const statusConfig: Record<Status, { label: string; className: string }> = {
  stable: {
    label: 'Ổn định',
    className: 'bg-success/10 text-success border-success/20',
  },
  'nutrient-deficient': {
    label: 'Thiếu dinh dưỡng',
    className: 'bg-warning/10 text-warning border-warning/20',
  },
  'over-watered': {
    label: 'Thừa nước',
    className: 'bg-water/10 text-water border-water/20',
  },
  'under-watered': {
    label: 'Thiếu nước',
    className: 'bg-destructive/10 text-destructive border-destructive/20',
  },
  disease: {
    label: 'Bệnh',
    className: 'bg-destructive/10 text-destructive border-destructive/20',
  },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium",
        config.className
      )}
    >
      <span className={cn(
        "mr-2 h-2 w-2 rounded-full animate-pulse",
        status === 'stable' ? 'bg-success' : 'bg-current'
      )} />
      {config.label}
    </span>
  );
}
