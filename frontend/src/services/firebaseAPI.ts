// Firebase API (Controls & Config) + Backend Sensor API
import { db } from '../config/firebaseConfig';
import { ref, get, set, onValue, update, remove, query, orderByKey, limitToLast, type Unsubscribe } from 'firebase/database';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const USE_LOCAL_SOIL_DATA = true;

// Types matching sensor data structure
export interface FirebaseSensorReading {
  EC: number;
  K: number;
  N: number;
  P: number;
  humidity: number;
  moisture: number;
  pH: number;
  soiltemp: number;
  temperature: number;
}

export interface FirebaseSensorData {
  [date: string]: {
    [time: string]: FirebaseSensorReading;
  };
}

export interface FirebaseControlData {
  irrigationMode: 'auto' | 'schedule' | 'manual';
  pump: boolean;
  light: boolean;
  schedule?: {
    pump?: { startTime: string; endTime: string };
    light?: { startTime: string; endTime: string };
  };
}

// Alert levels: 0 = info, 1 = warning, 2 = urgent
export type AlertLevel = 0 | 1 | 2;

export interface FirebaseAlertRaw {
  action: string;
  active: boolean;
  level: AlertLevel;
  message: string;
  time: string;
  acknowledged?: boolean;
  acknowledgedAt?: string;
  dismissed?: boolean;
  dismissedAt?: string;
}

export interface FirebaseAlertData {
  id: string;
  action: string;
  active: boolean;
  level: AlertLevel;
  message: string;
  time: string;
  acknowledged?: boolean;
  acknowledgedAt?: string;
  dismissed?: boolean;
  dismissedAt?: string;
}

export interface FirebasePlantInfo {
  type: string;
  daysPlanted: number;
  growthStage: string;
  status: 'stable' | 'nutrient-deficient' | 'over-watered' | 'under-watered' | 'disease';
}

export interface FirebaseSettings {
  plantType: string;
  daysPlanted: number;
  thresholds: {
    [sensorType: string]: { min: number; max: number; warningLow: number; warningHigh: number };
  };
}

export interface FirebaseRecommendations {
  fertilizerSchedule: Array<{
    date: string;
    optimalTime: string;
    amountN: number;
    typeN: string;
    amountP: number;
    typeP: string;
    amountK: number;
    typeK: string;
  }>;
  soilCareTips: string[];
}

export interface StreamingThreshold {
  high: number;
  low: number;
}

export interface StreamingControlDevice {
  status: boolean | number;
  daily_time?: number;
  last_on_time?: string;
}

export interface LightScheduleSlot {
  on: number;
  off: number;
}

export interface StreamingConfig {
  config: {
    irrigation_mode: number;
    irrigation_time: {
      time1: number;
      time2: number;
      [key: string]: number;
    };
    light_mode: number | string;
    light_time?: {
      on: number | string;
      off: number | string;
    };
    plant: {
      age_days: number;
      growth_stage: string;
      type: string;
    };
    threshold: {
      nitrogen: StreamingThreshold;
      phosphorus: StreamingThreshold;
      potassium: StreamingThreshold;
      soil_ec: StreamingThreshold;
      soil_moisture: StreamingThreshold;
      soil_ph: StreamingThreshold;
      soil_temperature: StreamingThreshold;
    };
  };
  control: {
    light: StreamingControlDevice;
    pump: StreamingControlDevice;
  };
}

// ==================== BACKEND PROCESSED SENSOR API ====================
// Frontend gọi trực tiếp dữ liệu cảm biến đã được xử lý làm sạch từ Backend

export interface BackendPipelineInfo {
  imputation_method: string;
  outlier_cap: string | null;
  smoothing_1h: boolean;
  total_rows: number;
  total_days: number;
  first_date: string;
  last_date: string;
  missing_cells_imputed: number;
  missing_by_feature: Record<string, number>;
  remaining_missing: number;
}

export interface BackendStageAverageItem {
  stageNumber: number;
  minDays: number;
  maxDays: number;
  startDate: string;
  endDate: string;
  daysRecorded: number;
  sampleCount: number;
  averageReading: FirebaseSensorReading;
}

