import { DeviceControlsSection } from '@/components/settings/DeviceControlsSection';

export default function ControlsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display text-3xl font-bold">Điều khiển thiết bị</h1>
        <p className="text-muted-foreground mt-1">
          Quản lý đèn chiếu sáng và máy bơm nước theo chế độ tự động, lập lịch hoặc thủ công
        </p>
      </div>
      <DeviceControlsSection />
    </div>
  );
}
