// Firebase API for all pages
import { db } from '../config/firebaseConfig';
import {
  ref,
  get,
  set,
  onValue,
  update,
  remove,
  query,
  orderByKey,
  startAt,
  endAt,
  limitToLast,
  type DataSnapshot,
  type Unsubscribe,
} from 'firebase/database';
import {
  addDaysToKey,
  isDateKey,
  keysToEpochMs,
  parseTimeKey,
  sortTimeKeys,
  todayDateKey,
} from '@/lib/timeKeys';
import { toastFirebaseWriteError } from '@/lib/firebaseErrors';

// ==================== TYPES ====================

/** Chất lượng mốc thời gian do Jetson gắn (không có RTC). */
export type TimeQuality = 'ntp' | 'corrected' | 'estimated';

// Types matching Firebase data structure (data/{YYYY-MM-DD}/{HH:MM[:SS]})
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
  /** Cảm biến ánh sáng đã bị bỏ – chỉ còn trong dữ liệu cũ. */
  light?: number;
  /** epoch giây (UTC) */
  ts?: number;
  tq?: TimeQuality;
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

// Streaming config from Firebase
export interface StreamingThreshold {
  high: number;
  low: number;
}

export interface StreamingControlDevice {
  /** Trạng thái MONG MUỐN (UI ghi ở chế độ manual): false/true hoặc 0/1 */
  status: boolean | number;
  /** Trạng thái THỰC TẾ do Jetson báo lại */
  actual?: boolean | number;
  /** true khi chưa có relay thật (mô phỏng) */
  simulated?: boolean;
  /** Tổng số giờ bật trong ngày */
  daily_time?: number;
  /** Lần bật gần nhất (chuỗi thời gian hoặc epoch) */
  last_on_time?: string | number;
  /** Server timestamp (ms) lần cập nhật gần nhất */
  updated_at?: number;
}

// Light schedule with on/off time
export interface LightScheduleSlot {
  on: number;  // hour to turn on (0-23)
  off: number; // hour to turn off (0-23)
}

export interface StreamingConfig {
  config: {
    irrigation_mode: number; // 0 = manual, 1 = auto, 2 = schedule
    irrigation_time: {
      time1: number;
      time2: number;
      [key: string]: number; // Allow additional time slots
    };
    /** Thời lượng mỗi lần tưới theo lịch (phút), mặc định 5 */
    irrigation_duration_min?: number;
    /** Chu kỳ lấy mẫu cảm biến của Jetson (giây, 5..86400), mặc định 300 */
    sampling_interval_sec?: number;
    light_mode: number | string; // 0 = manual, 1 = auto, 2 = schedule or empty string
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

// ==================== LOCAL DATA FALLBACK ====================
// false = đọc dữ liệu thật từ Firebase. Tệp cục bộ soil_all.json CHỈ dùng làm
// dự phòng khi Firebase không trả về dữ liệu hoặc bị lỗi (mất mạng, sai quyền...).
export const USE_LOCAL_SOIL_DATA = false;

let cachedSoilData: FirebaseSensorData | null = null;
let loadPromise: Promise<FirebaseSensorData | null> | null = null;

// Tải dữ liệu đất từ tệp cục bộ soil_all.json (chuỗi 261 ngày quan trắc từ Data-Processing)
export const loadLocalSoilData = async (): Promise<FirebaseSensorData | null> => {
  if (cachedSoilData) return cachedSoilData;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const res = await fetch('/soil_all.json');
      if (res.ok) {
        const json = await res.json();
        cachedSoilData = (json.data || json) as FirebaseSensorData;
        return cachedSoilData;
      } else {
        console.warn(`[SensorAPI] Không tìm thấy /soil_all.json (HTTP ${res.status})`);
      }
    } catch (err) {
      console.warn('[SensorAPI] Không thể tải dữ liệu cục bộ /soil_all.json:', err);
    } finally {
      loadPromise = null;
    }
    return null;
  })();

  return loadPromise;
};

// ==================== SENSOR DATA (date-range aware) ====================

/** Khoảng ngày (bao gồm 2 đầu), khóa dạng YYYY-MM-DD giờ VN. */
export interface SensorDateRange {
  startDate: string;
  endDate: string;
}