export interface BackendStagesSummaryResponse {
  latest: {
    date: string;
    time: string;
    timestamp: string;
    reading: FirebaseSensorReading;
  };
  summary: {
    totalDays: number;
    totalSamples: number;
    firstDate: string;
    lastDate: string;
    missingCellsImputed: number;
    missingByFeature: Record<string, number>;
    imputationMethod: string;
    overallAverage: FirebaseSensorReading;
    latestReading: FirebaseSensorReading;
  };
  stage_averages: BackendStageAverageItem[];
  pipeline_info: BackendPipelineInfo;
}

let cachedSoilData: FirebaseSensorData | null = null;
let cachedLocalSoilData: FirebaseSensorData | null = null;
let cachedStagesSummary: BackendStagesSummaryResponse | null = null;
let loadPromise: Promise<FirebaseSensorData | null> | null = null;
let localLoadPromise: Promise<FirebaseSensorData | null> | null = null;

// Đọc nhanh mẫu cảm biến mới nhất trực tiếp từ Firebase RTDB (chỉ lấy 1 ngày cuối ~30KB, mất ~150ms)
export const fetchLatestFirebaseReadingFast = async (): Promise<{
  reading: FirebaseSensorReading;
  date: string;
  time: string;
  timestamp: string;
} | null> => {
  try {
    const latestDayQuery = query(ref(db, 'data'), orderByKey(), limitToLast(1));
    const snapshot = await get(latestDayQuery);
    if (snapshot.exists()) {
      const val = snapshot.val() as FirebaseSensorData;
      const dates = Object.keys(val).sort().reverse();
      if (dates.length > 0) {
        const latestDate = dates[0];
        const times = Object.keys(val[latestDate] || {}).sort().reverse();
        if (times.length > 0) {
          const latestTime = times[0];
          return {
            reading: val[latestDate][latestTime],
            date: latestDate,
            time: latestTime,
            timestamp: `${latestDate} ${latestTime}`,
          };
        }
      }
    }
  } catch (err) {
    console.warn('[SensorAPI] Lỗi đọc nhanh mẫu mới nhất từ Firebase:', err);
  }
  return null;
};

// Tải nhanh /soil_all.json từ CDN kết hợp 2 ngày mới nhất từ Firebase RTDB để tránh chờ Cold Start của Backend
export const loadLocalSoilData = async (): Promise<FirebaseSensorData | null> => {
  if (cachedSoilData) return cachedSoilData;
  if (cachedLocalSoilData) return cachedLocalSoilData;
  if (localLoadPromise) return localLoadPromise;

  localLoadPromise = (async () => {
    try {
      const [localRes, recentSnap] = await Promise.all([
        fetch('/soil_all.json').catch(() => null),
        get(query(ref(db, 'data'), orderByKey(), limitToLast(2))).catch(() => null),
      ]);

      let merged: FirebaseSensorData = {};
      if (localRes && localRes.ok) {
        const json = await localRes.json();
        merged = ((json && json.data) ? json.data : json) as FirebaseSensorData;
      }

      if (recentSnap && recentSnap.exists()) {
        const recentData = recentSnap.val() as FirebaseSensorData;
        for (const [day, readings] of Object.entries(recentData)) {
          merged[day] = { ...(merged[day] || {}), ...readings };
        }
      }

      if (Object.keys(merged).length > 0) {
        cachedLocalSoilData = merged;
        return merged;
      }
    } catch (err) {
      console.warn('[SensorAPI] Không thể tải /soil_all.json dự phòng:', err);
    } finally {
      localLoadPromise = null;
    }
    return null;
  })();

  return localLoadPromise;
};

// Gọi Backend API (/api/sensors/data) để lấy dữ liệu cảm biến đã xử lý
export const loadProcessedSensorDataFromBackend = async (
  method: string = 'ffill'
): Promise<FirebaseSensorData | null> => {
  if (cachedSoilData) return cachedSoilData;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sensors/data?method=${encodeURIComponent(method)}`);
      if (res.ok) {
        const json = await res.json();
        cachedSoilData = (json.data || json) as FirebaseSensorData;
        if (json.summary && json.stage_averages && json.pipeline_info) {
          cachedStagesSummary = {
            latest: json.latest,
            summary: json.summary,
            stage_averages: json.stage_averages,
            pipeline_info: json.pipeline_info,
          };
        }
        return cachedSoilData;
      } else {
        console.warn(`[SensorAPI] Backend /api/sensors/data trả về HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn('[SensorAPI] Không thể kết nối Backend /api/sensors/data:', err);
    } finally {
      loadPromise = null;
    }
    return null;
  })();

  return loadPromise;
};

