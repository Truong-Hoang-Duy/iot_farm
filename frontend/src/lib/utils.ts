import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Chuyển đổi chuỗi ngày YYYY-MM-DD hoặc Date object sang định dạng chuẩn ngày/tháng/năm (dd/MM/yyyy)
 */
export function formatDateVN(dateInput?: string | number | Date | null): string {
  if (!dateInput) return '';
  if (typeof dateInput === 'string') {
    const match = dateInput.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
      const [, y, m, d] = match;
      return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    }
  }
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Chuyển đổi timestamp sang định dạng chuẩn ngày tháng năm: HH:mm dd/MM/yyyy
 */
export function formatDateTimeVN(timeInput?: string | number | Date | null): string {
  if (!timeInput) return '';
  if (typeof timeInput === 'string') {
    // Dạng "HH:MM YYYY-MM-DD"
    const match1 = timeInput.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match1) {
      const [, time, y, m, d] = match1;
      return `${time} ${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    }
    // Dạng "YYYY-MM-DD HH:MM"
    const match2 = timeInput.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)/);
    if (match2) {
      const [, y, m, d, time] = match2;
      return `${time} ${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    }
  }
  const d = new Date(timeInput);
  if (isNaN(d.getTime())) return String(timeInput);
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${time} ${day}/${month}/${year}`;
}