export type SensorDataSource = 'firebase' | 'local' | 'none';

export interface SensorRangeResult {
  data: FirebaseSensorData;
  source: SensorDataSource;
  range: SensorDateRange;
  error?: string;
}

export interface LatestSensorReading {
  reading: FirebaseSensorReading;
  /** "YYYY-MM-DD HH:MM[:SS]" (giữ tương thích) */
  timestamp: string;
  dateKey: string;
  timeKey: string;
  /** epoch ms của bản ghi (ưu tiên trường `ts`) */
  epochMs: number | null;
  source: SensorDataSource;
}

export interface FlatSensorPoint {
  dateKey: string;
  timeKey: string;
  epochMs: number;
  reading: FirebaseSensorReading;
}

export const DEFAULT_RANGE_DAYS = 3;

const dataRangeQuery = (range: SensorDateRange) =>
  query(ref(db, 'data'), orderByKey(), startAt(range.startDate), endAt(range.endDate));

const latestDayQuery = () => query(ref(db, 'data'), orderByKey(), limitToLast(1));

const sliceByRange = (data: FirebaseSensorData, range: SensorDateRange): FirebaseSensorData => {
  const out: FirebaseSensorData = {};
  for (const key of Object.keys(data)) {
    if (isDateKey(key) && key >= range.startDate && key <= range.endDate) {
      out[key] = data[key];
    }
  }
  return out;
};

const latestDateKeyOf = (data: FirebaseSensorData): string | null => {
  const keys = Object.keys(data).filter(isDateKey).sort();
  return keys.length ? keys[keys.length - 1] : null;
};

/** Chuẩn hóa `ts` (epoch giây, đề phòng ms) → epoch ms. */
export const readingEpochMs = (
  reading: FirebaseSensorReading | undefined,
  dateKey: string,
  timeKey: string,
): number | null => {
  const ts = reading?.ts;
  if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
    return ts > 1e12 ? ts : ts * 1000;
  }
  return keysToEpochMs(dateKey, timeKey);
};

/** Làm phẳng dữ liệu {ngày: {giờ: bản ghi}} → mảng điểm đã sắp xếp theo thời gian. */
export const flattenSensorData = (data: FirebaseSensorData | null | undefined): FlatSensorPoint[] => {
  if (!data) return [];
  const points: FlatSensorPoint[] = [];
  for (const dateKey of Object.keys(data).filter(isDateKey).sort()) {
    const day = data[dateKey];
    if (!day || typeof day !== 'object') continue;
    for (const timeKey of sortTimeKeys(Object.keys(day).filter((k) => parseTimeKey(k) !== null))) {
      const reading = day[timeKey];
      if (!reading || typeof reading !== 'object') continue;
      const epochMs = keysToEpochMs(dateKey, timeKey);
      if (epochMs === null) continue;
      points.push({ dateKey, timeKey, epochMs, reading });
    }
  }
  return points;
};

const extractLatestFromDay = (
  dateKey: string,
  day: Record<string, FirebaseSensorReading> | null | undefined,
  source: SensorDataSource,
): LatestSensorReading | null => {
  if (!day || typeof day !== 'object') return null;
  const times = sortTimeKeys(Object.keys(day).filter((k) => parseTimeKey(k) !== null));
  if (times.length === 0) return null;
  const timeKey = times[times.length - 1];
  const reading = day[timeKey];
  if (!reading) return null;
  return {
    reading,
    timestamp: `${dateKey} ${timeKey}`,
    dateKey,
    timeKey,
    epochMs: readingEpochMs(reading, dateKey, timeKey),
    source,
  };
};

const extractLatestFromData = (data: FirebaseSensorData, source: SensorDataSource): LatestSensorReading | null => {
  const keys = Object.keys(data).filter(isDateKey).sort().reverse();
  for (const key of keys) {
    const latest = extractLatestFromDay(key, data[key], source);
    if (latest) return latest;
  }
  return null;
};

const firstChild = (snapshot: DataSnapshot): { key: string; value: Record<string, FirebaseSensorReading> } | null => {
  let found: { key: string; value: Record<string, FirebaseSensorReading> } | null = null;
  snapshot.forEach((child) => {
    if (child.key) {
      found = { key: child.key, value: child.val() };
    }
  });
  return found;
};

