// Plant growth stages data for different plant types

export interface GrowthStage {
  name: string;
  minDays: number;
  maxDays: number;
  n: number;
  p: number;
  k: number;
}

export interface PlantGrowthData {
  stages: GrowthStage[];
  totalNPK: { n: number; p: number; k: number };
  totalDays: number;
  careTips: Record<number, { title: string; desc: string }[]>;
}

// Chili (Cây Ớt - Capsicum annuum) growth stages - Dữ liệu chuẩn nông học
export const CHILI_DATA: PlantGrowthData = {
  stages: [
    { name: 'Cây con & bén rễ', minDays: 0, maxDays: 20, n: 25, p: 25, k: 25 },
    { name: 'Phát triển thân cành lá', minDays: 21, maxDays: 45, n: 60, p: 35, k: 45 },
    { name: 'Ra hoa & phân hóa nụ', minDays: 46, maxDays: 65, n: 40, p: 50, k: 70 },
    { name: 'Đậu trái & nuôi trái non', minDays: 66, maxDays: 90, n: 50, p: 40, k: 95 },
    { name: 'Thu hoạch rộ', minDays: 91, maxDays: 135, n: 80, p: 50, k: 130 },
    { name: 'Cuối vụ & phục hồi', minDays: 136, maxDays: 160, n: 45, p: 30, k: 60 },
  ],
  totalNPK: { n: 300, p: 230, k: 425 },
  totalDays: 160,
  careTips: {
    0: [
      { title: 'Tưới nước', desc: 'Duy trì ẩm độ đất 50–60%, tưới phun sương nhẹ tránh dập cây non' },
      { title: 'Ánh sáng', desc: 'Cần ánh sáng tán xạ nhẹ, che bớt nắng gắt buổi trưa' },
      { title: 'Bón phân', desc: 'Bón lót lân và phân hữu cơ vi sinh giúp rễ ăn sâu bám chắc' },
      { title: 'Phòng bệnh', desc: 'Khử trùng đất, phòng bệnh lở cổ rễ và nấm rễ' },
    ],
    1: [
      { title: 'Tưới nước', desc: 'Tưới đều 1–2 lần/ngày, giữ ẩm đất ổn định quanh mức 45–55%' },
      { title: 'Ánh sáng', desc: 'Cần 6–8 giờ nắng trực tiếp mỗi ngày để quang hợp tạo cành nhánh' },
      { title: 'Bón phân', desc: 'Bón thúc Đạm (N) và Lân (P) giúp phân cành cấp 1, cấp 2 khỏe mạnh' },
      { title: 'Phòng bệnh', desc: 'Quan sát mặt dưới lá phòng bọ trĩ, rầy mềm và nhện đỏ' },
    ],
    2: [
      { title: 'Tưới nước', desc: 'Giảm nhẹ lượng nước tưới kích thích phân hóa mầm hoa, không để ngập úng' },
      { title: 'Ánh sáng', desc: 'Đảm bảo đủ nắng để hoa thụ phấn tốt, thông thoáng tán lá' },
      { title: 'Bón phân', desc: 'Tăng Lân (P) và Kali (K), bổ sung Bo và Canxi chống rụng nụ hoa' },
      { title: 'Phòng bệnh', desc: 'Phòng bệnh thán thư và sương mai trong điều kiện ẩm độ không khí cao' },
    ],
    3: [
      { title: 'Tưới nước', desc: 'Cung cấp đủ ẩm đều đặn, thiếu nước làm trái ớt bị teo, cay gắt và rụng non' },
      { title: 'Ánh sáng', desc: 'Cần đủ nắng để trái tổng hợp chất dinh dưỡng và sắc tố' },
      { title: 'Bón phân', desc: 'Tăng cường Kali (K) giúp trái lớn nhanh, thịt dày, bóng đẹp và tăng vị cay' },
      { title: 'Phòng bệnh', desc: 'Phòng ngừa thối đuôi trái và ruồi đục trái định kỳ' },
    ],
    4: [
      { title: 'Thu hoạch', desc: 'Thu hoạch khi trái chuyển màu chín đỏ đều, hái kèm cuống vào sáng sớm' },
      { title: 'Tưới nước', desc: 'Duy trì độ ẩm đất 45–55%, giảm nhẹ nước trước đợt hái rộ 1 ngày' },
      { title: 'Bón phân', desc: 'Bón thúc dặm NPK cân bằng sau mỗi đợt hái để cây nuôi tiếp đợt trái sau' },
      { title: 'Bảo quản', desc: 'Loại bỏ trái bệnh, bảo quản nơi thoáng mát tránh ẩm mốc' },
    ],
    5: [
      { title: 'Chăm sóc', desc: 'Cắt tỉa cành tăm, lá vàng úa và cành sâu bệnh sau thu hoạch' },
      { title: 'Bón phân', desc: 'Bón bổ sung phân hữu cơ và vi lượng phục hồi sinh lực cây' },
      { title: 'Đất', desc: 'Xới nhẹ phá váng mặt luống, bổ sung vôi nâng pH nếu đất bị chua' },
      { title: 'Chuẩn bị vụ mới', desc: 'Dọn sạch tàn dư thực vật, xử lý đất tiêu diệt mầm nấm' },
    ],
  },
};

