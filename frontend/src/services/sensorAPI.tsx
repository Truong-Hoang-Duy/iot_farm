// src/services/sensorAPI.tsx — Gọi dữ liệu cảm biến đã xử lý thông qua backend/app/api/sensors.py
import { getSensorData as getProcessedSensorData } from './firebaseAPI';

export const getSensorData = async () => {
  return await getProcessedSensorData();
};
