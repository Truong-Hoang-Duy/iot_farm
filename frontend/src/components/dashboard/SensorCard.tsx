import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface SensorCardProps {
  title: string;
  value: number;
  unit: string;
  icon: LucideIcon;
  color: 'primary' | 'accent' | 'warning' | 'soil' | 'water' | 'nutrient';
  min?: number;
  max?: number;
}

const colorVariants = {
  primary: 'from-primary/20 to-primary/5 border-primary/20',
  accent: 'from-accent/20 to-accent/5 border-accent/20',
  warning: 'from-warning/20 to-warning/5 border-warning/20',
  soil: 'from-soil/20 to-soil/5 border-soil/20',
  water: 'from-water/20 to-water/5 border-water/20',
  nutrient: 'from-nutrient/20 to-nutrient/5 border-nutrient/20',
};

const iconColorVariants = {
  primary: 'text-primary bg-primary/10',
  accent: 'text-accent bg-accent/10',
  warning: 'text-warning bg-warning/10',
  soil: 'text-soil bg-soil/10',
  water: 'text-water bg-water/10',
  nutrient: 'text-nutrient bg-nutrient/10',
};

export function SensorCard({ title, value, unit, icon: Icon, color, min, max }: SensorCardProps) {
  const percentage = min !== undefined && max !== undefined 
    ? ((value - min) / (max - min)) * 100 
    : null;

  const isInRange = percentage !== null && percentage >= 0 && percentage <= 100;
  console.log({ title, value, unit, min, max, percentage, isInRange });

  return (
    <div className={cn(
      "relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 sm:p-5 transition-all duration-300 hover:shadow-lg hover:-translate-y-1",
      colorVariants[color]
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1 min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate">{title}</p>
          <div className="flex items-baseline gap-1 flex-wrap">
            <span className="font-display text-xl sm:text-2xl lg:text-3xl font-bold truncate">{value}</span>
            <span className="text-xs sm:text-sm text-muted-foreground shrink-0">{unit}</span>
          </div>
        </div>
        <div className={cn("rounded-xl p-2 sm:p-3 shrink-0", iconColorVariants[color])}>
          <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
        </div>
      </div>

      {percentage !== null && (
        <div className="mt-3 sm:mt-4 space-y-1.5">
          <div className="flex justify-between text-[10px] sm:text-xs text-muted-foreground">
            <span className="truncate">{min}{unit}</span>
            <span className={cn("shrink-0 px-1", isInRange ? 'text-success' : 'text-warning')}>
              {isInRange ? 'Tối ưu' : 'Cảnh báo'}
            </span>
            <span className="truncate text-right">{max}{unit}</span>
          </div>
          <div className="h-1.5 sm:h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                isInRange ? "bg-success" : "bg-warning"
              )}
              style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
