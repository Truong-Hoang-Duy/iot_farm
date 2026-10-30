// src/services/aiAPI.ts
// Client gọi API xuống FastAPI Backend (Port 8000 qua Vite Proxy /api)

import { fetchProcessedStagesSummary, getAlerts } from './firebaseAPI';

export interface SensorReadingInput {
  moisture?: number;
  soiltemp?: number;
  pH?: number;
  EC?: number;
  N?: number;
  P?: number;
  K?: number;
  temperature?: number;
  humidity?: number;
}

export interface AdvisorRequest {
  plant_type?: string;
  age_days?: number;
  growth_stage?: string;
  sensor_reading?: SensorReadingInput;
  custom_notes?: string;
}

export interface FertilizerPlanItem {
  name: string;
  timing: string;
  amount: string;
  method: string;
  purpose: string;
}

export interface AdvisorResponse {
  status: string;
  plant_type?: string;
  age_days?: number;
  growth_stage?: string;
  soil_health_score: number;
  summary: string;
  fertilizer_plan: FertilizerPlanItem[];
  watering_advice: string;
  pest_disease_warnings: string[];
  soil_improvement_tips: string[];
  ai_model_used: string;
  timestamp: string;
  saved_at?: string;
  sensor_snapshot?: Record<string, any>;
}

export interface ChatMessageItem {
  role: 'user' | 'model';
  content: string;
}

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

// Kiểm tra tình trạng backend AI
export const checkAIHealth = async (): Promise<{ status: string; gemini_configured: boolean; gemini_model: string } | null> => {
  try {
    const res = await fetch(`${API_BASE}/api/recommendations/health`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[AI API] Backend chưa khởi động:', err);
  }
  return null;
};

// Gọi sinh đề xuất từ AI Advisor (lưu đè trực tiếp vào DB)
export const fetchAIAdvisor = async (payload: AdvisorRequest = {}): Promise<AdvisorResponse> => {
  const res = await fetch(`${API_BASE}/api/recommendations/ai-advisor`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plant_type: payload.plant_type,
      age_days: payload.age_days,
      growth_stage: payload.growth_stage,
      sensor_reading: payload.sensor_reading,
      custom_notes: payload.custom_notes,
    }),
  });

  if (!res.ok) {
    throw new Error(`Lỗi kết nối AI Backend (HTTP ${res.status})`);
  }

  return await res.json();
};

