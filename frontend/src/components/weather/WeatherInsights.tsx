import { CloudRain, Droplets, Flame, Lightbulb, Link2, ShieldAlert, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { targetLabel, weatherVarLabel, type CorrelationResponse, type WeatherHourly, type WeatherNext24h } from '@/services/backendAPI';
import { fmtNum } from '@/components/forecast/chartUtils';
import { statsBetween, sumBetween } from './weatherUtils';
import { strengthLabel } from './CorrelationHeatmap';

export interface Insight {
  icon: typeof Sun;
  tone: 'info' | 'good' | 'warn' | 'alert';
  title: string;
  text: string;
}

const H = 3600_000;

/** Sinh nhận định tự động từ dự báo thời tiết gần + ma trận tương quan. */
export function generateInsights(near: WeatherHourly[], corr?: CorrelationResponse, now = Date.now(), next24h?: WeatherNext24h): Insight[] {
  const out: Insight[] = [];

  const hasFuture = near.some((r) => r.ts > now);
  if (!hasFuture && next24h) {
    const rain = next24h.precip_total_mm;
    if (rain !== undefined && rain >= 1) {
      out.push({
        icon: CloudRain,
        tone: 'info',
        title: rain >= 5 ? 'Dự báo mưa đáng kể trong 24 giờ tới → Tạm ngưng tưới chống ngập úng rễ ớt' : 'Dự báo mưa nhẹ trong 24 giờ tới',
        text: `Tổng lượng mưa dự kiến ${fmtNum(rain, 1)} mm${next24h.precip_prob_max !== undefined ? ` (xác suất mưa tối đa ${fmtNum(next24h.precip_prob_max, 0)}%)` : ''}. ${
          rain >= 5
            ? 'Nên tạm hoãn tưới nhỏ giọt để tránh ngạt oxy bộ rễ chùm 0–30 cm của cây ớt và kiểm tra pH đất sau mưa.'
            : 'Có thể giảm 30–50% lượng nước tưới định kỳ.'
        }`,
      });
    } else if (rain !== undefined && next24h.et0_total_mm !== undefined && next24h.et0_total_mm >= 4) {
      out.push({
        icon: Droplets,
        tone: 'warn',
        title: 'Không mưa & lượng bốc thoát hơi nước cao → Tưới bù ẩm bảo vệ hoa ớt',
        text: `Lượng bốc thoát hơi nước 24 giờ tới khoảng ${fmtNum(next24h.et0_total_mm, 1)} mm – cần tưới bù đủ ẩm (duy trì độ ẩm đất 60%–75%) để chống khô héo cuống hoa ở nách chảng ba.`,
      });
    }
    if (next24h.temp_max !== undefined && next24h.temp_max >= 34) {
      out.push({
        icon: Flame,
        tone: 'alert',
        title: 'Cảnh báo nắng nóng → Tưới mát đón đầu vào sáng sớm (06:30)',
        text: `Nhiệt độ không khí cao nhất 24 giờ tới đạt khoảng ${fmtNum(next24h.temp_max, 1)} °C (sóng nhiệt sẽ truyền xuống tầng rễ ớt sau 6 giờ) – nên tưới làm mát từ 06:30 sáng để bảo vệ sức sống hạt phấn hoa.`,
      });
    }
    if (next24h.rh_mean !== undefined && next24h.rh_mean >= 85) {
      out.push({
        icon: ShieldAlert,
        tone: 'warn',
        title: 'Độ ẩm không khí cao → Cảnh báo bệnh thán thư quả ớt',
        text: `Độ ẩm không khí trung bình 24 giờ tới khoảng ${fmtNum(next24h.rh_mean, 0)}% – nguy cơ nấm thán thư và héo rũ tăng cao, hạn chế tưới phun mưa lên tán lá.`,
      });
    }
  }

  if (near.length && hasFuture) {
    const r24 = sumBetween(near, 'precipitation', now, now + 24 * H);
    const r48 = sumBetween(near, 'precipitation', now + 24 * H, now + 48 * H);
    const et24 = sumBetween(near, 'et0_fao_evapotranspiration', now, now + 24 * H);
    const t24 = statsBetween(near, 'temperature_2m', now, now + 24 * H);
    const rh24 = statsBetween(near, 'relative_humidity_2m', now, now + 24 * H);

    if (r24.n) {
      if (r24.sum >= 5) {
        out.push({
          icon: CloudRain,
          tone: 'info',
          title: 'Dự báo mưa đáng kể trong 24 giờ tới → Tạm ngưng tưới chống ngập úng rễ ớt',
          text: `Dự báo tổng lượng mưa ${fmtNum(r24.sum, 1)} mm trong 24 giờ tới. Nên tạm ngưng bơm tưới để tránh ngạt oxy bộ rễ chùm 0–30 cm và kiểm tra độ pH đất sau mưa (bón vôi & phun Canxi – Bo nếu pH < 5.8).`,
        });
      } else if (r24.sum >= 1) {
        out.push({
          icon: CloudRain,
          tone: 'info',
          title: 'Dự báo mưa nhẹ trong 24 giờ tới',
          text: `Khoảng ${fmtNum(r24.sum, 1)} mm – có thể giảm khoảng 30–50% lượng nước tưới và theo dõi độ ẩm thể tích đất vùng rễ.`,
        });
      }
    }
    if (r48.n && r48.sum >= 5) {
      out.push({
        icon: CloudRain,
        tone: 'info',
        title: 'Dự báo mưa lớn trong 24–48 giờ tới → hoãn bón phân gốc NPK',
        text: `Dự báo ${fmtNum(r48.sum, 1)} mm vào ngày mai đến ngày kia – nên tạm hoãn bón thúc đạm, lân, kali vào gốc để tránh rửa trôi dinh dưỡng qua tầng đất 0–30 cm.`,
      });
    }
    if (r24.n && r48.n && r24.sum + r48.sum < 1) {
      const et = et24.n ? et24.sum : undefined;
      out.push({
        icon: Droplets,
        tone: et !== undefined && et >= 4 ? 'warn' : 'good',
        title: et !== undefined && et >= 4 ? 'Không mưa 48 giờ & bốc thoát hơi nước cao → Tăng tưới bù ẩm cho cây ớt' : 'Thời tiết khô ráo trong 48 giờ tới',
        text:
          et !== undefined
            ? `Lượng bốc thoát hơi nước 24 giờ tới khoảng ${fmtNum(et, 1)} mm. ${et >= 4 ? 'Cây ớt thoát hơi nước mạnh, cần tưới bù đủ ẩm vào 06:30 sáng và 16:30 chiều để giữ ẩm độ đất 60%–75%, chống rụng hoa chảng ba.' : 'Duy trì lịch tưới nhỏ giọt định kỳ.'}`
            : 'Duy trì lịch tưới theo độ ẩm thể tích đất vùng rễ.',
      });
    }
    if (t24 && t24.max >= 34) {
      out.push({
        icon: Flame,
        tone: 'alert',
        title: 'Cảnh báo nắng nóng → Tưới mát đón đầu vào sáng sớm (06:30)',
        text: `Nhiệt độ không khí cao nhất 24 giờ tới khoảng ${fmtNum(t24.max, 1)} °C (sóng nhiệt sẽ truyền xuống tầng rễ ớt sau 6 giờ) – cần tưới mát đón đầu từ sáng sớm và phòng trừ bọ trĩ, nhện trắng.`,
      });
    }
    if (rh24 && rh24.mean >= 85) {
      out.push({
        icon: ShieldAlert,
        tone: 'warn',
        title: 'Độ ẩm không khí cao → Cảnh báo bệnh thán thư quả ớt',
        text: `Độ ẩm không khí trung bình 24 giờ tới khoảng ${fmtNum(rh24.mean, 0)}% – nguy cơ nấm thán thư và héo rũ tăng cao, hạn chế tưới phun lên lá.`,
      });
    }
  }

  if (corr && corr.variables_weather.length && corr.variables_sensor.length) {
    const pairs: { w: string; s: string; r: number; lag?: number }[] = [];
    corr.variables_weather.forEach((w, i) =>
      corr.variables_sensor.forEach((s, j) => {
        const rl = corr.lag?.best_corr[i]?.[j];
        const r = rl ?? corr.matrix[i]?.[j];
        if (r === null || r === undefined) return;
        const lag = rl !== null && rl !== undefined ? corr.lag?.best_lag_h[i]?.[j] ?? undefined : undefined;
        pairs.push({ w, s, r, lag: lag === null ? undefined : lag });
      }),
    );
    pairs
      .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
      .slice(0, 3)
      .filter((p) => Math.abs(p.r) >= 0.3)
      .forEach((p) => {
        out.push({
          icon: Link2,
          tone: 'good',
          title: `${targetLabel(p.s)} ↔ ${weatherVarLabel(p.w)}`,
          text: `Tương quan ${p.r >= 0 ? 'thuận' : 'nghịch'} ${strengthLabel(p.r)} (${corr.method === 'spearman' ? 'ρ' : 'r'} = ${p.r.toFixed(2)}${
            p.lag ? `, trễ ${p.lag} giờ` : ''
          }) trong ${corr.days ?? '?'} ngày qua${p.lag && p.lag > 0 ? ` – ${weatherVarLabel(p.w).toLowerCase()} ảnh hưởng tới ${targetLabel(p.s).toLowerCase()} sau khoảng ${p.lag} giờ.` : '.'}`,
        });
      });
  }

  // Nhận định do backend sinh từ phân tích tương quan
  for (const s of corr?.insights ?? []) {
    out.push({ icon: Lightbulb, tone: 'info', title: 'Phân tích dữ liệu', text: s });
  }

  return out;
}

const TONE: Record<Insight['tone'], string> = {
  info: 'border-blue-500/20 bg-blue-500/5 text-blue-600',
  good: 'border-success/20 bg-success/5 text-success',
  warn: 'border-warning/30 bg-warning/5 text-warning',
  alert: 'border-destructive/30 bg-destructive/5 text-destructive',
};

export function InsightsList({ insights, className }: { insights: Insight[]; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-border bg-card p-4 sm:p-6 space-y-3', className)}>
      <h2 className="font-display text-lg sm:text-xl font-semibold flex items-center gap-2">
        <Lightbulb className="h-5 w-5 text-warning" />
        Nhận định tự động
      </h2>
      {insights.length === 0 ? (
        <p className="text-sm text-muted-foreground">Đang tổng hợp nhận định canh tác từ dự báo thời tiết 24–48 giờ tới.</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {insights.map((ins, i) => (
            <li key={i} className={cn('flex gap-3 rounded-xl border p-3', TONE[ins.tone])}>
              <ins.icon className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{ins.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{ins.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
