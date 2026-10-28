// src/services/sensorAPI.ts
import { db } from '../config/firebaseConfig';
import { ref, get } from 'firebase/database';
import { USE_LOCAL_SOIL_DATA, loadLocalSoilData } from './firebaseAPI';

export const getSensorData = async () => {
  if (USE_LOCAL_SOIL_DATA) {
    const local = await loadLocalSoilData();
    if (local) return local;
  }

  try {
    const sensorRef = ref(db, 'data');
    const snapshot = await get(sensorRef);
    if (snapshot.exists()) {
      return snapshot.val(); // Trả về dữ liệu JSON từ Realtime Database
    }
  } catch (error) {
    console.warn('[SensorAPI] Firebase query failed, using local /soil_all.json:', error);
  }

  // Fallback đọc dữ liệu soil_all.json
  const local = await loadLocalSoilData();
  if (local) return local;

  throw new Error('Dữ liệu không tồn tại');
};
