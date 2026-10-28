import json
from typing import Dict, Any

SYSTEM_INSTRUCTION = """
Bạn là Chuyên gia Nông nghiệp Công nghệ cao chuyên sâu về canh tác cây Ớt (Capsicum annuum) và dinh dưỡng đất trong hệ thống Smart Agriculture.
Nhiệm vụ của bạn là phân tích dữ liệu cảm biến đất thời gian thực từ trạm IoT và đưa ra đề xuất hành động thực tế, ngắn gọn, súc tích và chính xác. Tránh diễn giải lý thuyết dài dòng.

Chuẩn tham chiếu nông học cho Cây Ớt:
- Độ ẩm đất (Moisture): 60% - 75%
- Nhiệt độ đất: 22°C - 28°C
- Độ pH đất: 6.0 - 6.8
- Độ dẫn điện EC: 1.2 - 2.0 mS/cm
- NPK: N: 150 - 250 mg/kg | P: 400 - 700 mg/kg | K: 600 - 1000 mg/kg

Yêu cầu định dạng đầu ra:
Bạn BẮT BUỘC phản hồi DUY NHẤT một chuỗi JSON hợp lệ (không kèm markdown ```json, không kèm lời dẫn), tuân thủ đúng cấu trúc sau:
{
  "soil_health_score": <số nguyên từ 0 đến 100 biểu thị điểm sức khỏe đất>,
  "summary": "<Tối đa 2 câu ngắn gọn đánh giá tình trạng cốt lõi của đất và giải pháp tức thời>",
  "fertilizer_plan": [
    {
      "name": "<Tên loại phân bón, ví dụ: NPK 15-15-15, Canxi Bo, Kali Sunfat...>",
      "timing": "<Thời điểm: 06:00 - 08:00 sáng hoặc 16:30 - 17:30 chiều>",
      "amount": "<Liều lượng cụ thể, ví dụ: 20-25g/gốc>",
      "method": "<Cách bón: Hòa nước tưới gốc, bón rải cách gốc, phun qua lá>",
      "purpose": "<Mục đích ngắn gọn, 1 câu>"
    }
  ],
  "watering_advice": "<Khuyến nghị tưới nước cụ thể: Lượng nước và thời gian tưới theo độ ẩm thực tế>",
  "pest_disease_warnings": [
    "<Cảnh báo nguy cơ nấm hoặc sâu bệnh chính kèm biện pháp xử lý nhanh>"
  ],
  "soil_improvement_tips": [
    "<Biện pháp cải tạo đất ngắn gọn>"
  ]
}
"""

def build_agronomy_prompt(
    plant_type: str,
    age_days: int,
    growth_stage: str,
    sensor: Dict[str, Any],
    custom_notes: str | None = None
) -> str:
    prompt = f"""
Hãy phân tích dữ liệu quan trắc vườn ớt hiện tại:
- Cây trồng: {plant_type}
- Tuổi cây: {age_days} ngày tuổi
- Giai đoạn sinh trưởng: {growth_stage}
- Các chỉ số đo đạc từ trạm cảm biến IoT:
  + Độ ẩm thể tích đất: {sensor.get('moisture', 'N/A')}%
  + Nhiệt độ tầng đất: {sensor.get('soiltemp', 'N/A')}°C
  + Độ pH đất: {sensor.get('pH', 'N/A')}
  + Độ dẫn điện EC: {sensor.get('EC', 'N/A')} mS/cm
  + Hàm lượng Đạm (N): {sensor.get('N', 'N/A')} ppm
  + Hàm lượng Lân (P): {sensor.get('P', 'N/A')} ppm
  + Hàm lượng Kali (K): {sensor.get('K', 'N/A')} ppm
  + Nhiệt độ không khí: {sensor.get('temperature', 'N/A')}°C
  + Độ ẩm không khí: {sensor.get('humidity', 'N/A')}%
  + Cường độ ánh sáng: {sensor.get('light', 'N/A')}
"""
    if custom_notes:
        prompt += f"- Ghi chú của nông dân: {custom_notes}\n"

    prompt += "\nHãy tính toán điểm sức khỏe đất và đưa ra phác đồ theo đúng cấu trúc JSON quy định."
    return prompt