/**
 * Tìm ngày mới nhất có dữ liệu (query limitToLast(1) – không tải toàn bộ /data).
 */
export const getLatestDateKey = async (): Promise<{ dateKey: string | null; source: SensorDataSource }> => {
  if (!USE_LOCAL_SOIL_DATA) {
    try {
      const snapshot = await get(latestDayQuery());
      const child = snapshot.exists() ? firstChild(snapshot) : null;
      if (child && isDateKey(child.key)) {
        return { dateKey: child.key, source: 'firebase' };
      }
    } catch (error) {
      console.warn('[SensorAPI] Không lấy được ngày mới nhất từ Firebase, dùng dữ liệu cục bộ:', error);
    }
  }
  const local = await loadLocalSoilData();
  const dateKey = local ? latestDateKeyOf(local) : null;
  return { dateKey, source: dateKey ? 'local' : 'none' };
};

/** Khoảng `days` ngày tính ngược từ ngày có dữ liệu mới nhất. */
export const buildRangeEndingAt = (endDate: string, days: number): SensorDateRange => ({
  startDate: addDaysToKey(endDate, -(Math.max(1, Math.floor(days)) - 1)),
  endDate,
});

/** Khoảng mặc định: `days` ngày gần nhất tính theo ngày có dữ liệu mới nhất. */
export const resolveDefaultRange = async (
  days: number = DEFAULT_RANGE_DAYS,
): Promise<{ range: SensorDateRange; source: SensorDataSource }> => {
  const { dateKey, source } = await getLatestDateKey();
  return { range: buildRangeEndingAt(dateKey ?? todayDateKey(), days), source };
};

/** Đọc một lần dữ liệu cảm biến trong khoảng ngày. */
export const getSensorDataRange = async (range: SensorDateRange): Promise<SensorRangeResult> => {
  let errorText: string | undefined;
  if (!USE_LOCAL_SOIL_DATA) {
    try {
      const snapshot = await get(dataRangeQuery(range));
      if (snapshot.exists()) {
        return { data: snapshot.val() as FirebaseSensorData, source: 'firebase', range };
      }
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error);
      console.warn('[SensorAPI] Firebase get thất bại, chuyển sang đọc /soil_all.json:', error);
    }
  }
  const local = await loadLocalSoilData();
  if (local) {
    const sliced = sliceByRange(local, range);
    if (Object.keys(sliced).length > 0) {
      return { data: sliced, source: 'local', range, error: errorText };
    }
  }
  return { data: {}, source: 'none', range, error: errorText };
};

/**
 * Lắng nghe realtime dữ liệu cảm biến trong khoảng ngày.
 * Nếu Firebase rỗng/lỗi → dùng soil_all.json (đã cắt theo khoảng) làm dự phòng.
 */
export const subscribeSensorDataRange = (
  range: SensorDateRange,
  callback: (result: SensorRangeResult) => void,
): Unsubscribe => {
  let cancelled = false;
  let hasReceivedFirebase = false;

  const applyLocalFallback = (errorText?: string) => {
    loadLocalSoilData().then((local) => {
      if (cancelled || hasReceivedFirebase) return;
      const sliced = local ? sliceByRange(local, range) : {};
      callback({
        data: sliced,
        source: Object.keys(sliced).length > 0 ? 'local' : 'none',
        range,
        error: errorText,
      });
    });
  };

  if (USE_LOCAL_SOIL_DATA) {
    applyLocalFallback();
    return () => {
      cancelled = true;
    };
  }

  const unsubscribe = onValue(
    dataRangeQuery(range),
    (snapshot) => {
      if (snapshot.exists()) {
        hasReceivedFirebase = true;
        callback({ data: snapshot.val() as FirebaseSensorData, source: 'firebase', range });
      } else if (hasReceivedFirebase) {
        callback({ data: {}, source: 'firebase', range });
      } else {
        applyLocalFallback();
      }
    },
    (error) => {
      console.warn('[SensorAPI] Firebase listen error, using local fallback:', error);
      if (!hasReceivedFirebase) applyLocalFallback(error.message);
    },
  );

  return () => {
    cancelled = true;
    unsubscribe();
  };
};

