import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { vi } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface DateRange {
  from: Date;
  to: Date;
}

const PRESETS = [
  { label: '3 ngày qua', days: 3 },
  { label: '7 ngày qua', days: 7 },
  { label: '14 ngày qua', days: 14 },
  { label: '30 ngày qua', days: 30 },
  { label: '90 ngày qua', days: 90 },
];

export function presetRange(days: number): DateRange {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { from: subDays(today, days - 1), to: today };
}

export function DateRangePicker({ value, onChange, className }: { value: DateRange; onChange: (r: DateRange) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from?: Date; to?: Date }>(value);
  const today = new Date();

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(value);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('h-8 gap-2 text-xs font-normal border-primary/20', className)}>
          <CalendarDays className="h-4 w-4 text-primary" />
          <span className="font-medium">{format(value.from, 'dd/MM/yyyy')}</span>
          <span className="text-muted-foreground">→</span>
          <span className="font-medium">{format(value.to, 'dd/MM/yyyy')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end" sideOffset={8}>
        <div className="flex flex-col sm:flex-row">
          <div className="p-3 border-b sm:border-b-0 sm:border-r border-border bg-secondary/30">
            <p className="text-xs font-medium text-muted-foreground mb-2 px-1">Chọn nhanh</p>
            <div className="flex flex-row sm:flex-col gap-1 flex-wrap">
              {PRESETS.map((p) => (
                <button
                  key={p.days}
                  onClick={() => {
                    onChange(presetRange(p.days));
                    setOpen(false);
                  }}
                  className="px-3 py-1.5 text-xs rounded-lg text-left hover:bg-primary/10 hover:text-primary"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="p-3">
            <Calendar
              mode="range"
              locale={vi}
              selected={draft as { from: Date; to?: Date }}
              onSelect={(r) => setDraft(r ?? {})}
              disabled={(d) => d > today}
              numberOfMonths={1}
              defaultMonth={value.to}
              className="pointer-events-auto"
            />
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={!draft.from}
                onClick={() => {
                  if (draft.from) onChange({ from: draft.from, to: draft.to ?? draft.from });
                  setOpen(false);
                }}
              >
                Xác nhận
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