// Gọi Backend API (/api/sensors/stages-summary) để lấy kết quả chuẩn hóa 6 giai đoạn & thông tin điền khuyết
export const fetchProcessedStagesSummary = async (
  method: string = 'ffill'
): Promise<BackendStagesSummaryResponse | null> => {
  if (cachedStagesSummary && cachedStagesSummary.pipeline_info.imputation_method === method) {
    return cachedStagesSummary;
  }
  try {
    const res = await fetch(`${API_BASE}/api/sensors/stages-summary?method=${encodeURIComponent(method)}`);
    if (res.ok) {
      const data = (await res.json()) as BackendStagesSummaryResponse;
      cachedStagesSummary = data;
      return data;
    }
  } catch (err) {
    console.warn('[SensorAPI] Lỗi gọi /api/sensors/stages-summary từ Backend:', err);
  }
  return cachedStagesSummary;
};

export const getSensorData = async (): Promise<FirebaseSensorData> => {
  if (cachedSoilData) return cachedSoilData;

  // Đua giữa Backend và bản dữ liệu nhanh (/soil_all.json + Firebase ngày mới nhất) nếu Backend đang Cold Start
  const fastTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
  const quickBackend = await Promise.race([loadProcessedSensorDataFromBackend('ffill'), fastTimeout]);
  if (quickBackend) return quickBackend;

  const localData = await loadLocalSoilData();
  if (localData) return localData;

  const backendData = await loadProcessedSensorDataFromBackend('ffill');
  if (backendData) return backendData;

  throw new Error('Không thể tải dữ liệu cảm biến từ Backend hoặc /soil_all.json');
};

// Lấy mẫu cảm biến mới nhất đã làm sạch từ Backend API (/api/sensors/latest)
export const getLatestSensorReading = async (): Promise<{
  reading: FirebaseSensorReading;
  timestamp: string;
} | null> => {
  try {
    const res = await fetch(`${API_BASE}/api/sensors/latest`);
    if (res.ok) {
      const json = await res.json();
      if (json && json.reading) {
        return {
          reading: json.reading as FirebaseSensorReading,
          timestamp: json.timestamp || `${json.date} ${json.time}`,
        };
      }
    }
  } catch (err) {
    console.warn('[SensorAPI] Lỗi gọi /api/sensors/latest, chuyển sang đọc từ bộ nhớ đệm:', err);
  }

  const fastLatest = await fetchLatestFirebaseReadingFast();
  if (fastLatest) {
    return {
      reading: fastLatest.reading,
      timestamp: fastLatest.timestamp,
    };
  }

  const data = await getSensorData();
  const dates = Object.keys(data).sort().reverse();
  if (dates.length === 0) return null;

  const latestDate = dates[0];
  const times = Object.keys(data[latestDate]).sort().reverse();
  if (times.length === 0) return null;

  const latestTime = times[0];
  return {
    reading: data[latestDate][latestTime],
    timestamp: `${latestDate} ${latestTime}`,
  };
};

// Đăng ký nhận dữ liệu cảm biến: hiển thị tức thời từ /soil_all.json + Firebase, sau đó cập nhật bản làm sạch từ Backend
export const subscribeSensorData = (callback: (data: FirebaseSensorData) => void) => {
  let isCancelled = false;
  let backendResolved = false;

  // 1. Tải song song dữ liệu nhanh từ CDN (/soil_all.json + 2 ngày mới nhất trên Firebase) để hiển thị trong < 1 giây
  loadLocalSoilData().then((localData) => {
    if (localData && !isCancelled && !backendResolved) {
      callback(localData);
    }
  });

  // 2. Khi Backend hoàn tất làm sạch (ffill), cập nhật lại dữ liệu chuẩn hóa
  loadProcessedSensorDataFromBackend('ffill').then((backendData) => {
    if (backendData && !isCancelled) {
      backendResolved = true;
      callback(backendData);
    }
  });

  return () => {
    isCancelled = true;
  };
};