/** Lắng nghe realtime bản ghi mới nhất (chỉ ngày mới nhất – limitToLast(1)). */
export const subscribeLatestReading = (
  callback: (latest: LatestSensorReading | null) => void,
): Unsubscribe => {
  let cancelled = false;
  let hasReceivedFirebase = false;

  const applyLocalFallback = () => {
    loadLocalSoilData().then((local) => {
      if (cancelled || hasReceivedFirebase) return;
      callback(local ? extractLatestFromData(local, 'local') : null);
    });
  };

  if (USE_LOCAL_SOIL_DATA) {
    applyLocalFallback();
    return () => {
      cancelled = true;
    };
  }

  const unsubscribe = onValue(
    latestDayQuery(),
    (snapshot) => {
      const child = snapshot.exists() ? firstChild(snapshot) : null;
      const latest = child ? extractLatestFromDay(child.key, child.value, 'firebase') : null;
      if (latest) {
        hasReceivedFirebase = true;
        callback(latest);
      } else if (!hasReceivedFirebase) {
        applyLocalFallback();
      }
    },
    (error) => {
      console.warn('[SensorAPI] Lỗi lắng nghe bản ghi mới nhất, dùng dữ liệu cục bộ:', error);
      if (!hasReceivedFirebase) applyLocalFallback();
    },
  );

  return () => {
    cancelled = true;
    unsubscribe();
  };
};

// Get latest sensor reading
export const getLatestSensorReading = async (): Promise<LatestSensorReading | null> => {
  if (!USE_LOCAL_SOIL_DATA) {
    try {
      const snapshot = await get(latestDayQuery());
      const child = snapshot.exists() ? firstChild(snapshot) : null;
      const latest = child ? extractLatestFromDay(child.key, child.value, 'firebase') : null;
      if (latest) return latest;
    } catch (error) {
      console.warn('[SensorAPI] Firebase get bản ghi mới nhất thất bại, dùng dữ liệu cục bộ:', error);
    }
  }
  const local = await loadLocalSoilData();
  return local ? extractLatestFromData(local, 'local') : null;
};

/**
 * Đọc dữ liệu cảm biến theo khoảng ngày (mặc định: 3 ngày gần nhất).
 * KHÔNG còn tải toàn bộ node /data.
 */
export const getSensorData = async (range?: SensorDateRange): Promise<FirebaseSensorData> => {
  const effectiveRange = range ?? (await resolveDefaultRange()).range;
  const result = await getSensorDataRange(effectiveRange);
  if (result.source === 'none') {
    throw new Error('Dữ liệu cảm biến không tồn tại');
  }
  return result.data;
};

