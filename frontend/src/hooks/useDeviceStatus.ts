import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_DEVICE_ID,
  computeDeviceOnline,
  requestDeviceReadNow,
  subscribeDeviceLive,
  subscribeDeviceStatus,
  subscribeReadNowAck,
  subscribeServerTimeOffset,
  type DeviceStatus,
  type LiveSensorSnapshot,
  type ReadNowAck,
} from '@/services/deviceAPI';
import { toast } from '@/hooks/use-toast';
import { toastFirebaseWriteError } from '@/lib/firebaseErrors';

export interface DeviceStatusState {
  deviceId: string;
  status: DeviceStatus | null;
  /** Đã nhận dữ liệu lần đầu từ Firebase (hoặc lỗi) */
  loaded: boolean;
  /** Node devices/{id}/status có tồn tại */
  exists: boolean;
  online: boolean;
  /** Giờ server ước tính (ms) tại lần đánh giá gần nhất */
  serverNow: number;
  /** serverNow - last_seen (ms) hoặc null */
  sinceLastSeenMs: number | null;
  error: string | null;
}

const REEVALUATE_MS = 5000;

/**
 * Theo dõi trạng thái Jetson: lắng nghe `devices/{id}/status` + `.info/serverTimeOffset`,
 * đánh giá lại Online/Offline mỗi 5 giây.
 */
export function useDeviceStatus(deviceId: string = DEFAULT_DEVICE_ID): DeviceStatusState {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    setLoaded(false);
    const unsubStatus = subscribeDeviceStatus(
      deviceId,
      (s) => {
        setStatus(s);
        setError(null);
        setLoaded(true);
        setTick(Date.now());
      },
      (err) => {
        setError(err.message);
        setLoaded(true);
      },
    );
    const unsubOffset = subscribeServerTimeOffset(setOffset);
    const timer = window.setInterval(() => setTick(Date.now()), REEVALUATE_MS);
    return () => {
      unsubStatus();
      unsubOffset();
      window.clearInterval(timer);
    };
  }, [deviceId]);

  const serverNow = tick + offset;
  const sinceLastSeenMs = typeof status?.last_seen === 'number' ? serverNow - status.last_seen : null;

  return {
    deviceId,
    status,
    loaded,
    exists: status !== null,
    online: computeDeviceOnline(status, serverNow),
    serverNow,
    sinceLastSeenMs,
    error,
  };
}

export interface DeviceLiveState {
  live: LiveSensorSnapshot | null;
  sinceLiveMs: number | null;
  readingNow: boolean;
  triggerReadNow: () => Promise<void>;
}

const READ_NOW_TIMEOUT_MS = 12_000;

/**
 * Theo dõi thông số cảm biến trực tiếp (`devices/{id}/live`, cập nhật mỗi ~15s khi mạch online)
 * và hỗ trợ nút "Đọc ngay" qua `devices/{id}/command/read_now` mà không làm bẩn bảng `/data`.
 */
export function useDeviceLive(deviceId: string = DEFAULT_DEVICE_ID, serverNowMs?: number): DeviceLiveState {
  const [live, setLive] = useState<LiveSensorSnapshot | null>(null);
  const [ack, setAck] = useState<ReadNowAck | null>(null);
  const [pendingReqId, setPendingReqId] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubLive = subscribeDeviceLive(deviceId, setLive);
    const unsubAck = subscribeReadNowAck(deviceId, setAck);
    return () => {
      unsubLive();
      unsubAck();
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [deviceId]);

  useEffect(() => {
    if (!pendingReqId) return;
    const matchedLive = live?.request_id === pendingReqId;
    const matchedAck = ack?.request_id === pendingReqId;
    if (!matchedLive && !matchedAck) return;

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setPendingReqId(null);

    if (matchedAck && ack?.status === 'error') {
      toast({
        title: 'Đọc cảm biến thất bại',
        description: ack.error || 'Jetson Nano báo lỗi khi đọc cảm biến.',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Đã cập nhật thông số trực tiếp',
        description: 'Nhiệt độ, độ ẩm và thông số đất hiện tại từ Jetson Nano đã được làm mới.',
      });
    }
  }, [pendingReqId, live?.request_id, ack?.request_id, ack?.status, ack?.error]);

  const triggerReadNow = useCallback(async () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try {
      const reqId = await requestDeviceReadNow(deviceId);
      setPendingReqId(reqId);
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        setPendingReqId((curr) => {
          if (curr === reqId) {
            toast({
              title: 'Jetson chưa phản hồi',
              description: 'Chưa nhận được kết quả đọc tức thời sau 12 giây. Hãy kiểm tra kết nối của mạch.',
              variant: 'destructive',
            });
            return null;
          }
          return curr;
        });
      }, READ_NOW_TIMEOUT_MS);
    } catch (err) {
      toastFirebaseWriteError(err, 'Không gửi được lệnh đọc cảm biến');
    }
  }, [deviceId]);

  const nowRef = typeof serverNowMs === 'number' ? serverNowMs : Date.now();
  const sinceLiveMs = typeof live?.updated_at === 'number' ? Math.max(0, nowRef - live.updated_at) : null;

  return {
    live,
    sinceLiveMs,
    readingNow: pendingReqId !== null,
    triggerReadNow,
  };
}
