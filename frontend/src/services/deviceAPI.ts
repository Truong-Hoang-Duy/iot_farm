// Trạng thái thiết bị biên (Jetson Nano) – devices/{device_id}/status & live
import { db } from '../config/firebaseConfig';
import { ref, onValue, set, serverTimestamp, type Unsubscribe } from 'firebase/database';

export const DEFAULT_DEVICE_ID = 'jetson-nano-01';

export type SensorHealth = 'ok' | 'error' | 'simulated';
export type LiveReadingSource = 'heartbeat' | 'manual' | 'sample';

export interface LiveSensorSnapshot {
  temperature?: number;
  humidity?: number;
  soiltemp?: number;
  moisture?: number;
  pH?: number;
  EC?: number;
  N?: number;
  P?: number;
  K?: number;
  /** Server timestamp (ms) của lần cập nhật live gần nhất */
  updated_at?: number;
  /** Epoch giây trên thiết bị */
  device_ts?: number;
  /** Nguồn cập nhật: tự động mỗi ~15s (heartbeat), bấm nút Đọc ngay (manual), hoặc chu kỳ mẫu (sample) */
  source?: LiveReadingSource | string;
  request_id?: string;
  sensors?: {
    soil?: SensorHealth | string;
    dht20?: SensorHealth | string;
  };
}

export interface ReadNowAck {
  request_id?: string;
  ack_at?: number;
  status?: 'ok' | 'error' | string;
  error?: string;
}

export interface RelayChannelStatus {
  on?: boolean;
  channel?: number;
  pin?: number;
  pin_mode?: string;
  simulated?: boolean;
  reason?: string;
}

export interface DeviceStatus {
  online?: boolean;
  /** Server timestamp (ms) của heartbeat gần nhất */
  last_seen?: number;
  /** Giờ trên thiết bị (epoch giây) */
  device_time?: number;
  hostname?: string;
  ip?: string;
  fw_version?: string;
  interval_sec?: number;
  heartbeat_sec?: number;
  queue_pending?: number;
  ntp_synced?: boolean;
  clock_offset_ms?: number | null;
  network_ok?: boolean;
  sensors?: {
    soil?: SensorHealth | string;
    dht20?: SensorHealth | string;
  };
  relays?: {
    light?: RelayChannelStatus;
    pump?: RelayChannelStatus;
  };
  last_error?: string | null;
  cpu_temp_c?: number;
  uptime_s?: number;
  simulate?: boolean;
}

export const subscribeDeviceStatus = (
  deviceId: string,
  callback: (status: DeviceStatus | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe =>
  onValue(
    ref(db, `devices/${deviceId}/status`),
    (snapshot) => {
      const val = snapshot.val();
      callback(val && typeof val === 'object' ? (val as DeviceStatus) : null);
    },
    (error) => {
      console.warn('[DeviceAPI] Lỗi đọc trạng thái thiết bị:', error);
      onError?.(error);
    },
  );

/** Độ lệch giữa đồng hồ trình duyệt và server Firebase (ms). */
export const subscribeServerTimeOffset = (callback: (offsetMs: number) => void): Unsubscribe =>
  onValue(
    ref(db, '.info/serverTimeOffset'),
    (snapshot) => {
      const v = snapshot.val();
      callback(typeof v === 'number' && Number.isFinite(v) ? v : 0);
    },
    () => callback(0),
  );

/** Ngưỡng offline: max(3 × heartbeat, 30 s). Heartbeat mặc định = min(interval, 15 s). */
export const offlineThresholdMs = (status: DeviceStatus | null | undefined): number => {
  const interval = typeof status?.interval_sec === 'number' && status.interval_sec > 0 ? status.interval_sec : 15;
  const heartbeat =
    typeof status?.heartbeat_sec === 'number' && status.heartbeat_sec > 0
      ? status.heartbeat_sec
      : Math.min(interval, 15);
  return Math.max(3 * heartbeat * 1000, 30_000);
};

/** Online = (serverNow - last_seen) <= ngưỡng và thiết bị không tự báo offline. */
export const computeDeviceOnline = (status: DeviceStatus | null | undefined, serverNowMs: number): boolean => {
  if (!status || typeof status.last_seen !== 'number') return false;
  if (status.online === false) return false;
  return serverNowMs - status.last_seen <= offlineThresholdMs(status);
};

/** Lắng nghe giá trị cảm biến trực tiếp từ mạch (devices/{id}/live, tách biệt với lịch sử /data). */
export const subscribeDeviceLive = (
  deviceId: string,
  callback: (live: LiveSensorSnapshot | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe =>
  onValue(
    ref(db, `devices/${deviceId}/live`),
    (snapshot) => {
      const val = snapshot.val();
      callback(val && typeof val === 'object' ? (val as LiveSensorSnapshot) : null);
    },
    (error) => {
      console.warn('[DeviceAPI] Lỗi đọc live snapshot:', error);
      onError?.(error);
    },
  );

/** Lắng nghe phản hồi của lệnh "Đọc ngay" (devices/{id}/command/read_now_ack). */
export const subscribeReadNowAck = (
  deviceId: string,
  callback: (ack: ReadNowAck | null) => void,
): Unsubscribe =>
  onValue(
    ref(db, `devices/${deviceId}/command/read_now_ack`),
    (snapshot) => {
      const val = snapshot.val();
      callback(val && typeof val === 'object' ? (val as ReadNowAck) : null);
    },
    () => callback(null),
  );

/** Gửi lệnh yêu cầu Jetson Nano đọc cảm biến ngay lập tức (không làm bẩn bảng lịch sử /data). */
export const requestDeviceReadNow = async (deviceId: string = DEFAULT_DEVICE_ID): Promise<string> => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await set(ref(db, `devices/${deviceId}/command/read_now`), {
    request_id: requestId,
    requested_at: serverTimestamp(),
  });
  return requestId;
};