// ==================== CONTROL API (legacy `controls` node) ====================
export const getControlData = async (): Promise<FirebaseControlData> => {
  const controlRef = ref(db, 'controls');
  const snapshot = await get(controlRef);
  if (snapshot.exists()) {
    return snapshot.val();
  }
  // Return default values if not exists
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

// Subscribe to real-time control updates
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

// Subscribe to real-time alert updates
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

// Cập nhật cảnh báo (giao diện vẫn giữ thay đổi cục bộ; lỗi quyền ghi được báo bằng toast)
export const updateAlert = async (id: string, data: Partial<FirebaseAlertData>): Promise<void> => {
  try {
    const alertRef = ref(db, `notifications/${id}`);
    await update(alertRef, data);
  } catch (error) {
    toastFirebaseWriteError(error, `Không thể cập nhật cảnh báo ${id} lên Firebase`);
  }
};

// Xác nhận cảnh báo (Acknowledge)
export const acknowledgeAlert = async (id: string): Promise<void> => {
  const now = new Date();
  const timeStr = `${now.toLocaleDateString('vi-VN')} ${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
  await updateAlert(id, {
    acknowledged: true,
    acknowledgedAt: timeStr,
  });
};

// Hủy xác nhận cảnh báo (Un-acknowledge)
export const unacknowledgeAlert = async (id: string): Promise<void> => {
  await updateAlert(id, {
    acknowledged: false,
    acknowledgedAt: '',
  });
};

// Hủy bỏ cảnh báo (Dismiss / Cancel)
export const dismissAlert = async (id: string): Promise<void> => {
  const now = new Date();
  const timeStr = `${now.toLocaleDateString('vi-VN')} ${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
  await updateAlert(id, {
    active: false,
    dismissed: true,
    dismissedAt: timeStr,
  });
};

// Kích hoạt lại cảnh báo đã hủy (Reactivate)
export const reactivateAlert = async (id: string): Promise<void> => {
  await updateAlert(id, {
    active: true,
    dismissed: false,
  });
};

// Xóa cảnh báo vĩnh viễn
export const deleteAlert = async (id: string): Promise<void> => {
  try {
    const alertRef = ref(db, `notifications/${id}`);
    await remove(alertRef);
  } catch (error) {
    toastFirebaseWriteError(error, `Không thể xóa cảnh báo ${id} trên Firebase`);
  }
};

// ==================== PLANT INFO API ====================
export const getPlantInfo = async (): Promise<FirebasePlantInfo> => {
  const plantRef = ref(db, 'plantInfo');
  const snapshot = await get(plantRef);
  if (snapshot.exists()) {
    return snapshot.val();
  }
  // Return default values if not exists
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
  // Return default values if not exists
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
    return mergeStreamingConfig(snapshot.val());
  }
  return null;
};

export const DEFAULT_SAMPLING_INTERVAL_SEC = 300;
export const MIN_SAMPLING_INTERVAL_SEC = 5;
export const MAX_SAMPLING_INTERVAL_SEC = 86400;
export const DEFAULT_IRRIGATION_DURATION_MIN = 5;
export const MIN_IRRIGATION_DURATION_MIN = 1;
export const MAX_IRRIGATION_DURATION_MIN = 120;

export const defaultStreamingConfig: StreamingConfig = {
  config: {
    irrigation_mode: 1,
    irrigation_time: { time1: 6, time2: 17 },
    irrigation_duration_min: DEFAULT_IRRIGATION_DURATION_MIN,
    sampling_interval_sec: DEFAULT_SAMPLING_INTERVAL_SEC,
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

/** Gộp sâu dữ liệu `/streaming` từ Firebase với cấu hình mặc định để tránh crash khi node mới chỉ có một phần khoá. */
export const mergeStreamingConfig = (raw: unknown): StreamingConfig => {
  const obj = raw && typeof raw === 'object' ? (raw as Partial<StreamingConfig>) : {};
  const cfg: Partial<StreamingConfig['config']> =
    obj.config && typeof obj.config === 'object' ? obj.config : {};
  const ctl: Partial<StreamingConfig['control']> =
    obj.control && typeof obj.control === 'object' ? obj.control : {};
  const defCfg = defaultStreamingConfig.config;
  const defCtl = defaultStreamingConfig.control;
  return {
    config: {
      ...defCfg,
      ...cfg,
      irrigation_time: {
        ...defCfg.irrigation_time,
        ...(cfg.irrigation_time && typeof cfg.irrigation_time === 'object' ? cfg.irrigation_time : {}),
      },
      light_time: {
        ...defCfg.light_time,
        ...(cfg.light_time && typeof cfg.light_time === 'object' ? cfg.light_time : {}),
      },
      plant: {
        ...defCfg.plant,
        ...(cfg.plant && typeof cfg.plant === 'object' ? cfg.plant : {}),
      },
      threshold: {
        nitrogen: { ...defCfg.threshold.nitrogen, ...(cfg.threshold?.nitrogen ?? {}) },
        phosphorus: { ...defCfg.threshold.phosphorus, ...(cfg.threshold?.phosphorus ?? {}) },
        potassium: { ...defCfg.threshold.potassium, ...(cfg.threshold?.potassium ?? {}) },
        soil_ec: { ...defCfg.threshold.soil_ec, ...(cfg.threshold?.soil_ec ?? {}) },
        soil_moisture: { ...defCfg.threshold.soil_moisture, ...(cfg.threshold?.soil_moisture ?? {}) },
        soil_ph: { ...defCfg.threshold.soil_ph, ...(cfg.threshold?.soil_ph ?? {}) },
        soil_temperature: { ...defCfg.threshold.soil_temperature, ...(cfg.threshold?.soil_temperature ?? {}) },
      },
    },
    control: {
      light: {
        ...defCtl.light,
        ...(ctl.light && typeof ctl.light === 'object' ? ctl.light : {}),
      },
      pump: {
        ...defCtl.pump,
        ...(ctl.pump && typeof ctl.pump === 'object' ? ctl.pump : {}),
      },
    },
  };
};

// Subscribe to real-time streaming config updates (for thresholds)
export const subscribeStreamingConfig = (callback: (data: StreamingConfig | null) => void) => {
  const streamingRef = ref(db, 'streaming');
  return onValue(
    streamingRef,
    (snapshot) => {
      if (snapshot.exists()) {
        callback(mergeStreamingConfig(snapshot.val()));
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
// Các hàm ghi dưới đây ném lỗi (kể cả PERMISSION_DENIED) cho nơi gọi xử lý bằng toast
// (xem `toastFirebaseWriteError` trong '@/lib/firebaseErrors').

// Set pump irrigation mode (0 = manual, 1 = auto, 2 = schedule)
export const setStreamingIrrigationMode = async (mode: number): Promise<void> => {
  const modeRef = ref(db, 'streaming/config/irrigation_mode');
  await set(modeRef, mode);
};

// Set light mode (0 = manual, 1 = auto, 2 = schedule)
export const setStreamingLightMode = async (mode: number): Promise<void> => {
  const modeRef = ref(db, 'streaming/config/light_mode');
  await set(modeRef, mode);
};

// Set control status (pump or light) - only works in manual mode
export const setStreamingControlStatus = async (device: 'pump' | 'light', status: boolean): Promise<void> => {
  const statusRef = ref(db, `streaming/control/${device}/status`);
  await set(statusRef, status);
};

// Set irrigation schedule times - set each field individually
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

// Set light schedule time (single on/off)
export const setStreamingLightTime = async (on: number, off: number): Promise<void> => {
  const timeRef = ref(db, 'streaming/config/light_time/on');
  await set(timeRef, on);

  const timeRef2 = ref(db, 'streaming/config/light_time/off');
  await set(timeRef2, off);
};

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

export interface ControlDeviceInfo {
  /** Trạng thái mong muốn */
  status: boolean;
  /** Trạng thái thực tế do thiết bị báo lại (null = chưa báo) */
  actual: boolean | null;
  simulated: boolean;
  daily_time: number;
  last_on_time: string | number;
  updated_at: number | null;
}

const toBool = (v: unknown): boolean | null => {
  if (v === true || v === 1 || v === '1' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'false') return false;
  return null;
};

// Helper to get control device status
export const getControlDeviceStatus = (device: StreamingControlDevice | number | boolean | null | undefined): ControlDeviceInfo => {
  if (device === null || device === undefined) {
    return { status: false, actual: null, simulated: false, daily_time: 0, last_on_time: '', updated_at: null };
  }
  if (typeof device === 'number' || typeof device === 'boolean') {
    return { status: toBool(device) ?? false, actual: null, simulated: false, daily_time: 0, last_on_time: '', updated_at: null };
  }
  return {
    status: toBool(device.status) ?? false,
    actual: toBool(device.actual),
    simulated: device.simulated === true,
    daily_time: typeof device.daily_time === 'number' ? device.daily_time : 0,
    last_on_time: device.last_on_time ?? '',
    updated_at: typeof device.updated_at === 'number' ? device.updated_at : null,
  };
};

// Update streaming thresholds - set each sensor threshold individually
export const updateStreamingThreshold = async (thresholds: StreamingConfig['config']['threshold']): Promise<void> => {
  const sensorKeys = Object.keys(thresholds) as Array<keyof typeof thresholds>;
  
  for (const sensorKey of sensorKeys) {
    const threshold = thresholds[sensorKey];
    if (threshold) {
      // Set low value
      const lowRef = ref(db, `streaming/config/threshold/${sensorKey}/low`);
      await set(lowRef, threshold.low);
      
      // Set high value
      const highRef = ref(db, `streaming/config/threshold/${sensorKey}/high`);
      await set(highRef, threshold.high);
    }
  }
};
