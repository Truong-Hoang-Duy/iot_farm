// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// Types
export interface PlantInfo {
  type: string;
  daysPlanted: number;
  growthStage: string;
  status: 'stable' | 'nutrient-deficient' | 'over-watered' | 'under-watered' | 'disease';
}

export interface SensorData {
  soilTemperature: number;
  soilMoisture: number;
  ph: number;
  ec: number;
  nitrogen: number;
  phosphorus: number;
  potassium: number;
  timestamp: string;
}

export interface Alert {
  id: string;
  type: 'warning' | 'danger' | 'info';
  title: string;
  message: string;
  timestamp: string;
  isRead: boolean;
}

export interface ControlStatus {
  pump: boolean;
  light: boolean;
}

export interface FertilizerRecommendation {
  month: number;
  nitrogen: number;
  phosphorus: number;
  potassium: number;
  notes: string;
}

export interface Settings {
  plantType: string;
  daysPlanted: number;
  irrigationMode: 'auto' | 'schedule' | 'manual';
  thresholds: {
    soilTemperature: { min: number; max: number };
    soilMoisture: { min: number; max: number };
    ph: { min: number; max: number };
    ec: { min: number; max: number };
    nitrogen: { min: number; max: number };
    phosphorus: { min: number; max: number };
    potassium: { min: number; max: number };
  };
}

