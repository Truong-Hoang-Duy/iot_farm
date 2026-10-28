interface CircularGaugeProps {
  value: number;
  max: number;
  label: string;
  unit: string;
  color?: string;
}

export default function CircularGauge({
  value,
  max,
  label,
  unit,
  color = 'hsl(var(--primary))',
}: CircularGaugeProps) {
  const percentage = Math.min((value / max) * 100, 100);
  const circumference = 2 * Math.PI * 45; // radius = 45
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  // Format value appropriately
  const displayValue = value >= 100 ? Math.round(value) : value.toFixed(1);
  
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-20 w-20 sm:h-24 sm:w-24 lg:h-28 lg:w-28">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100">
          {/* Background circle */}
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="8"
          />
          {/* Progress circle */}
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-500"
          />
        </svg>
        {/* Value display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center p-1">
          <span className="text-sm sm:text-lg lg:text-xl font-bold leading-tight" style={{ color }}>
            {displayValue}
          </span>
          <span className="text-[9px] sm:text-[10px] lg:text-xs text-muted-foreground leading-tight">{unit}</span>
        </div>
      </div>
      <p className="mt-1.5 sm:mt-2 text-xs sm:text-sm font-medium text-center truncate max-w-full">{label}</p>
    </div>
  );
}
