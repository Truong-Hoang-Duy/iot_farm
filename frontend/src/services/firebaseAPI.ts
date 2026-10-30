// Firebase API (Controls & Config) + Backend Sensor API (/api/sensors/*)
import { db } from '../config/firebaseConfig';
import { ref, get, set, onValue, update, remove, query, orderByKey, limitToLast, type Unsubscribe } from 'firebase/database';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

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
let cachedSoilDataAt = 0;
let cachedLocalSoilData: FirebaseSensorData | null = null;
let cachedStagesSummary: BackendStagesSummaryResponse | null = null;
let cachedStagesSummaryAt = 0;
let loadPromise: Promise<FirebaseSensorData | null> | null = null;
let localLoadPromise: Promise<FirebaseSensorData | null> | null = null;
const SENSOR_CACHE_TTL_MS = 15_000;

const FEATURE_KEYS: Array<keyof FirebaseSensorReading> = [
  'temperature',
  'humidity',
  'soiltemp',
  'moisture',
  'pH',
  'EC',
  'N',
  'P',
  'K',
];

function normalizeDayReadings(
  rawDay: Record<string, any> | undefined | null
): Record<string, FirebaseSensorReading> {
  const out: Record<string, FirebaseSensorReading> = {};
  if (!rawDay || typeof rawDay !== 'object') return out;
  for (const [clock, val] of Object.entries(rawDay)) {
    if (!val || typeof val !== 'object') continue;
    const normClock = clock.length >= 5 ? clock.slice(0, 5) : clock;
    out[normClock] = {
      EC: Number(val.EC ?? 0),
      K: Number(val.K ?? 0),
      N: Number(val.N ?? 0),
      P: Number(val.P ?? 0),
      humidity: Number(val.humidity ?? 0),
      moisture: Number(val.moisture ?? 0),
      pH: Number(val.pH ?? 0),
      soiltemp: Number(val.soiltemp ?? 0),
      temperature: Number(val.temperature ?? 0),
    };
  }
  return out;
}

function normalizeFullSensorDataset(raw: Record<string, any> | undefined | null): FirebaseSensorData {
  const out: FirebaseSensorData = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [day, rawDay] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const normDay = normalizeDayReadings(rawDay);
    if (Object.keys(normDay).length > 0) {
      out[day] = normDay;
    }
  }
  return out;
}

function averageReadingsList(readings: FirebaseSensorReading[]): FirebaseSensorReading {
  if (readings.length === 0) {
    return { EC: 0, K: 0, N: 0, P: 0, humidity: 0, moisture: 0, pH: 0, soiltemp: 0, temperature: 0 };
  }
  const sums: FirebaseSensorReading = {
    EC: 0, K: 0, N: 0, P: 0, humidity: 0, moisture: 0, pH: 0, soiltemp: 0, temperature: 0,
  };
  for (const r of readings) {
    for (const k of FEATURE_KEYS) {
      sums[k] += Number(r[k] ?? 0);
    }
  }
  const n = readings.length;
  return {
    EC: Number((sums.EC / n).toFixed(2)),
    K: Number((sums.K / n).toFixed(2)),
    N: Number((sums.N / n).toFixed(2)),
    P: Number((sums.P / n).toFixed(2)),
    humidity: Number((sums.humidity / n).toFixed(2)),
    moisture: Number((sums.moisture / n).toFixed(2)),
    pH: Number((sums.pH / n).toFixed(2)),
    soiltemp: Number((sums.soiltemp / n).toFixed(2)),
    temperature: Number((sums.temperature / n).toFixed(2)),
  };
}

