// Firebase API for all pages
import { db } from '../config/firebaseConfig';
import { ref, get, set, onValue, update, remove } from 'firebase/database';

// Types matching Firebase data structure
export interface FirebaseSensorReading {
  EC: number;
  K: number;
  N: number;
  P: number;
  humidity: number;
  light: number;
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

// Streaming config from Firebase
export interface StreamingThreshold {
  high: number;
  low: number;
}

export interface StreamingControlDevice {
  status: boolean | number; // false/true or 0/1
  daily_time?: number; // total hours on today
  last_on_time?: string; // last time turned on
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

// ==================== LOCAL DATA SETTINGS ====================
// Đặt true để dùng dữ liệu cục bộ soil_all.json (dùng tạm khi Firebase chưa upload dữ liệu mới)
// Khi đã upload lên Firebase mới xong, có thể chuyển thành false
export const USE_LOCAL_SOIL_DATA = true;

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

export const getSensorData = async (): Promise<FirebaseSensorData> => {
  // Khi bật USE_LOCAL_SOIL_DATA, ưu tiên đọc trực tiếp từ /soil_all.json
  if (USE_LOCAL_SOIL_DATA) {
    const localData = await loadLocalSoilData();
    if (localData) return localData;
  }

  try {
    const sensorRef = ref(db, 'data');
    const snapshot = await get(sensorRef);
    if (snapshot.exists()) {
      return snapshot.val();
    }
  } catch (error) {
    console.warn('[SensorAPI] Firebase get thất bại, chuyển sang đọc /soil_all.json:', error);
  }

  // Fallback đọc từ tệp soil_all.json nếu chưa đọc
  const localData = await loadLocalSoilData();
  if (localData) {
    return localData;
  }
  throw new Error('Dữ liệu cảm biến không tồn tại');
};

// Get latest sensor reading
export const getLatestSensorReading = async (): Promise<{ reading: FirebaseSensorReading; timestamp: string } | null> => {
  const data = await getSensorData();
  
  // Get all dates and sort them
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

// Subscribe to real-time sensor updates with local fallback
export const subscribeSensorData = (callback: (data: FirebaseSensorData) => void) => {
  // Nếu bật chế độ dùng tạm dữ liệu cục bộ soil_all.json
  if (USE_LOCAL_SOIL_DATA) {
    loadLocalSoilData().then((localData) => {
      if (localData) {
        callback(localData);
      }
    });
    return () => {};
  }

  const sensorRef = ref(db, 'data');
  let hasReceivedFirebase = false;

  const unsubscribe = onValue(
    sensorRef,
    (snapshot) => {
      if (snapshot.exists()) {
        hasReceivedFirebase = true;
        callback(snapshot.val());
      } else if (!hasReceivedFirebase) {
        loadLocalSoilData().then((localData) => {
          if (localData && !hasReceivedFirebase) {
            callback(localData);
          }
        });
      }
    },
    (error) => {
      console.warn('[SensorAPI] Firebase listen error, using local fallback:', error);
      if (!hasReceivedFirebase) {
        loadLocalSoilData().then((localData) => {
          if (localData) callback(localData);
        });
      }
    }
  );

  return unsubscribe;
};

// ==================== CONTROL API ====================
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

// Cập nhật cảnh báo
export const updateAlert = async (id: string, data: Partial<FirebaseAlertData>): Promise<void> => {
  try {
    const alertRef = ref(db, `notifications/${id}`);
    await update(alertRef, data);
  } catch (error) {
    console.warn(`[Firebase] Không thể cập nhật cảnh báo ${id}:`, error);
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

// Subscribe to real-time streaming config updates (for thresholds)
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

// Helper to get control device status
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