// Hỏi đáp trực tiếp cùng trợ lý AI Nông nghiệp
export const sendAIChatMessage = async (
  message: string,
  sensor?: SensorReadingInput,
  history: ChatMessageItem[] = []
): Promise<string> => {
  const res = await fetch(`${API_BASE}/api/recommendations/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      sensor_reading: sensor || null,
      history,
    }),
  });

  if (!res.ok) {
    throw new Error(`Lỗi gửi tin nhắn tới AI (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data.reply;
};

// Lấy bản ghi khuyến nghị mới nhất đã được lưu trong DB/Firebase
export const fetchLatestCachedAdvisor = async (): Promise<AdvisorResponse | null> => {
  try {
    const res = await fetch(`${API_BASE}/api/recommendations/latest`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[IoT Farm API] Không thể lấy khuyến nghị từ DB:', err);
  }
  return null;
};

// ==================== AI ALERTS API (GEMINI DYNAMIC ALERTS) ====================
export interface AIAlertItem {
  id: string;
  level: 0 | 1 | 2;
  message: string;
  action: string;
  time: string;
  active: boolean;
}

export interface AIAlertsBundleResponse {
  status: string;
  is_mock_test: boolean;
  sensor_timestamp: string;
  forecast_horizon?: string;
  sensor_reading: SensorReadingInput;
  plant_context: {
    plant_type: string;
    age_days: number;
    stage_number: number;
    growth_stage: string;
  };
  anomalies_detected: Array<{
    key: string;
    label: string;
    value: number;
    min: number;
    max: number;
    unit: string;
    status: string;
    delta: string;
    is_predictive?: boolean;
  }>;
  predictive_anomalies_count?: number;
  prompt_used: string;
  ai_model_used: string;
  generated_at: string;
  alerts: AIAlertItem[];
}

const STAGE_6_THRESHOLDS: Array<{
  key: keyof SensorReadingInput;
  label: string;
  min: number;
  max: number;
  unit: string;
}> = [
  { key: 'moisture', label: 'Độ ẩm đất', min: 55, max: 65, unit: '%' },
  { key: 'soiltemp', label: 'Nhiệt độ đất', min: 24, max: 29, unit: '°C' },
  { key: 'pH', label: 'Độ pH đất', min: 6.2, max: 6.8, unit: 'pH' },
  { key: 'EC', label: 'Độ dẫn điện EC', min: 0.8, max: 1.4, unit: 'mS/cm' },
  { key: 'N', label: 'Đạm (N)', min: 80, max: 150, unit: 'ppm' },
  { key: 'P', label: 'Lân (P)', min: 250, max: 450, unit: 'ppm' },
  { key: 'K', label: 'Kali (K)', min: 300, max: 500, unit: 'ppm' },
  { key: 'temperature', label: 'Nhiệt độ không khí', min: 24, max: 31, unit: '°C' },
  { key: 'humidity', label: 'Độ ẩm không khí', min: 60, max: 75, unit: '%' },
];

async function buildClientFallbackAIAlerts(horizon: string = '6h'): Promise<AIAlertsBundleResponse | null> {
  const [summaryRes, fbAlerts] = await Promise.all([
    fetchProcessedStagesSummary('ffill').catch(() => null),
    getAlerts().catch(() => []),
  ]);
  if (!summaryRes?.latest?.reading) return null;

  const reading = summaryRes.latest.reading;
  const ts = summaryRes.latest.timestamp;
  const datePart = summaryRes.latest.date;
  const totalDays = summaryRes.summary?.totalDays || 263;

  const anomalies: AIAlertsBundleResponse['anomalies_detected'] = [];
  for (const cfg of STAGE_6_THRESHOLDS) {
    const val = Number(reading[cfg.key as keyof typeof reading] ?? 0);
    if (val < cfg.min) {
      anomalies.push({
        key: cfg.key,
        label: cfg.label,
        value: val,
        min: cfg.min,
        max: cfg.max,
        unit: cfg.unit,
        status: 'low',
        delta: `-${Number((cfg.min - val).toFixed(2))} ${cfg.unit}`,
      });
    } else if (val > cfg.max) {
      anomalies.push({
        key: cfg.key,
        label: cfg.label,
        value: val,
        min: cfg.min,
        max: cfg.max,
        unit: cfg.unit,
        status: 'high',
        delta: `+${Number((val - cfg.max).toFixed(2))} ${cfg.unit}`,
      });
    }
  }

  const todayAlerts = fbAlerts
    .filter((a) => a.time && a.time.startsWith(datePart))
    .map((a) => ({
      id: a.id,
      level: a.level as 0 | 1 | 2,
      message: a.message,
      action: a.action,
      time: a.time,
      active: a.active,
    }));

  const fallbackAlerts: AIAlertItem[] =
    todayAlerts.length > 0
      ? todayAlerts
      : anomalies.map((item) => ({
          id: `${item.label} ${item.status === 'low' ? 'thấp' : 'cao'}`,
          level: 1,
          message: `Tại mẫu đo ${ts}, ${item.label.toLowerCase()} đạt ${item.value} ${item.unit}, nằm ngoài ngưỡng chuẩn (${item.min}–${item.max} ${item.unit}, lệch ${item.delta}).`,
          action:
            item.status === 'low'
              ? `Bổ sung hoặc điều chỉnh tăng ${item.label.toLowerCase()} về vùng tối ưu ${item.min}–${item.max} ${item.unit}.`
              : `Kiểm tra thoát nước/thông gió để hạ ${item.label.toLowerCase()} về vùng tối ưu ${item.min}–${item.max} ${item.unit}.`,
          time: ts,
          active: true,
        }));

  return {
    status: 'ok',
    is_mock_test: false,
    sensor_timestamp: ts,
    forecast_horizon: horizon,
    sensor_reading: reading,
    plant_context: {
      plant_type: 'Cây ớt',
      age_days: totalDays,
      stage_number: 6,
      growth_stage: 'Giai đoạn 6: Cuối vụ và phục hồi đất',
    },
    anomalies_detected: anomalies,
    predictive_anomalies_count: fallbackAlerts.filter((a) => a.id.startsWith('Dự báo')).length,
    prompt_used: 'Client-side agronomic threshold & Firebase sync',
    ai_model_used: 'firebase-sync',
    generated_at: new Date().toISOString(),
    alerts: fallbackAlerts,
  };
}

async function fetchJsonIfValid(url: string, options?: RequestInit): Promise<any | null> {
  try {
    const res = await fetch(url, options);
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const fetchLatestAIAlerts = async (
  refresh: boolean = false,
  horizon: string = '6h',
): Promise<AIAlertsBundleResponse | null> => {
  const json = await fetchJsonIfValid(
    `${API_BASE}/api/alerts/latest?refresh=${refresh}&horizon=${encodeURIComponent(horizon)}`
  );
  if (json && json.status) {
    return json as AIAlertsBundleResponse;
  }
  return buildClientFallbackAIAlerts(horizon);
};

export const triggerAnalyzeAIAlerts = async (horizon: string = '6h'): Promise<AIAlertsBundleResponse> => {
  const json = await fetchJsonIfValid(
    `${API_BASE}/api/alerts/analyze?horizon=${encodeURIComponent(horizon)}`,
    { method: 'POST' }
  );
  if (json && json.status) {
    return json as AIAlertsBundleResponse;
  }
  const fallback = await buildClientFallbackAIAlerts(horizon);
  if (fallback) return fallback;
  throw new Error('Không thể phân tích cảnh báo do thiếu dữ liệu cảm biến.');
};

export const insertMockTestAndAnalyzeAlerts = async (): Promise<AIAlertsBundleResponse> => {
  const res = await fetch(`${API_BASE}/api/alerts/test-mock`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Lỗi tạo dữ liệu test và phân tích cảnh báo (HTTP ${res.status})`);
  }
  return await res.json();
};

export const deleteMockTestAndRestoreAlerts = async (): Promise<{ message: string; data: AIAlertsBundleResponse }> => {
  const res = await fetch(`${API_BASE}/api/alerts/test-mock`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Lỗi xóa dữ liệu test (HTTP ${res.status})`);
  }
  return await res.json();
};