export function buildClientStagesSummary(
  data: FirebaseSensorData,
  method: string = 'ffill'
): BackendStagesSummaryResponse | null {
  const sortedDates = Object.keys(data).sort();
  if (sortedDates.length === 0) return null;

  const firstDate = sortedDates[0];
  const lastDate = sortedDates[sortedDates.length - 1];
  const lastTimes = Object.keys(data[lastDate] || {}).sort();
  const latestTime = lastTimes[lastTimes.length - 1] || '00:00';
  const latestReading = data[lastDate]?.[latestTime] || {
    EC: 0, K: 0, N: 0, P: 0, humidity: 0, moisture: 0, pH: 0, soiltemp: 0, temperature: 0,
  };

  const allReadings: FirebaseSensorReading[] = [];
  for (const d of sortedDates) {
    const dayMap = data[d] || {};
    for (const t of Object.keys(dayMap)) {
      allReadings.push(dayMap[t]);
    }
  }

  const overallAverage = averageReadingsList(allReadings);
  const stageWindows: Array<[number, number]> = [
    [0, 24],
    [25, 54],
    [55, 89],
    [90, 134],
    [135, 219],
    [220, Math.max(220, sortedDates.length - 1)],
  ];

  const stageAverages: BackendStageAverageItem[] = stageWindows.map(([sDay, eDay], idx) => {
    const sIdx = Math.min(sortedDates.length - 1, Math.max(0, sDay));
    const eIdx = Math.min(sortedDates.length - 1, Math.max(sIdx, eDay));
    const stageReadings: FirebaseSensorReading[] = [];
    for (let i = sIdx; i <= eIdx; i++) {
      const d = sortedDates[i];
      const dayMap = data[d] || {};
      for (const r of Object.values(dayMap)) {
        stageReadings.push(r);
      }
    }
    return {
      stageNumber: idx + 1,
      minDays: sIdx + 1,
      maxDays: eIdx + 1,
      startDate: sortedDates[sIdx],
      endDate: sortedDates[eIdx],
      daysRecorded: eIdx - sIdx + 1,
      sampleCount: stageReadings.length,
      averageReading: averageReadingsList(stageReadings),
    };
  });

  const expectedSlots = sortedDates.length * 288;
  const missingSlots = Math.max(0, expectedSlots - allReadings.length);
  const missingCellsImputed = missingSlots * FEATURE_KEYS.length;
  const missingByFeature: Record<string, number> = {};
  for (const k of FEATURE_KEYS) {
    missingByFeature[k] = missingSlots;
  }

  return {
    latest: {
      date: lastDate,
      time: latestTime,
      timestamp: `${lastDate} ${latestTime}`,
      reading: latestReading,
    },
    summary: {
      totalDays: sortedDates.length,
      totalSamples: allReadings.length,
      firstDate,
      lastDate,
      missingCellsImputed,
      missingByFeature,
      imputationMethod: method,
      overallAverage,
      latestReading,
    },
    stage_averages: stageAverages,
    pipeline_info: {
      imputation_method: method,
      outlier_cap: null,
      smoothing_1h: false,
      total_rows: allReadings.length,
      total_days: sortedDates.length,
      first_date: firstDate,
      last_date: lastDate,
      missing_cells_imputed: missingCellsImputed,
      missing_by_feature: missingByFeature,
      remaining_missing: 0,
    },
  };
}

// Tải dữ liệu từ /soil_all.json trên CDN kết hợp 7 ngày mới nhất trên Firebase RTDB (dùng khi không có Backend FastAPI)
export const loadLocalSoilData = async (forceRefresh: boolean = false): Promise<FirebaseSensorData | null> => {
  if (!forceRefresh && cachedLocalSoilData) return cachedLocalSoilData;
  if (!forceRefresh && localLoadPromise) return localLoadPromise;

  localLoadPromise = (async () => {
    try {
      const [localRes, recentSnap] = await Promise.all([
        fetch('/soil_all.json').catch(() => null),
        get(query(ref(db, 'data'), orderByKey(), limitToLast(7))).catch(() => null),
      ]);

      let merged: FirebaseSensorData = {};
      if (localRes && localRes.ok) {
        const text = await localRes.text();
        if (text && !text.trim().startsWith('<')) {
          const json = JSON.parse(text);
          const rawData = json && json.data ? json.data : json;
          merged = normalizeFullSensorDataset(rawData);
        }
      }

      if (recentSnap && recentSnap.exists()) {
        const recentRaw = recentSnap.val() as Record<string, any>;
        const recentNorm = normalizeFullSensorDataset(recentRaw);
        for (const [day, readings] of Object.entries(recentNorm)) {
          merged[day] = { ...(merged[day] || {}), ...readings };
        }
      }

      if (Object.keys(merged).length > 0) {
        cachedLocalSoilData = merged;
        cachedSoilData = merged;
        cachedSoilDataAt = Date.now();
        return merged;
      }
    } catch (err) {
      console.warn('[SensorAPI] Không thể tải dữ liệu dự phòng /soil_all.json + Firebase:', err);
    } finally {
      localLoadPromise = null;
    }
    return cachedLocalSoilData;
  })();

  return localLoadPromise;
};

async function fetchBackendJsonSafe(url: string, timeoutMs = 2500): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    if (!text || text.trim().startsWith('<') || (!contentType.includes('json') && text.trim().startsWith('<!'))) {
      return null;
    }
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Gọi Backend API (/api/sensors/data trong backend/app/api/sensors.py), tự động fallback sang /soil_all.json + Firebase trên Firebase Hosting
export const loadProcessedSensorDataFromBackend = async (
  method: string = 'ffill',
  forceRefresh: boolean = false
): Promise<FirebaseSensorData | null> => {
  const now = Date.now();
  if (!forceRefresh && cachedSoilData && now - cachedSoilDataAt < SENSOR_CACHE_TTL_MS) {
    return cachedSoilData;
  }
  if (loadPromise && !forceRefresh) return loadPromise;

  loadPromise = (async () => {
    try {
      const json = await fetchBackendJsonSafe(
        `${API_BASE}/api/sensors/data?method=${encodeURIComponent(method)}${forceRefresh ? '&refresh=true' : ''}`,
        3000
      );
      if (json && (json.data || typeof json === 'object')) {
        const candidate = (json.data || json) as FirebaseSensorData;
        if (Object.keys(candidate).length > 0) {
          cachedSoilData = candidate;
          cachedSoilDataAt = Date.now();
          if (json.summary && json.stage_averages && json.pipeline_info) {
            cachedStagesSummary = {
              latest: json.latest,
              summary: json.summary,
              stage_averages: json.stage_averages,
              pipeline_info: json.pipeline_info,
            };
            cachedStagesSummaryAt = Date.now();
          }
          return cachedSoilData;
        }
      }

      // Fallback khi chạy trên Firebase Hosting (không có máy chủ FastAPI cổng 8000)
      const fallbackData = await loadLocalSoilData(forceRefresh);
      if (fallbackData) {
        cachedSoilData = fallbackData;
        cachedSoilDataAt = Date.now();
        const computedSummary = buildClientStagesSummary(fallbackData, method);
        if (computedSummary) {
          cachedStagesSummary = computedSummary;
          cachedStagesSummaryAt = Date.now();
        }
        return fallbackData;
      }
    } catch (err) {
      console.warn('[SensorAPI] Lỗi tải dữ liệu cảm biến, dùng dữ liệu dự phòng:', err);
    } finally {
      loadPromise = null;
    }
    return cachedSoilData;
  })();

  return loadPromise;
};