// ==================== CONTROL API ====================
export const getControlData = async (): Promise<FirebaseControlData> => {
  const controlRef = ref(db, 'controls');
  const snapshot = await get(controlRef);
  if (snapshot.exists()) {
    return snapshot.val();
  }
  return {
    irrigationMode: 'auto',
    pump: false,
    light: false,
  };
};

export const updateControlData = async (data: Partial<FirebaseControlData>): Promise<void> => {
  const controlRef = ref(db, 'controls');
  const currentData = await getControlData();
  await set(controlRef, { ...currentData, ...data });
};

export const setIrrigationMode = async (mode: 'auto' | 'schedule' | 'manual'): Promise<void> => {
  await updateControlData({ irrigationMode: mode });
};

export const togglePump = async (state: boolean): Promise<void> => {
  await updateControlData({ pump: state });
};

export const toggleLight = async (state: boolean): Promise<void> => {
  await updateControlData({ light: state });
};

export const subscribeControlData = (callback: (data: FirebaseControlData) => void) => {
  const controlRef = ref(db, 'controls');
  return onValue(controlRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.val());
    }
  });
};

// ==================== ALERTS API ====================
export const getAlerts = async (): Promise<FirebaseAlertData[]> => {
  const alertsRef = ref(db, 'notifications');
  const snapshot = await get(alertsRef);
  if (snapshot.exists()) {
    const data = snapshot.val() as { [key: string]: FirebaseAlertRaw };
    return Object.entries(data).map(([key, value]) => ({
      id: key,
      ...value,
    }));
  }
  return [];
};

export const subscribeAlerts = (callback: (data: FirebaseAlertData[]) => void) => {
  const alertsRef = ref(db, 'notifications');
  return onValue(alertsRef, (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.val() as { [key: string]: FirebaseAlertRaw };
      const alerts = Object.entries(data).map(([key, value]) => ({
        id: key,
        ...value,
      }));
      callback(alerts);
    } else {
      callback([]);
    }
  });
};

export const updateAlert = async (id: string, data: Partial<FirebaseAlertData>): Promise<void> => {
  try {
    const alertRef = ref(db, `notifications/${id}`);
    await update(alertRef, data);
  } catch (error) {
    console.warn(`[Firebase] Không thể cập nhật cảnh báo ${id}:`, error);
  }
};

