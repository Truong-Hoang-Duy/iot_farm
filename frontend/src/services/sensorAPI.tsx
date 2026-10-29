// src/services/sensorAPI.ts
// Lớp mỏng giữ tương thích: đọc dữ liệu cảm biến THEO KHOẢNG NGÀY từ Firebase
// (orderByKey + startAt/endAt) thay vì tải toàn bộ node /data.
// Dữ liệu cục bộ /soil_all.json chỉ dùng làm dự phòng (xử lý trong firebaseAPI).
import {
  getSensorDataRange,
  resolveDefaultRange,
  type FirebaseSensorData,
  type SensorDateRange,
} from './firebaseAPI';

export type { SensorDateRange } from './firebaseAPI';

export const getSensorData = async (range?: SensorDateRange): Promise<FirebaseSensorData> => {
  const effectiveRange = range ?? (await resolveDefaultRange()).range;
  const result = await getSensorDataRange(effectiveRange);
  if (result.source === 'none') {
    throw new Error('Dữ liệu không tồn tại');
  }
  return result.data;
};