// Gọi Backend API (/api/sensors/stages-summary), tự động tính từ dữ liệu cảm biến nếu chạy trên Firebase Hosting
export const fetchProcessedStagesSummary = async (
  method: string = 'ffill',
  forceRefresh: boolean = false
): Promise<BackendStagesSummaryResponse | null> => {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedStagesSummary &&
    cachedStagesSummary.pipeline_info.imputation_method === method &&
    now - cachedStagesSummaryAt < SENSOR_CACHE_TTL_MS
  ) {
    return cachedStagesSummary;
  }

  const json = await fetchBackendJsonSafe(
    `${API_BASE}/api/sensors/stages-summary?method=${encodeURIComponent(method)}${forceRefresh ? '&refresh=true' : ''}`,
    2500
  );
  if (json && json.summary && json.stage_averages) {
    cachedStagesSummary = json as BackendStagesSummaryResponse;
    cachedStagesSummaryAt = Date.now();
    return cachedStagesSummary;
  }

  const data = await loadProcessedSensorDataFromBackend(method, forceRefresh);
  if (data) {
    const computed = buildClientStagesSummary(data, method);
    if (computed) {
      cachedStagesSummary = computed;
      cachedStagesSummaryAt = Date.now();
      return computed;
    }
  }
  return cachedStagesSummary;
};

// Lấy toàn bộ dữ liệu cảm biến đã qua làm sạch
export const getSensorData = async (): Promise<FirebaseSensorData> => {
  const backendData = await loadProcessedSensorDataFromBackend('ffill');
  if (backendData) return backendData;
  const fallback = await loadLocalSoilData();
  if (fallback) return fallback;
  throw new Error('Không thể tải dữ liệu cảm biến từ Backend hoặc Firebase');
};

// Lấy mẫu cảm biến mới nhất
export const getLatestSensorReading = async (): Promise<{
  reading: FirebaseSensorReading;
  timestamp: string;
} | null> => {
  const json = await fetchBackendJsonSafe(`${API_BASE}/api/sensors/latest`, 2000);
  if (json && json.reading) {
    return {
      reading: json.reading as FirebaseSensorReading,
      timestamp: json.timestamp || `${json.date} ${json.time}`,
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

// Đăng ký nhận dữ liệu cảm biến: hiển thị nhanh từ CDN + Firebase, đồng thời đồng bộ từ Backend nếu có
export const subscribeSensorData = (callback: (data: FirebaseSensorData) => void) => {
  let isCancelled = false;
  let latestFirebaseDays: FirebaseSensorData = {};

  const emitMerged = (base: FirebaseSensorData | null) => {
    if (isCancelled) return;
    if (!base && Object.keys(latestFirebaseDays).length === 0) return;
    const merged: FirebaseSensorData = { ...(base || {}) };
    for (const [day, dayMap] of Object.entries(latestFirebaseDays)) {
      merged[day] = {
        ...(merged[day] || {}),
        ...dayMap,
      };
    }
    cachedSoilData = merged;
    cachedSoilDataAt = Date.now();
    callback(merged);
  };

  loadLocalSoilData().then((localData) => {
    if (localData && !isCancelled) {
      emitMerged(localData);
    }
  });

  loadProcessedSensorDataFromBackend('ffill').then((backendData) => {
    if (backendData && !isCancelled) {
      emitMerged(backendData);
    }
  });

  const recentRef = query(ref(db, 'data'), orderByKey(), limitToLast(2));
  const unsubFirebase = onValue(
    recentRef,
    (snapshot) => {
      if (isCancelled || !snapshot.exists()) return;
      const rawVal = snapshot.val() as Record<string, Record<string, any>>;
      const normalized = normalizeFullSensorDataset(rawVal);
      latestFirebaseDays = normalized;
      emitMerged(cachedSoilData || cachedLocalSoilData);
    },
    (err) => {
      console.warn('[SensorAPI] Không thể lắng nghe ngày mới trên Firebase /data:', err);
    }
  );

  return () => {
    isCancelled = true;
    unsubFirebase();
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

