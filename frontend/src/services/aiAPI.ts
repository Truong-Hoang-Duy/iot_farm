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
  light?: number;
}

export interface AdvisorRequest {
  plant_type?: string;
  age_days?: number;
  growth_stage?: string;
  sensor_reading: SensorReadingInput;
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
  soil_health_score: number;
  summary: string;
  fertilizer_plan: FertilizerPlanItem[];
  watering_advice: string;
  pest_disease_warnings: string[];
  soil_improvement_tips: string[];
  ai_model_used: string;
  timestamp: string;
}

export interface ChatMessageItem {
  role: 'user' | 'model';
  content: string;
}

// Kiểm tra tình trạng backend AI
export const checkAIHealth = async (): Promise<{ status: string; gemini_configured: boolean; gemini_model: string } | null> => {
  try {
    const res = await fetch('/api/recommendations/health');
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[AI API] Backend chưa khởi động:', err);
  }
  return null;
};

// Gọi sinh đề xuất từ AI Advisor
export const fetchAIAdvisor = async (payload: AdvisorRequest): Promise<AdvisorResponse> => {
  const res = await fetch('/api/recommendations/ai-advisor', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      plant_type: payload.plant_type || 'Cây ớt',
      age_days: payload.age_days || 45,
      growth_stage: payload.growth_stage || 'Ra hoa & tạo quả',
      sensor_reading: payload.sensor_reading,
      custom_notes: payload.custom_notes || '',
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
  const res = await fetch('/api/recommendations/chat', {
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

// Lấy bản ghi khuyến nghị mới nhất đã được lưu trong Cache/Firebase (0s load time)
export const fetchLatestCachedAdvisor = async (): Promise<AdvisorResponse | null> => {
  try {
    const res = await fetch('/api/recommendations/latest');
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[IoT Farm API] Không thể lấy cache khuyến nghị:', err);
  }
  return null;
};