export const acknowledgeAlert = async (id: string): Promise<void> => {
  const now = new Date();
  const timeStr = `${now.toLocaleDateString('vi-VN')} ${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
  await updateAlert(id, {
    acknowledged: true,
    acknowledgedAt: timeStr,
  });
};

export const unacknowledgeAlert = async (id: string): Promise<void> => {
  await updateAlert(id, {
    acknowledged: false,
    acknowledgedAt: '',
  });
};

export const dismissAlert = async (id: string): Promise<void> => {
  const now = new Date();
  const timeStr = `${now.toLocaleDateString('vi-VN')} ${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
  await updateAlert(id, {
    active: false,
    dismissed: true,
    dismissedAt: timeStr,
  });
};

export const reactivateAlert = async (id: string): Promise<void> => {
  await updateAlert(id, {
    active: true,
    dismissed: false,
  });
};

export const deleteAlert = async (id: string): Promise<void> => {
  try {
    const alertRef = ref(db, `notifications/${id}`);
    await remove(alertRef);
  } catch (error) {
    console.warn(`[Firebase] Không thể xóa cảnh báo ${id}:`, error);
  }
};

// ==================== PLANT INFO API ====================
export const getPlantInfo = async (): Promise<FirebasePlantInfo> => {
  const plantRef = ref(db, 'plantInfo');
  const snapshot = await get(plantRef);
  if (snapshot.exists()) {
    return snapshot.val();
  }
  return {
    type: 'Cây ớt',
    daysPlanted: 0,
    growthStage: 'Cây con & bén rễ',
    status: 'stable',
  };
};

export const updatePlantInfo = async (data: Partial<FirebasePlantInfo>): Promise<void> => {
  const plantRef = ref(db, 'plantInfo');
  const currentData = await getPlantInfo();
  await set(plantRef, { ...currentData, ...data });
};

export const resetPlantSystem = async (): Promise<void> => {
  await updatePlantInfo({
    daysPlanted: 0,
    growthStage: 'Nảy mầm',
    status: 'stable',
  });
};

// ==================== SETTINGS API ====================
export const getSettings = async (): Promise<FirebaseSettings> => {
  const settingsRef = ref(db, 'settings');
  const snapshot = await get(settingsRef);
  if (snapshot.exists()) {
    return snapshot.val();
  }
  return {
    plantType: 'Cây ớt',
    daysPlanted: 0,
    thresholds: {},
  };
};

export const updateSettings = async (data: Partial<FirebaseSettings>): Promise<void> => {
  const settingsRef = ref(db, 'settings');
  const currentData = await getSettings();
  await set(settingsRef, { ...currentData, ...data });
};

export const getWarningThresholds = async () => {
  const settings = await getSettings();
  return settings.thresholds;
};

export const updateWarningThresholds = async (thresholds: FirebaseSettings['thresholds']): Promise<void> => {
  await updateSettings({ thresholds });
};

// ==================== RECOMMENDATIONS API ====================
export const getRecommendations = async (): Promise<FirebaseRecommendations> => {
  const recRef = ref(db, 'recommendations');
  const snapshot = await get(recRef);
  if (snapshot.exists()) {
    return snapshot.val();
  }
  return {
    fertilizerSchedule: [],
    soilCareTips: [],
  };
};

export const updateRecommendations = async (data: Partial<FirebaseRecommendations>): Promise<void> => {
  const recRef = ref(db, 'recommendations');
  const currentData = await getRecommendations();
  await set(recRef, { ...currentData, ...data });
};

// ==================== STREAMING CONFIG API ====================
export const getStreamingConfig = async (): Promise<StreamingConfig | null> => {
  const streamingRef = ref(db, 'streaming');
  const snapshot = await get(streamingRef);
  if (snapshot.exists()) {
    return snapshot.val();
  }
  return null;
};

export const defaultStreamingConfig: StreamingConfig = {
  config: {
    irrigation_mode: 1,
    irrigation_time: { time1: 6, time2: 17 },
    light_mode: 1,
    light_time: { on: 6, off: 18 },
    plant: {
      age_days: 45,
      growth_stage: 'Ra hoa & tạo quả',
      type: 'chili',
    },
    threshold: {
      nitrogen: { low: 30, high: 500 },
      phosphorus: { low: 20, high: 1200 },
      potassium: { low: 40, high: 1200 },
      soil_ec: { low: 1.0, high: 2.5 },
      soil_moisture: { low: 40, high: 80 },
      soil_ph: { low: 5.5, high: 7.0 },
      soil_temperature: { low: 18, high: 30 },
    },
  },
  control: {
    light: { status: false, daily_time: 0, last_on_time: '' },
    pump: { status: false, daily_time: 0, last_on_time: '' },
  },
};

export const subscribeStreamingConfig = (callback: (data: StreamingConfig | null) => void) => {
  const streamingRef = ref(db, 'streaming');
  return onValue(
    streamingRef,
    (snapshot) => {
      if (snapshot.exists()) {
        callback(snapshot.val());
      } else {
        callback(defaultStreamingConfig);
      }
    },
    (error) => {
      console.warn('[Firebase] Lỗi đọc streaming config, dùng cấu hình mặc định:', error);
      callback(defaultStreamingConfig);
    }
  );
};

// ==================== STREAMING CONTROL API ====================

export const setStreamingIrrigationMode = async (mode: number): Promise<void> => {
  const modeRef = ref(db, 'streaming/config/irrigation_mode');
  await set(modeRef, mode);
};

export const setStreamingLightMode = async (mode: number): Promise<void> => {
  const modeRef = ref(db, 'streaming/config/light_mode');
  await set(modeRef, mode);
};

export const setStreamingControlStatus = async (device: 'pump' | 'light', status: boolean): Promise<void> => {
  const statusRef = ref(db, `streaming/control/${device}/status`);
  await set(statusRef, status);
};

export const setStreamingIrrigationTime = async (times: { time1?: number; time2?: number }): Promise<void> => {
  if (times.time1 !== undefined) {
    const time1Ref = ref(db, 'streaming/config/irrigation_time/time1');
    await set(time1Ref, times.time1);
  }
  if (times.time2 !== undefined) {
    const time2Ref = ref(db, 'streaming/config/irrigation_time/time2');
    await set(time2Ref, times.time2);
  }
};

export const setStreamingLightTime = async (on: number, off: number): Promise<void> => {
  const timeRef = ref(db, 'streaming/config/light_time/on');
  await set(timeRef, on);

  const timeRef2 = ref(db, 'streaming/config/light_time/off');
  await set(timeRef2, off);
};

export const getControlDeviceStatus = (device: StreamingControlDevice | number | boolean): { status: boolean; daily_time: number; last_on_time: string } => {
  if (typeof device === 'number') {
    return { status: device === 1, daily_time: 0, last_on_time: '' };
  }
  if (typeof device === 'boolean') {
    return { status: device, daily_time: 0, last_on_time: '' };
  }
  return {
    status: device.status === true || device.status === 1,
    daily_time: device.daily_time ?? 0,
    last_on_time: device.last_on_time ?? '',
  };
};

export const updateStreamingThreshold = async (thresholds: StreamingConfig['config']['threshold']): Promise<void> => {
  const sensorKeys = Object.keys(thresholds) as Array<keyof typeof thresholds>;
  
  for (const sensorKey of sensorKeys) {
    const threshold = thresholds[sensorKey];
    if (threshold) {
      const lowRef = ref(db, `streaming/config/threshold/${sensorKey}/low`);
      await set(lowRef, threshold.low);
      
      const highRef = ref(db, `streaming/config/threshold/${sensorKey}/high`);
      await set(highRef, threshold.high);
    }
  }
};

export const DEFAULT_SAMPLING_INTERVAL_SEC = 300;
export const MIN_SAMPLING_INTERVAL_SEC = 5;
export const MAX_SAMPLING_INTERVAL_SEC = 86400;
export const DEFAULT_IRRIGATION_DURATION_MIN = 5;
export const MIN_IRRIGATION_DURATION_MIN = 1;
export const MAX_IRRIGATION_DURATION_MIN = 120;

/** Lắng nghe 1 trường trong streaming/config (null nếu chưa có / lỗi đọc). */
export const subscribeStreamingConfigField = (
  field: 'sampling_interval_sec' | 'irrigation_duration_min',
  callback: (value: number | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe =>
  onValue(
    ref(db, `streaming/config/${field}`),
    (snapshot) => {
      const v = snapshot.val();
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
      callback(Number.isFinite(n) ? n : null);
    },
    (error) => {
      console.warn(`[Firebase] Lỗi đọc streaming/config/${field}:`, error);
      callback(null);
      onError?.(error);
    },
  );

/** Ghi chu kỳ lấy mẫu cảm biến (giây, số nguyên 5..86400) – Jetson đọc lại mỗi 15 s. */
export const setSamplingIntervalSec = async (seconds: number): Promise<void> => {
  if (!Number.isInteger(seconds) || seconds < MIN_SAMPLING_INTERVAL_SEC || seconds > MAX_SAMPLING_INTERVAL_SEC) {
    throw new RangeError(
      `Chu kỳ lấy mẫu phải là số nguyên từ ${MIN_SAMPLING_INTERVAL_SEC} đến ${MAX_SAMPLING_INTERVAL_SEC} giây`,
    );
  }
  await set(ref(db, 'streaming/config/sampling_interval_sec'), seconds);
};

/** Ghi thời lượng mỗi lần tưới theo lịch (phút, số nguyên 1..120). */
export const setIrrigationDurationMin = async (minutes: number): Promise<void> => {
  if (!Number.isInteger(minutes) || minutes < MIN_IRRIGATION_DURATION_MIN || minutes > MAX_IRRIGATION_DURATION_MIN) {
    throw new RangeError(
      `Thời lượng tưới phải là số nguyên từ ${MIN_IRRIGATION_DURATION_MIN} đến ${MAX_IRRIGATION_DURATION_MIN} phút`,
    );
  }
  await set(ref(db, 'streaming/config/irrigation_duration_min'), minutes);
};

