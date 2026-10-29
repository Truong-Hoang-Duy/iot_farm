// src/services/aiAPI.ts
// Client gọi API xuống FastAPI Backend (Port 8000 qua Vite Proxy /api)

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
  }>;
  prompt_used: string;
  ai_model_used: string;
  generated_at: string;
  alerts: AIAlertItem[];
}

export const fetchLatestAIAlerts = async (refresh: boolean = false): Promise<AIAlertsBundleResponse | null> => {
  try {
    const res = await fetch(`${API_BASE}/api/alerts/latest?refresh=${refresh}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[AI Alerts API] Lỗi đọc cảnh báo từ Backend:', err);
  }
  return null;
};

export const triggerAnalyzeAIAlerts = async (): Promise<AIAlertsBundleResponse> => {
  const res = await fetch(`${API_BASE}/api/alerts/analyze`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Lỗi phân tích cảnh báo từ Gemini (HTTP ${res.status})`);
  }
  return await res.json();
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
