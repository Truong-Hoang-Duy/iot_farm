import time
from smbus2 import SMBus, i2c_msg

# Chân 27 (SDA) và 28 (SCL) trên Jetson Nano tương ứng với /dev/i2c-0
I2C_BUS = 0
DHT20_ADDR = 0x38


def calc_crc8(data):
    """Tính toán mã kiểm tra lỗi CRC-8 (đa thức 0x31, khởi tạo 0xFF)."""
    crc = 0xFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x80:
                crc = ((crc << 1) ^ 0x31) & 0xFF
            else:
                crc = (crc << 1) & 0xFF
    return crc


def init_dht20(bus):
    """Kiểm tra trạng thái hiệu chuẩn của DHT20 sau khi cấp nguồn."""
    time.sleep(0.1)  # Đợi tối thiểu 100ms sau khi cấp nguồn
    status = bus.read_byte_data(DHT20_ADDR, 0x71)
    if (status & 0x18) != 0x18:
        print("Đang khởi tạo lại thanh ghi cảm biến DHT20...")
        bus.write_i2c_block_data(DHT20_ADDR, 0xBE, [0x08, 0x00])
        time.sleep(0.01)


def read_dht20(bus):
    """Kích hoạt đo và đọc dữ liệu Nhiệt độ (C), Độ ẩm (%RH) từ DHT20."""
    # 1. Gửi lệnh bắt đầu đo: 0xAC cùng 2 byte tham số [0x33, 0x00]
    bus.write_i2c_block_data(DHT20_ADDR, 0xAC, [0x33, 0x00])
    time.sleep(0.08)  # Đợi tối thiểu 80ms để hoàn tất chuyển đổi ADC

    # 2. Kiểm tra bit Busy (bit 7 của byte trạng thái phải về 0)
    retry = 0
    while (bus.read_byte(DHT20_ADDR) & 0x80) != 0:
        time.sleep(0.01)
        retry += 1
        if retry >= 10:
            raise TimeoutError("Cảm biến DHT20 phản hồi quá thời gian chờ.")

    # 3. Đọc trực tiếp 7 byte dữ liệu (6 byte dữ liệu + 1 byte CRC)
    read_msg = i2c_msg.read(DHT20_ADDR, 7)
    bus.i2c_rdwr(read_msg)
    data = list(read_msg)

    # 4. Kiểm tra toàn vẹn dữ liệu bằng CRC8
    if calc_crc8(data[:6]) != data[6]:
        raise ValueError("Lỗi CRC: Dữ liệu truyền qua I2C bị nhiễu.")

    # 5. Giải mã dữ liệu thô 20-bit theo datasheet của DHT20
    raw_humidity = (data[1] << 12) | (data[2] << 4) | (data[3] >> 4)
    humidity = (raw_humidity / 1048576.0) * 100.0

    raw_temp = ((data[3] & 0x0F) << 16) | (data[4] << 8) | data[5]
    temperature = (raw_temp / 1048576.0) * 200.0 - 50.0

    return round(temperature, 2), round(humidity, 2)


def main():
    print(f"Đang kết nối DHT20 trên I2C Bus {I2C_BUS} (Chân 27, 28)...")
    try:
        with SMBus(I2C_BUS) as bus:
            init_dht20(bus)
            while True:
                try:
                    temp, hum = read_dht20(bus)
                    print(f"Nhiệt độ: {temp:.2f} °C | Độ ẩm: {hum:.2f} %")
                except (TimeoutError, ValueError) as err:
                    print(f"Cảnh báo đọc mẫu: {err}")

                # DHT20 khuyến nghị chu kỳ đọc cách nhau ít nhất 1.5 - 2 giây
                time.sleep(2)

    except FileNotFoundError:
        print(f"Lỗi: Không tìm thấy /dev/i2c-{I2C_BUS}. Hãy kiểm tra cấu hình I2C.")
    except PermissionError:
        print("Lỗi quyền truy cập: Hãy chạy với 'sudo' hoặc thêm user vào nhóm 'i2c'.")
    except OSError as e:
        print(f"Lỗi giao tiếp I2C (kiểm tra lại dây nối chân 27/28 và nguồn 3.3V): {e}")
    except KeyboardInterrupt:
        print("\nĐã dừng chương trình.")


if __name__ == "__main__":
    main()
