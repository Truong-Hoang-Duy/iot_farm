import { useState, useEffect } from 'react';
import { Leaf, Calendar, TrendingUp, Beaker, CheckCircle, Clock, Target, Lightbulb } from 'lucide-react';
import { StatusBadge } from '@/components/dashboard/StatusBadge';
import { subscribeStreamingConfig, StreamingConfig } from '@/services/firebaseAPI';
import { getPlantData, getCurrentStageIndex, GrowthStage, PlantGrowthData } from '@/data/plantGrowthData';

const getStageRange = (stage: GrowthStage): string => {
  return `${stage.minDays} - ${stage.maxDays}`;
};

export default function PlantInfoPage() {
  const [streamingConfig, setStreamingConfig] = useState<StreamingConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeStreamingConfig((config) => {
      setStreamingConfig(config);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (isLoading || !streamingConfig) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const plantData = streamingConfig.config.plant;
  const ageDays = plantData.age_days;
  const plantType = plantData.type || 'chili';
  
  // Get plant-specific data
  const plantGrowthData: PlantGrowthData = getPlantData(plantType);
  const growthStages = plantGrowthData.stages;
  const totalNPK = plantGrowthData.totalNPK;
  const totalDays = plantGrowthData.totalDays;
  const careTipsByStage = plantGrowthData.careTips;
  
  const currentStageIndex = getCurrentStageIndex(ageDays, growthStages);
  const currentStage = growthStages[currentStageIndex];
  const careTips = careTipsByStage[currentStageIndex] || careTipsByStage[0];

  // Calculate progress within current stage
  const stageProgress = Math.min(100, Math.round(((ageDays - currentStage.minDays) / (currentStage.maxDays - currentStage.minDays)) * 100));
  const daysRemaining = Math.max(0, currentStage.maxDays - ageDays);
  const totalProgress = Math.round((ageDays / totalDays) * 100);

  // Get plant display name
  const getPlantDisplayName = (type: string): string => {
    const t = type.toLowerCase();
    if (t.includes('mustard') || t.includes('cải')) return 'Cải (Mustard)';
    if (t.includes('peanut') || t.includes('lạc') || t.includes('đậu phộng')) return 'Lạc / Đậu phộng (Peanut)';
    return 'Cây Ớt (Chili)';
  };

  // Get plant icon
  const getPlantIcon = (type: string): string => {
    const t = type.toLowerCase();
    if (t.includes('mustard') || t.includes('cải')) return '🥬';
    if (t.includes('peanut') || t.includes('lạc') || t.includes('đậu phộng')) return '🥜';
    return '🌶️';
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Thông tin cây trồng</h1>
          <p className="text-muted-foreground mt-1">
            Theo dõi và quản lý thông tin cây trồng của bạn
          </p>
        </div>
      </div>

      {/* Plant Card */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="gradient-primary p-8">
          <div className="flex items-center gap-6">
            <div className="h-24 w-24 rounded-2xl bg-primary-foreground/20 flex items-center justify-center text-5xl">
              {getPlantIcon(plantType)}
            </div>
            <div className="text-primary-foreground">
              <h2 className="font-display text-3xl font-bold">{getPlantDisplayName(plantType)}</h2>
              <div className="flex items-center gap-4 mt-2">
                <span className="inline-flex items-center rounded-full bg-white/20 backdrop-blur-md border border-white/30 px-3.5 py-1 text-sm font-semibold text-white shadow-sm">
                  <span className="mr-2 h-2.5 w-2.5 rounded-full bg-emerald-300 animate-pulse shadow-sm" />
                  Đang phát triển tốt • Ổn định
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 grid gap-6 sm:grid-cols-3">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-accent/10 flex items-center justify-center">
              <Calendar className="h-6 w-6 text-accent" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Số ngày trồng</p>
              <p className="font-display text-2xl font-bold">{ageDays} / {totalDays}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Giai đoạn</p>
              <p className="font-display text-lg font-bold">{currentStage.name}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-amber-500/15 flex items-center justify-center">
              <Beaker className="h-6 w-6 text-amber-700 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Tổng NPK cần (toàn vụ)</p>
              <p className="font-display text-sm font-bold">
                N:{totalNPK.n} | P:{totalNPK.p} | K:{totalNPK.k}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Growth Timeline - Horizontal Steps */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h3 className="font-display text-xl font-semibold mb-6 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          Tiến trình phát triển
          <span className="ml-auto text-sm font-normal text-muted-foreground">{totalProgress}% hoàn thành</span>
        </h3>
        
        {/* Progress bar */}
        <div className="mb-6 h-2 bg-secondary rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${totalProgress}%` }}
          />
        </div>

        {/* Timeline Steps - Responsive grid */}
        <div className={`grid gap-3 ${growthStages.length <= 4 ? 'grid-cols-2 sm:grid-cols-4' : growthStages.length <= 5 ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'}`}>
          {growthStages.map((stage, index) => {
            const isActive = index === currentStageIndex;
            const isPast = index < currentStageIndex;
            
            return (
              <div 
                key={stage.name} 
                className={`relative p-3 rounded-xl border-2 transition-all ${
                  isActive 
                    ? 'border-primary bg-primary/5 shadow-md' 
                    : isPast 
                    ? 'border-primary/30 bg-primary/5' 
                    : 'border-border bg-card'
                }`}
              >
                {/* Status icon */}
                <div className={`absolute -top-2 -right-2 h-6 w-6 rounded-full flex items-center justify-center ${
                  isActive 
                    ? 'bg-primary text-primary-foreground animate-pulse' 
                    : isPast 
                    ? 'bg-primary text-primary-foreground' 
                    : 'bg-secondary text-muted-foreground'
                }`}>
                  {isPast ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <span className="text-xs font-bold">{index + 1}</span>
                  )}
                </div>

                <p className={`text-xs font-medium mb-1 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                  {stage.name}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Ngày {stage.minDays} - {stage.maxDays}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Visual Progress Section */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Current Stage Progress - Visual Circle */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Tiến độ giai đoạn
          </h3>
          
          <div className="flex flex-col items-center">
            {/* Circular Progress */}
            <div className="relative h-32 w-32 mb-4">
              <svg className="h-32 w-32 -rotate-90" viewBox="0 0 100 100">
                <circle
                  className="text-secondary"
                  strokeWidth="8"
                  stroke="currentColor"
                  fill="transparent"
                  r="42"
                  cx="50"
                  cy="50"
                />
                <circle
                  className="text-primary transition-all duration-500"
                  strokeWidth="8"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="transparent"
                  r="42"
                  cx="50"
                  cy="50"
                  strokeDasharray={`${stageProgress * 2.64} 264`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display text-2xl font-bold text-primary">{stageProgress}%</span>
                <span className="text-xs text-muted-foreground">hoàn thành</span>
              </div>
            </div>

            {/* Stage Info */}
            <div className="text-center space-y-1">
              <p className="font-semibold">{currentStage.name}</p>
              <p className="text-sm text-muted-foreground">
                Ngày {ageDays - currentStage.minDays} / {currentStage.maxDays - currentStage.minDays}
              </p>
            </div>

            {/* Days Remaining */}
            <div className="mt-3 flex items-center gap-2 bg-accent/10 px-3 py-1.5 rounded-full">
              <Clock className="h-4 w-4 text-accent" />
              <span className="text-sm font-medium">Còn {daysRemaining} ngày</span>
            </div>
          </div>
        </div>

        {/* NPK Requirements - Visual Cards with BIGGER numbers */}
        <div className="rounded-2xl border border-border bg-card p-6 lg:col-span-2">
          <h3 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
            <Beaker className="h-5 w-5 text-nutrient" />
            Nhu cầu NPK giai đoạn hiện tại
          </h3>
          
          <div className="grid gap-4 sm:grid-cols-3 h-[calc(100%-3rem)]">
            {/* Nitrogen */}
            <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20 p-5 flex flex-col justify-between min-h-[160px]">
              <div className="flex items-start justify-between">
                <div className="h-12 w-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                  <span className="font-bold text-blue-600 text-2xl">N</span>
                </div>
                <div className="text-right">
                  <p className="font-display text-4xl font-bold text-blue-600">{currentStage.n}</p>
                  <p className="text-sm text-muted-foreground">kg/ha</p>
                </div>
              </div>
              <div className="mt-auto pt-3">
                <p className="text-sm font-semibold text-blue-600 mb-2">Đạm (Nitrogen)</p>
                <div className="h-2.5 bg-blue-200/50 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (currentStage.n / (totalNPK.n / growthStages.length * 2)) * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Phosphorus */}
            <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20 p-5 flex flex-col justify-between min-h-[160px]">
              <div className="flex items-start justify-between">
                <div className="h-12 w-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                  <span className="font-bold text-amber-700 dark:text-amber-400 text-2xl">P</span>
                </div>
                <div className="text-right">
                  <p className="font-display text-4xl font-bold text-amber-700 dark:text-amber-400">{currentStage.p}</p>
                  <p className="text-sm text-muted-foreground">kg/ha</p>
                </div>
              </div>
              <div className="mt-auto pt-3">
                <p className="text-sm font-bold text-amber-700 dark:text-amber-400 mb-2">Lân (Phosphorus)</p>
                <div className="h-2.5 bg-orange-200/50 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-orange-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (currentStage.p / (totalNPK.p / growthStages.length * 2)) * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Potassium */}
            <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20 p-5 flex flex-col justify-between min-h-[160px]">
              <div className="flex items-start justify-between">
                <div className="h-12 w-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
                  <span className="font-bold text-purple-600 text-2xl">K</span>
                </div>
                <div className="text-right">
                  <p className="font-display text-4xl font-bold text-purple-600">{currentStage.k}</p>
                  <p className="text-sm text-muted-foreground">kg/ha</p>
                </div>
              </div>
              <div className="mt-auto pt-3">
                <p className="text-sm font-semibold text-purple-600 mb-2">Kali (Potassium)</p>
                <div className="h-2.5 bg-purple-200/50 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-purple-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (currentStage.k / (totalNPK.k / growthStages.length * 2)) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* NPK Table for all stages */}
      <div className="rounded-2xl border border-border bg-card p-6 overflow-x-auto">
        <h3 className="font-display text-xl font-semibold mb-4">Bảng chỉ số NPK theo giai đoạn</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-4 font-semibold">Giai đoạn</th>
              <th className="text-center py-3 px-4 font-semibold">Thời gian (ngày)</th>
              <th className="text-center py-3 px-4 font-semibold text-blue-600 dark:text-blue-400">N (kg/ha)</th>
              <th className="text-center py-3 px-4 font-semibold text-amber-700 dark:text-amber-400">P (kg/ha)</th>
              <th className="text-center py-3 px-4 font-semibold text-purple-600 dark:text-purple-400">K (kg/ha)</th>
            </tr>
          </thead>
          <tbody>
            {growthStages.map((stage, index) => {
              const isActive = index === currentStageIndex;
              return (
                <tr 
                  key={stage.name} 
                  className={`border-b border-border/50 ${isActive ? 'bg-primary/10' : 'hover:bg-secondary/50'}`}
                >
                  <td className={`py-3 px-4 ${isActive ? 'font-semibold text-primary' : ''}`}>
                    {index + 1}. {stage.name}
                  </td>
                  <td className="text-center py-3 px-4">{getStageRange(stage)}</td>
                  <td className="text-center py-3 px-4 text-blue-600 dark:text-blue-400 font-medium">{stage.n}</td>
                  <td className="text-center py-3 px-4 text-amber-700 dark:text-amber-400 font-semibold">{stage.p}</td>
                  <td className="text-center py-3 px-4 text-purple-600 dark:text-purple-400 font-medium">{stage.k}</td>
                </tr>
              );
            })}
            <tr className="bg-secondary/50 font-semibold">
              <td className="py-3 px-4">Tổng cộng</td>
              <td className="text-center py-3 px-4">{totalDays} ngày</td>
              <td className="text-center py-3 px-4 text-blue-600 dark:text-blue-400">{totalNPK.n}</td>
              <td className="text-center py-3 px-4 text-amber-700 dark:text-amber-400">{totalNPK.p}</td>
              <td className="text-center py-3 px-4 text-purple-600 dark:text-purple-400">{totalNPK.k}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Care Tips Section */}
      <div className="rounded-2xl border border-border bg-card p-6">
        <h3 className="font-display text-xl font-semibold mb-4 flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-warning" />
          Hướng dẫn chăm sóc - {currentStage.name}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {careTips.map((tip, index) => (
            <div key={index} className="p-4 rounded-xl bg-secondary/30 border border-border">
              <h4 className="font-semibold text-primary mb-2">{tip.title}</h4>
              <p className="text-sm text-muted-foreground">{tip.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
