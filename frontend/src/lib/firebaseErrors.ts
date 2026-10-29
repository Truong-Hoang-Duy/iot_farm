// Chuẩn hóa thông báo lỗi Firebase (đặc biệt lỗi Security Rules – PERMISSION_DENIED)
import { toast } from '@/hooks/use-toast';

export function isPermissionDenied(error: unknown): boolean {
  if (!error) return false;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  const text = `${typeof code === 'string' ? code : ''} ${typeof message === 'string' ? message : ''}`.toLowerCase();
  return text.includes('permission_denied') || text.includes('permission denied') || text.includes('permission-denied');
}

/** Mô tả lỗi Firebase bằng tiếng Việt, dễ hiểu cho người dùng. */
export function describeFirebaseError(error: unknown): string {
  if (isPermissionDenied(error)) {
    return 'Không có quyền ghi dữ liệu (Firebase Security Rules từ chối). Hãy đăng nhập lại hoặc kiểm tra quyền tài khoản.';
  }
  const message = (error as { message?: unknown })?.message;
  if (typeof message === 'string' && message.toLowerCase().includes('network')) {
    return 'Mất kết nối mạng tới Firebase. Thay đổi sẽ được đồng bộ khi có mạng trở lại.';
  }
  if (typeof message === 'string' && message) return message;
  return 'Lỗi không xác định khi ghi lên Firebase.';
}

/** Hiển thị toast lỗi ghi Firebase. */
export function toastFirebaseWriteError(error: unknown, action = 'Không thể lưu thay đổi'): void {
  console.error(`[Firebase] ${action}:`, error);
  toast({
    title: isPermissionDenied(error) ? 'Bị từ chối quyền ghi' : action,
    description: describeFirebaseError(error),
    variant: 'destructive',
  });
}
