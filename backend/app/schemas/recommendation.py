from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class SensorReading(BaseModel):
    moisture: Optional[float] = Field(None, description="Độ ẩm đất (%)")
    soiltemp: Optional[float] = Field(None, description="Nhiệt độ đất (°C)")
    pH: Optional[float] = Field(None, description="Độ pH đất")
    EC: Optional[float] = Field(None, description="Độ dẫn điện EC (mS/cm)")
    N: Optional[float] = Field(None, description="Đạm N (ppm hoặc mg/kg)")
    P: Optional[float] = Field(None, description="Lân P (ppm hoặc mg/kg)")
    K: Optional[float] = Field(None, description="Kali K (ppm hoặc mg/kg)")
    temperature: Optional[float] = Field(None, description="Nhiệt độ không khí (°C)")
    humidity: Optional[float] = Field(None, description="Độ ẩm không khí (%)")

class AdvisorRequest(BaseModel):
    plant_type: Optional[str] = Field(None, description="Loại cây trồng")
    age_days: Optional[int] = Field(None, description="Tuổi cây thực tế (ngày)")
    growth_stage: Optional[str] = Field(None, description="Giai đoạn sinh trưởng thực tế")
    sensor_reading: Optional[SensorReading] = Field(None, description="Dữ liệu quan trắc đất hiện tại")
    custom_notes: Optional[str] = Field(None, description="Ghi chú thêm về vườn")

class FertilizerItem(BaseModel):
    name: str = Field(..., description="Tên loại phân bón")
    timing: str = Field(..., description="Thời điểm bón tối ưu trong ngày")
    amount: str = Field(..., description="Liều lượng khuyến nghị (ví dụ: 50g/cây)")
    method: str = Field(..., description="Phương pháp bón (bón gốc, hòa tưới, phun lá)")
    purpose: str = Field(..., description="Mục đích bổ sung dinh dưỡng")

class AdvisorResponse(BaseModel):
    status: str = Field("success", description="Trạng thái phân tích")
    plant_type: Optional[str] = Field(None, description="Loại cây trồng")
    age_days: Optional[int] = Field(None, description="Tuổi cây thực tế")
    growth_stage: Optional[str] = Field(None, description="Giai đoạn sinh trưởng")
    soil_health_score: int = Field(..., description="Điểm số sức khỏe đất (0 - 100)")
    summary: str = Field(..., description="Đánh giá tổng quan từ chuyên gia AI")
    fertilizer_plan: List[FertilizerItem] = Field(default_factory=list, description="Phác đồ bón phân")
    watering_advice: str = Field(..., description="Hướng dẫn tưới nước tối ưu")
    pest_disease_warnings: List[str] = Field(default_factory=list, description="Cảnh báo nguy cơ sâu bệnh hại")
    soil_improvement_tips: List[str] = Field(default_factory=list, description="Mẹo cải tạo đất")
    ai_model_used: str = Field("Google Gemini 2.5 Flash", description="Mô hình AI xử lý")
    timestamp: str = Field(..., description="Thời điểm sinh đề xuất")
    saved_at: Optional[str] = Field(None, description="Thời điểm lưu vào DB")
    sensor_snapshot: Optional[Dict[str, Any]] = Field(None, description="Bản chụp cảm biến lúc phân tích")

class ChatMessage(BaseModel):
    role: str = Field("user", description="user hoặc model")
    content: str = Field(..., description="Nội dung tin nhắn")

class ChatRequest(BaseModel):
    message: str = Field(..., description="Câu hỏi của nông dân")
    sensor_reading: Optional[SensorReading] = Field(None, description="Ngữ cảnh đất hiện tại")
    history: List[ChatMessage] = Field(default_factory=list, description="Lịch sử hội thoại")

class ChatResponse(BaseModel):
    reply: str = Field(..., description="Câu trả lời từ trợ lý AI")
    timestamp: str = Field(..., description="Thời gian phản hồi")
