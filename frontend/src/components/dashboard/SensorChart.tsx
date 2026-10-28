import { useState, useMemo } from 'react';
import { CalendarIcon, Download, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, parse, isAfter, isBefore, isEqual, addDays, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { vi } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { FirebaseSensorData } from '@/services/firebaseAPI';
import * as XLSX from 'xlsx';

interface SensorChartProps {
  sensorData?: FirebaseSensorData | null;
}

const SENSOR_COLORS = {
  moisture: 'hsl(200, 85%, 55%)',
  soiltemp: 'hsl(38, 92%, 50%)',
  pH: 'hsl(195, 85%, 50%)',
  EC: 'hsl(30, 60%, 45%)',
  N: 'hsl(280, 70%, 55%)',
  P: 'hsl(152, 76%, 45%)',
  K: 'hsl(195, 85%, 50%)',
  temperature: 'hsl(0, 70%, 55%)',
  humidity: 'hsl(220, 70%, 55%)',
};

const SENSOR_LABELS: Record<string, string> = {
  moisture: 'Độ ẩm đất (%)',
  soiltemp: 'Nhiệt độ đất (°C)',
  pH: 'pH',
  EC: 'EC (mS/cm)',
  N: 'N (ppm)',
  P: 'P (ppm)',
  K: 'K (ppm)',
  temperature: 'Nhiệt độ KK (°C)',
  humidity: 'Độ ẩm KK (%)',
};

type DateRangeMode = 'single' | 'range';

// Quick select presets
const RANGE_PRESETS = [
  { label: '7 ngày qua', getValue: (today: Date) => ({ from: subDays(today, 6), to: today }) },
  { label: '14 ngày qua', getValue: (today: Date) => ({ from: subDays(today, 13), to: today }) },
  { label: '30 ngày qua', getValue: (today: Date) => ({ from: subDays(today, 29), to: today }) },
  { label: 'Tuần này', getValue: (today: Date) => ({ from: startOfWeek(today, { weekStartsOn: 1 }), to: endOfWeek(today, { weekStartsOn: 1 }) }) },
  { label: 'Tháng này', getValue: (today: Date) => ({ from: startOfMonth(today), to: endOfMonth(today) }) },
];

export default function SensorChart({ sensorData }: SensorChartProps) {
  const [mode, setMode] = useState<DateRangeMode>('single');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined,
  });
  const [isRangePickerOpen, setIsRangePickerOpen] = useState(false);
  const [visibleSensors, setVisibleSensors] = useState<Set<string>>(
    new Set(['moisture', 'soiltemp', 'pH'])
  );

  // Get available dates from sensor data as Date objects
  const availableDates = useMemo(() => {
    if (!sensorData) return [];
    return Object.keys(sensorData).sort().map(dateStr => 
      parse(dateStr, 'yyyy-MM-dd', new Date())
    );
  }, [sensorData]);

  // Set initial selected date to latest available
  useMemo(() => {
    if (availableDates.length > 0 && !selectedDate) {
      setSelectedDate(availableDates[availableDates.length - 1]);
    }
  }, [availableDates, selectedDate]);

  // Check if a date is available
  const isDateAvailable = (date: Date) => {
    return availableDates.some(d => 
      d.getFullYear() === date.getFullYear() &&
      d.getMonth() === date.getMonth() &&
      d.getDate() === date.getDate()
    );
  };

  // Count available dates in range
  const getAvailableDatesInRange = (from: Date, to: Date) => {
    return availableDates.filter(d => 
      (isAfter(d, from) || isEqual(d, from)) && 
      (isBefore(d, to) || isEqual(d, to))
    ).length;
  };

  // Process sensor data for the selected date(s)
  const chartData = useMemo(() => {
    if (!sensorData) return [];

    if (mode === 'single') {
      if (!selectedDate) return [];
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const dayData = sensorData[dateStr];
      if (!dayData) return [];

      const times = Object.keys(dayData).sort();
      return times.map(time => ({
        timestamp: time,
        ...dayData[time],
      }));
    } else {
      // Range mode
      if (!dateRange.from || !dateRange.to) return [];
      
      const result: Array<{ timestamp: string; date: string; [key: string]: any }> = [];
      
      // Get all dates in range that have data
      const datesInRange = availableDates.filter(d => 
        (isAfter(d, dateRange.from!) || isEqual(d, dateRange.from!)) && 
        (isBefore(d, dateRange.to!) || isEqual(d, dateRange.to!))
      );

      datesInRange.forEach(date => {
        const dateStr = format(date, 'yyyy-MM-dd');
        const dayData = sensorData[dateStr];
        if (dayData) {
          const times = Object.keys(dayData).sort();
          times.forEach(time => {
            result.push({
              timestamp: `${format(date, 'dd/MM')} ${time}`,
              date: dateStr,
              ...dayData[time],
            });
          });
        }
      });

      return result;
    }
  }, [sensorData, selectedDate, dateRange, mode, availableDates]);

  const toggleSensor = (sensor: string) => {
    const newSet = new Set(visibleSensors);
    if (newSet.has(sensor)) {
      newSet.delete(sensor);
    } else {
      newSet.add(sensor);
    }
    setVisibleSensors(newSet);
  };

  const handleDownload = () => {
    if (chartData.length === 0) return;
    
    let fileName: string;
    if (mode === 'single' && selectedDate) {
      fileName = `sensor-data-${format(selectedDate, 'yyyy-MM-dd')}.xlsx`;
    } else if (dateRange.from && dateRange.to) {
      fileName = `sensor-data-${format(dateRange.from, 'yyyy-MM-dd')}-to-${format(dateRange.to, 'yyyy-MM-dd')}.xlsx`;
    } else {
      return;
    }
    
    // Prepare data for Excel
    const excelData = chartData.map(row => ({
      'Thời gian': row.timestamp,
      'Độ ẩm đất (%)': row.moisture,
      'Nhiệt độ đất (°C)': row.soiltemp,
      'pH': row.pH,
      'EC (mS/cm)': row.EC,
      'N (ppm)': row.N,
      'P (ppm)': row.P,
      'K (ppm)': row.K,
      'Nhiệt độ KK (°C)': row.temperature,
      'Độ ẩm KK (%)': row.humidity,
      'Ánh sáng': row.light,
    }));

    // Create workbook and worksheet
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sensor Data');

    // Auto-fit column widths
    const columnWidths = Object.keys(excelData[0] || {}).map(key => ({
      wch: Math.max(key.length + 2, 12)
    }));
    worksheet['!cols'] = columnWidths;

    // Download file
    XLSX.writeFile(workbook, fileName);
  };

  const handleModeChange = (newMode: DateRangeMode) => {
    setMode(newMode);
    if (newMode === 'range' && selectedDate) {
      setDateRange({ from: selectedDate, to: selectedDate });
    }
  };

  const handlePresetClick = (preset: typeof RANGE_PRESETS[0]) => {
    const today = availableDates[availableDates.length - 1] || new Date();
    const { from, to } = preset.getValue(today);
    
    // Toggle: if same preset is selected, reset to today instead of empty
    if (dateRange.from && dateRange.to && 
        isEqual(from, dateRange.from) && isEqual(to, dateRange.to)) {
      setDateRange({ from: today, to: today });
    } else {
      setDateRange({ from, to });
    }
  };

  const handleDateRangeSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (range) {
      setDateRange({ from: range.from, to: range.to });
    }
  };

  if (!sensorData || (mode === 'single' && chartData.length === 0 && !selectedDate)) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <h3 className="font-display text-xl font-semibold mb-4">
          Biểu đồ cảm biến theo thời gian
        </h3>
        <div className="h-80 flex items-center justify-center text-muted-foreground">
          Không có dữ liệu để hiển thị
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h3 className="font-display text-lg sm:text-xl font-semibold">
            Biểu đồ cảm biến
          </h3>
          
          <div className="flex items-center gap-2 flex-wrap">
            {/* Mode Toggle */}
            <div className="flex rounded-lg border border-border p-0.5 bg-secondary/50">
              <button
                onClick={() => handleModeChange('single')}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-all",
                  mode === 'single' 
                    ? "bg-background shadow-sm text-foreground" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Ngày
              </button>
              <button
                onClick={() => handleModeChange('range')}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-all",
                  mode === 'range' 
                    ? "bg-background shadow-sm text-foreground" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Khoảng thời gian
              </button>
            </div>

            {/* Date Picker(s) */}
            {mode === 'single' ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-[140px] sm:w-[160px] justify-start text-left font-normal h-8 text-xs sm:text-sm",
                      !selectedDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-3 w-3 sm:h-4 sm:w-4" />
                    {selectedDate ? format(selectedDate, "dd/MM/yyyy", { locale: vi }) : <span>Chọn ngày</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    disabled={(date) => !isDateAvailable(date)}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            ) : (
              /* Enhanced Date Range Picker */
              <Popover open={isRangePickerOpen} onOpenChange={setIsRangePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "min-w-[200px] sm:min-w-[280px] justify-start text-left font-normal h-9 text-xs sm:text-sm gap-2",
                      "bg-gradient-to-r from-background to-secondary/30 hover:from-secondary/50 hover:to-secondary/50",
                      "border-primary/20 hover:border-primary/40 transition-all duration-200",
                      !dateRange.from && "text-muted-foreground"
                    )}
                  >
                    <CalendarDays className="h-4 w-4 text-primary" />
                    {dateRange.from ? (
                      dateRange.to ? (
                        <span className="flex items-center gap-1.5">
                          <span className="font-medium">{format(dateRange.from, "dd/MM/yyyy")}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="font-medium">{format(dateRange.to, "dd/MM/yyyy")}</span>
                        </span>
                      ) : (
                        <span className="font-medium">{format(dateRange.from, "dd/MM/yyyy")}</span>
                      )
                    ) : (
                      <span>Chọn khoảng thời gian</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent 
                  className="w-auto p-0 shadow-xl border-primary/10" 
                  align="end"
                  sideOffset={8}
                >
                  <div className="flex flex-col sm:flex-row">
                    {/* Quick Presets Panel */}
                    <div className="p-3 border-b sm:border-b-0 sm:border-r border-border bg-secondary/30">
                      <p className="text-xs font-medium text-muted-foreground mb-2 px-1">Chọn nhanh</p>
                      <div className="flex flex-row sm:flex-col gap-1 flex-wrap">
                        {RANGE_PRESETS.map((preset, index) => {
                          const today = availableDates[availableDates.length - 1] || new Date();
                          const { from, to } = preset.getValue(today);
                          const availableCount = getAvailableDatesInRange(from, to);
                          
                          return (
                            <button
                              key={index}
                              onClick={() => handlePresetClick(preset)}
                              className={cn(
                                "px-3 py-2 text-xs rounded-lg text-left transition-all duration-150",
                                "hover:bg-primary/10 hover:text-primary",
                                "flex items-center justify-between gap-2 min-w-[100px]",
                                dateRange.from && dateRange.to && 
                                isEqual(from, dateRange.from) && isEqual(to, dateRange.to)
                                  ? "bg-primary/15 text-primary font-medium"
                                  : "text-foreground"
                              )}
                            >
                              <span>{preset.label}</span>
                              {availableCount > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                                  {availableCount}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Calendar Panel */}
                    <div className="p-3">
                      <Calendar
                        mode="range"
                        selected={dateRange as { from: Date; to: Date }}
                        onSelect={handleDateRangeSelect}
                        disabled={(date) => !isDateAvailable(date)}
                        numberOfMonths={1}
                        className="pointer-events-auto"
                        today={new Date()}
                        modifiers={{
                          today: new Date(),
                        }}
                        modifiersClassNames={{
                          today: "calendar-today-marker",
                        }}
                        classNames={{
                          day_range_middle: "bg-gradient-to-r from-primary/10 via-primary/20 to-primary/10 text-foreground",
                          day_selected: "calendar-day-selected",
                          day_range_start: "calendar-day-range-edge calendar-day-range-start",
                          day_range_end: "calendar-day-range-edge calendar-day-range-end",
                        }}
                      />
                      
                      {/* Selected Range Summary */}
                      {dateRange.from && dateRange.to && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                              <span className="text-muted-foreground">
                                {getAvailableDatesInRange(dateRange.from, dateRange.to)} ngày có dữ liệu
                              </span>
                            </div>
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 text-xs px-3"
                              onClick={() => setIsRangePickerOpen(false)}
                            >
                              Xác nhận
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}

            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleDownload} 
              disabled={chartData.length === 0}
              className="gap-1 sm:gap-2 h-8 text-xs sm:text-sm px-2 sm:px-3"
            >
              <Download className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Tải Excel</span>
            </Button>
          </div>
        </div>

        {/* Date range info */}
        {mode === 'range' && dateRange.from && dateRange.to && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/30 rounded-lg px-3 py-2">
            <CalendarDays className="h-3.5 w-3.5 text-primary" />
            <span>
              Hiển thị dữ liệu từ <span className="font-medium text-foreground">{format(dateRange.from, "dd/MM/yyyy")}</span> đến <span className="font-medium text-foreground">{format(dateRange.to, "dd/MM/yyyy")}</span>
            </span>
            {chartData.length > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                {chartData.length} điểm
              </span>
            )}
          </div>
        )}
      </div>

      {/* Sensor Toggles */}
      <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-4">
        {Object.keys(SENSOR_LABELS).map((sensor) => (
          <button
            key={sensor}
            onClick={() => toggleSensor(sensor)}
            className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-medium transition-all ${
              visibleSensors.has(sensor)
                ? 'text-white'
                : 'bg-secondary text-muted-foreground hover:bg-secondary/80'
            }`}
            style={{
              backgroundColor: visibleSensors.has(sensor)
                ? SENSOR_COLORS[sensor as keyof typeof SENSOR_COLORS]
                : undefined,
            }}
          >
            {SENSOR_LABELS[sensor]}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="h-64 sm:h-80">
        {chartData.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
            <CalendarDays className="h-8 w-8 opacity-50" />
            <span>
              {mode === 'range' 
                ? 'Chọn khoảng thời gian để xem biểu đồ' 
                : 'Không có dữ liệu cho ngày đã chọn'}
            </span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="timestamp"
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tick={{ fontSize: mode === 'range' ? 8 : 9 }}
                interval={mode === 'range' ? 'preserveStartEnd' : undefined}
              />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tick={{ fontSize: 9 }} width={35} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '10px' }} />
              {Object.keys(SENSOR_COLORS).map((sensor) =>
                visibleSensors.has(sensor) ? (
                  <Line
                    key={sensor}
                    type="monotone"
                    dataKey={sensor}
                    name={SENSOR_LABELS[sensor]}
                    stroke={SENSOR_COLORS[sensor as keyof typeof SENSOR_COLORS]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ) : null
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}