// Mustard (Cải) growth stages - 30-45 days total
export const MUSTARD_DATA: PlantGrowthData = {
  stages: [
    { name: 'Nảy mầm', minDays: 0, maxDays: 5, n: 5, p: 5, k: 5 },
    { name: 'Cây con', minDays: 6, maxDays: 15, n: 15, p: 10, k: 12 },
    { name: 'Phát triển thân lá', minDays: 16, maxDays: 35, n: 30, p: 15, k: 25 },
    { name: 'Thu hoạch', minDays: 36, maxDays: 45, n: 10, p: 5, k: 8 },
  ],
  totalNPK: { n: 60, p: 35, k: 50 },
  totalDays: 45,
  careTips: {
    0: [
      { title: 'Tưới nước', desc: 'Giữ ẩm đều, phun sương nhẹ hàng ngày' },
      { title: 'Ánh sáng', desc: 'Ánh sáng nhẹ, che nắng gắt' },
      { title: 'Bón phân', desc: 'Không cần bón phân giai đoạn này' },
      { title: 'Phòng bệnh', desc: 'Đảm bảo đất tơi xốp, thoát nước' },
    ],
    1: [
      { title: 'Tưới nước', desc: 'Tưới đều 2 lần/ngày, giữ ẩm liên tục' },
      { title: 'Ánh sáng', desc: 'Cần 4-6 giờ nắng mỗi ngày' },
      { title: 'Bón phân', desc: 'Bón nhẹ phân đạm để ra lá' },
      { title: 'Phòng bệnh', desc: 'Kiểm tra sâu xanh, bọ nhảy' },
    ],
    2: [
      { title: 'Tưới nước', desc: 'Tưới đều, không để thiếu nước' },
      { title: 'Ánh sáng', desc: 'Đủ nắng 6-8 giờ/ngày' },
      { title: 'Bón phân', desc: 'Bón thúc đạm + kali cho lá xanh mướt' },
      { title: 'Phòng bệnh', desc: 'Phòng bệnh thối nhũn, sâu tơ' },
    ],
    3: [
      { title: 'Thu hoạch', desc: 'Thu hoạch khi lá đạt kích thước mong muốn' },
      { title: 'Tưới nước', desc: 'Giảm tưới trước thu hoạch 1 ngày' },
      { title: 'Bảo quản', desc: 'Thu sáng sớm, bảo quản nơi mát' },
      { title: 'Lưu ý', desc: 'Có thể thu hoạch non hoặc già tùy nhu cầu' },
    ],
  },
};

