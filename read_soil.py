import time
import minimalmodbus
import serial

# Cấu hình chuẩn đã quét được của cảm biến
PORT = '/dev/ttyUSB0'
SLAVE_ID = 2
BAUDRATE = 9600

instrument = minimalmodbus.Instrument(PORT, SLAVE_ID)
instrument.serial.baudrate = BAUDRATE
instrument.serial.bytesize = 8
instrument.serial.parity = serial.PARITY_NONE
instrument.serial.stopbits = 1
instrument.serial.timeout = 0.5
instrument.mode = minimalmodbus.MODE_RTU
instrument.clear_buffers_before_each_transaction = True


def to_signed_16(val):
    """Chuyển số nguyên 16-bit không dấu sang có dấu (dành cho Nhiệt độ âm)"""
    return val - 65536 if val >= 32768 else val


print(f"Đang đọc dữ liệu cảm biến đất (Slave ID: {SLAVE_ID}, Baud: {BAUDRATE})...")
print("-" * 65)

try:
    while True:
        # Đọc 8 thanh ghi đầu tiên (từ 0x0000 đến 0x0007) để xem toàn bộ dữ liệu
        raw = instrument.read_registers(
            registeraddress=0, number_of_registers=8, functioncode=3
        )

        # In mảng dữ liệu thô để dễ đối chiếu
        print(f"Raw Registers [0..7]: {raw}")

        # Quy đổi theo chuẩn thanh ghi phổ biến nhất (0 -> 6):
        humidity = raw[0] / 10.0  # Độ phân giải 0.1%
        temperature = to_signed_16(raw[1]) / 10.0  # Độ phân giải 0.1°C
        ec = raw[2]  # uS/cm

        # Tự động nhận diện độ phân giải pH (0.01 hay 0.1)
        ph = raw[3] / 100.0 if raw[3] > 140 else raw[3] / 10.0

        nitrogen = raw[4]  # mg/kg
        phosphorus = raw[5]  # mg/kg
        potassium = raw[6]  # mg/kg

        print(
            f"-> Độ ẩm: {humidity:.1f}% | Nhiệt độ: {temperature:.1f}°C | EC:"
            f" {ec} uS/cm | pH: {ph:.2f}"
        )
        print(
            f"-> NPK  : N = {nitrogen} mg/kg | P = {phosphorus} mg/kg | K ="
            f" {potassium} mg/kg"
        )
        print("-" * 65)

        time.sleep(2)

except KeyboardInterrupt:
    print("\nĐã dừng đọc cảm biến.")
except Exception as e:
    print(f"Lỗi giao tiếp: {e}")