// API Functions
async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`);
  }

  return response.json();
}

// Warning Threshold type
export interface WarningThreshold {
  id: string;
  sensorType: string;
  min: number;
  max: number;
  warningLow: number;
  warningHigh: number;
}

// Dashboard Stats
export interface DashboardStats {
  systemStatus: string;
  irrigationMode: string;
  waterUsageToday: string;
  newAlerts: number;
}

// Plant Info
export const plantAPI = {
  getInfo: async (): Promise<PlantInfo> => {
    console.log('[API] GET /plant - Fetching plant info');
    // In production, replace with: return fetchAPI<PlantInfo>('/plant');
    return mockData.plantInfo;
  },
  
  updateInfo: async (data: Partial<PlantInfo>): Promise<PlantInfo> => {
    console.log('[API] PUT /plant - Updating plant info:', data);
    // In production, replace with: return fetchAPI<PlantInfo>('/plant', { method: 'PUT', body: JSON.stringify(data) });
    return { ...mockData.plantInfo, ...data };
  },
  
  resetSystem: async (): Promise<{ success: boolean }> => {
    console.log('[API] POST /plant/reset - Resetting system');
    // In production, replace with: return fetchAPI<{ success: boolean }>('/plant/reset', { method: 'POST' });
    await new Promise(resolve => setTimeout(resolve, 2000));
    return { success: true };
  },
};

// Sensor Data
export const sensorAPI = {
  getCurrent: async (): Promise<SensorData> => {
    console.log('[API] GET /sensors/current - Fetching current sensor data');
    // In production, replace with: return fetchAPI<SensorData>('/sensors/current');
    return mockData.sensorData;
  },
  
  getHistory: async (hours: number = 24): Promise<SensorData[]> => {
    console.log(`[API] GET /sensors/history?hours=${hours} - Fetching sensor history`);
    // In production, replace with: return fetchAPI<SensorData[]>(`/sensors/history?hours=${hours}`);
    // Generate mock history data
    const history: SensorData[] = [];
    const now = new Date();
    for (let i = hours; i >= 0; i--) {
      const timestamp = new Date(now.getTime() - i * 3600000);
      history.push({
        ...mockData.sensorData,
        soilTemperature: mockData.sensorData.soilTemperature + (Math.random() - 0.5) * 5,
        soilMoisture: mockData.sensorData.soilMoisture + (Math.random() - 0.5) * 10,
        ph: mockData.sensorData.ph + (Math.random() - 0.5) * 0.5,
        ec: mockData.sensorData.ec + (Math.random() - 0.5) * 0.3,
        timestamp: timestamp.toISOString(),
      });
    }
    return history;
  },
};

// Alerts
export const alertAPI = {
  getAll: async (): Promise<Alert[]> => {
    console.log('[API] GET /alerts - Fetching all alerts');
    // In production, replace with: return fetchAPI<Alert[]>('/alerts');
    return mockData.alerts;
  },
  
  markAsRead: async (id: string): Promise<Alert> => {
    console.log(`[API] PUT /alerts/${id}/read - Marking alert as read`);
    // In production, replace with: return fetchAPI<Alert>(`/alerts/${id}/read`, { method: 'PUT' });
    const alert = mockData.alerts.find(a => a.id === id);
    return { ...alert!, isRead: true };
  },
  
  markAllAsRead: async (): Promise<{ success: boolean }> => {
    console.log('[API] PUT /alerts/read-all - Marking all alerts as read');
    // In production, replace with: return fetchAPI<{ success: boolean }>('/alerts/read-all', { method: 'PUT' });
    return { success: true };
  },
  
  clearAll: async (): Promise<{ success: boolean }> => {
    console.log('[API] DELETE /alerts/clear - Clearing all alerts');
    // In production, replace with: return fetchAPI<{ success: boolean }>('/alerts/clear', { method: 'DELETE' });
    return { success: true };
  },
  
  delete: async (id: string): Promise<{ success: boolean }> => {
    console.log(`[API] DELETE /alerts/${id} - Deleting alert`);
    // In production, replace with: return fetchAPI<{ success: boolean }>(`/alerts/${id}`, { method: 'DELETE' });
    return { success: true };
  },
};

// Controls
export const controlAPI = {
  getStatus: async (): Promise<ControlStatus> => {
    console.log('[API] GET /controls - Fetching control status');
    // In production, replace with: return fetchAPI<ControlStatus>('/controls');
    return mockData.controlStatus;
  },
  
  togglePump: async (state: boolean): Promise<ControlStatus> => {
    console.log(`[API] PUT /controls/pump - Setting pump to: ${state}`);
    // In production, replace with: return fetchAPI<ControlStatus>('/controls/pump', { method: 'PUT', body: JSON.stringify({ state }) });
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { ...mockData.controlStatus, pump: state };
  },
  
  toggleLight: async (state: boolean): Promise<ControlStatus> => {
    console.log(`[API] PUT /controls/light - Setting light to: ${state}`);
    // In production, replace with: return fetchAPI<ControlStatus>('/controls/light', { method: 'PUT', body: JSON.stringify({ state }) });
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { ...mockData.controlStatus, light: state };
  },
  
  scheduleDevice: async (device: 'pump' | 'light', schedule: { startTime: string; endTime: string }): Promise<{ success: boolean }> => {
    console.log(`[API] POST /controls/${device}/schedule - Scheduling device:`, schedule);
    // In production, replace with actual API call
    return { success: true };
  },
  
};

// Recommendations
export const recommendationAPI = {
  getFertilizer: async (): Promise<FertilizerRecommendation[]> => {
    console.log('[API] GET /recommendations/fertilizer - Fetching fertilizer recommendations');
    // In production, replace with: return fetchAPI<FertilizerRecommendation[]>('/recommendations/fertilizer');
    return mockData.fertilizerSchedule;
  },
  
  getSoilCare: async (): Promise<string[]> => {
    console.log('[API] GET /recommendations/soil-care - Fetching soil care tips');
    // In production, replace with: return fetchAPI<string[]>('/recommendations/soil-care');
    return [
      'Cải thiện cấu trúc đất',
      'Cân bằng pH',
      'Tăng vi sinh vật có lợi',
      'Giữ ẩm đất',
    ];
  },
  
  getDetailedSchedule: async (months: number = 6): Promise<FertilizerRecommendation[]> => {
    console.log(`[API] GET /recommendations/schedule?months=${months} - Fetching detailed schedule`);
    // In production, replace with actual API call
    return mockData.fertilizerSchedule;
  },
};

// Settings
export const settingsAPI = {
  get: async (): Promise<Settings> => {
    console.log('[API] GET /settings - Fetching settings');
    // In production, replace with: return fetchAPI<Settings>('/settings');
    return mockData.settings;
  },
  
  update: async (settings: Partial<Settings>): Promise<Settings> => {
    console.log('[API] PUT /settings - Updating settings:', settings);
    // In production, replace with: return fetchAPI<Settings>('/settings', { method: 'PUT', body: JSON.stringify(settings) });
    await new Promise(resolve => setTimeout(resolve, 1500));
    return { ...mockData.settings, ...settings };
  },
  
  getWarningThresholds: async (): Promise<WarningThreshold[]> => {
    console.log('[API] GET /settings/thresholds - Fetching warning thresholds');
    // In production, replace with actual API call
    return [
      { id: '1', sensorType: 'Air Temperature', min: 0, max: 100, warningLow: 20, warningHigh: 80 },
      { id: '2', sensorType: 'Soil pH', min: 0, max: 100, warningLow: 20, warningHigh: 80 },
      { id: '3', sensorType: 'Nitrogen', min: 0, max: 100, warningLow: 20, warningHigh: 80 },
      { id: '4', sensorType: 'Potassium', min: 0, max: 100, warningLow: 20, warningHigh: 80 },
      { id: '5', sensorType: 'Wind Speed', min: 20, max: 80, warningLow: 20, warningHigh: 60 },
    ];
  },
  
  updateWarningThresholds: async (thresholds: WarningThreshold[]): Promise<{ success: boolean }> => {
    console.log('[API] PUT /settings/thresholds - Updating warning thresholds:', thresholds);
    // In production, replace with actual API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { success: true };
  },
};

// Dashboard API
export const dashboardAPI = {
  getStats: async (): Promise<DashboardStats> => {
    console.log('[API] GET /dashboard/stats - Fetching dashboard stats');
    // In production, replace with actual API call
    return {
      systemStatus: 'Hoạt động',
      irrigationMode: 'Tự động',
      waterUsageToday: '12.5L',
      newAlerts: 2,
    };
  },
  
  getSensorData: async (): Promise<SensorData> => {
    console.log('[API] GET /dashboard/sensors - Fetching dashboard sensor data');
    // In production, replace with: return fetchAPI<SensorData>('/dashboard/sensors');
    return mockData.sensorData;
  },
};

// Mock data for development
export const mockData = {
  plantInfo: {
    type: 'Cây ớt',
    daysPlanted: 45,
    growthStage: 'Ra hoa & phân hóa nụ',
    status: 'stable' as const,
  },
  sensorData: {
    soilTemperature: 25.5,
    soilMoisture: 68,
    ph: 6.5,
    ec: 1.8,
    nitrogen: 45,
    phosphorus: 30,
    potassium: 55,
    timestamp: new Date().toISOString(),
  },
  alerts: [
    {
      id: '1',
      type: 'warning' as const,
      title: 'Độ ẩm thấp',
      message: 'Độ ẩm đất đang ở mức 35%, cần tưới nước',
      timestamp: new Date().toISOString(),
      isRead: false,
    },
    {
      id: '2',
      type: 'info' as const,
      title: 'Lịch bón phân',
      message: 'Đến thời điểm bón phân NPK theo lịch',
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      isRead: true,
    },
  ],
  controlStatus: {
    pump: false,
    light: true,
  },
  fertilizerSchedule: [
    { month: 1, nitrogen: 50, phosphorus: 30, potassium: 40, notes: 'Giai đoạn nảy mầm' },
    { month: 2, nitrogen: 60, phosphorus: 40, potassium: 50, notes: 'Phát triển lá' },
    { month: 3, nitrogen: 40, phosphorus: 60, potassium: 60, notes: 'Chuẩn bị ra hoa' },
    { month: 4, nitrogen: 30, phosphorus: 50, potassium: 70, notes: 'Ra hoa' },
    { month: 5, nitrogen: 25, phosphorus: 40, potassium: 80, notes: 'Đậu trái' },
    { month: 6, nitrogen: 20, phosphorus: 30, potassium: 60, notes: 'Thu hoạch' },
  ],
  settings: {
    plantType: 'Cây ớt',
    daysPlanted: 45,
    irrigationMode: 'auto' as const,
    thresholds: {
      soilTemperature: { min: 18, max: 30 },
      soilMoisture: { min: 40, max: 80 },
      ph: { min: 5.5, max: 7.0 },
      ec: { min: 1.0, max: 2.5 },
      nitrogen: { min: 30, max: 80 },
      phosphorus: { min: 20, max: 60 },
      potassium: { min: 40, max: 90 },
    },
  },
};