// Peanut (Lạc/Đậu phộng) growth stages - 90-110 days total
export const PEANUT_DATA: PlantGrowthData = {
  stages: [
    { name: 'Nảy mầm', minDays: 0, maxDays: 7, n: 10, p: 15, k: 10 },
    { name: 'Sinh trưởng sinh dưỡng', minDays: 8, maxDays: 37, n: 30, p: 25, k: 30 },
    { name: 'Ra hoa', minDays: 38, maxDays: 52, n: 25, p: 30, k: 35 },
    { name: 'Đâm tia – tạo quả', minDays: 53, maxDays: 82, n: 20, p: 35, k: 40 },
    { name: 'Phát triển quả – chín', minDays: 83, maxDays: 110, n: 15, p: 20, k: 25 },
  ],
  totalNPK: { n: 100, p: 125, k: 140 },
  totalDays: 110,
  careTips: {
    0: [
      { title: 'Tưới nước', desc: 'Giữ ẩm đều cho hạt nảy mầm' },
      { title: 'Đất', desc: 'Đất tơi xốp, thoát nước tốt' },
      { title: 'Bón phân', desc: 'Bón lót phân lân để rễ khỏe' },
      { title: 'Lưu ý', desc: 'Không tưới quá nhiều tránh thối hạt' },
    ],
    1: [
      { title: 'Tưới nước', desc: 'Tưới đều, duy trì độ ẩm 60-70%' },
      { title: 'Ánh sáng', desc: 'Cần đủ nắng 6-8 giờ/ngày' },
      { title: 'Bón phân', desc: 'Bón thúc NPK cân bằng' },
      { title: 'Phòng bệnh', desc: 'Kiểm tra rệp, sâu ăn lá' },
    ],
    2: [
      { title: 'Tưới nước', desc: 'Tưới đều, rất quan trọng cho đậu quả' },
      { title: 'Ánh sáng', desc: 'Đủ nắng để hoa nở đều' },
      { title: 'Bón phân', desc: 'Tăng lân + kali cho hoa đậu quả' },
      { title: 'Lưu ý', desc: 'Hoa mọc trên thân, không tưới lên hoa' },
    ],
    3: [
      { title: 'Tưới nước', desc: 'RẤT QUAN TRỌNG - giữ ẩm đều cho tia đâm xuống đất' },
      { title: 'Đất', desc: 'Xới nhẹ, vun gốc để tia dễ đâm xuống' },
      { title: 'Bón phân', desc: 'Bón kali + canxi để quả chắc' },
      { title: 'Lưu ý', desc: 'Giai đoạn nhạy cảm nhất với nước' },
    ],
    4: [
      { title: 'Tưới nước', desc: 'GIẢM NƯỚC để tránh thối củ' },
      { title: 'Kiểm tra', desc: 'Kiểm tra độ chín bằng cách nhổ thử' },
      { title: 'Thu hoạch', desc: 'Thu khi 70-80% vỏ có gân rõ' },
      { title: 'Phơi khô', desc: 'Phơi nắng 2-3 ngày sau thu hoạch' },
    ],
  },
};

// Get plant data by type - Luôn mặc định là Cây Ớt (Chili)
export const getPlantData = (plantType: string): PlantGrowthData => {
  const type = plantType ? plantType.toLowerCase() : '';
  if (type.includes('mustard') || type.includes('cải')) {
    return MUSTARD_DATA;
  }
  if (type.includes('peanut') || type.includes('lạc') || type.includes('đậu phộng')) {
    return PEANUT_DATA;
  }
  // Mặc định là Cây Ớt (Chili)
  return CHILI_DATA;
};

// Get current stage index based on age days
export const getCurrentStageIndex = (ageDays: number, stages: GrowthStage[]): number => {
  for (let i = 0; i < stages.length; i++) {
    if (ageDays >= stages[i].minDays && ageDays <= stages[i].maxDays) {
      return i;
    }
  }
  if (ageDays > stages[stages.length - 1].maxDays) {
    return stages.length - 1;
  }
  return 0;
};

// Plant type options for selection
export const PLANT_TYPE_OPTIONS = [
  { value: 'chili', label: 'Cây Ớt (Chili)', icon: '🌶️' },
  { value: 'mustard', label: 'Cải (Mustard)', icon: '🥬' },
  { value: 'peanut', label: 'Lạc / Đậu phộng (Peanut)', icon: '🥜' },
];
