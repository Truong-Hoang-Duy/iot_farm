#!/usr/bin/env bash
# =====================================================================
#  Cài đặt IoT Farm edge agent trên Jetson Nano
#  (JetPack 4.6 / Ubuntu 18.04 / Python 3.6)
#
#  Dùng:   cd edge && sudo ./install.sh [--no-start] [--skip-apt] [--set-timezone]
#    --no-start      chỉ cài, chưa khởi động service (để sửa config.ini trước)
#    --skip-apt      bỏ qua apt-get (máy không có mạng / đã cài rồi)
#    --set-timezone  đặt múi giờ hệ thống Asia/Ho_Chi_Minh (agent KHÔNG phụ thuộc TZ)
# =====================================================================
set -euo pipefail

EDGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="iot-farm-agent"
RUN_USER="${SUDO_USER:-$(id -un)}"
NO_START=0
SKIP_APT=0
SET_TZ=0

info() { echo -e "\033[32m[+]\033[0m $*"; }
warn() { echo -e "\033[33m[!]\033[0m $*"; }
fail() { echo -e "\033[31m[x]\033[0m $*"; exit 1; }

for arg in "$@"; do
  case "$arg" in
    --no-start) NO_START=1 ;;
    --skip-apt) SKIP_APT=1 ;;
    --set-timezone) SET_TZ=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) fail "Tham số không hợp lệ: $arg" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || fail "Hãy chạy bằng sudo:  sudo ./install.sh"
[ "$RUN_USER" != "root" ] || warn "Agent sẽ chạy bằng user root (nên chạy sudo từ user thường, vd: jetson)"
RUN_GROUP="$(id -gn "$RUN_USER")"
case "$EDGE_DIR" in
  *" "*) fail "Đường dẫn '$EDGE_DIR' có dấu cách – hãy đặt repo ở đường dẫn không có dấu cách (vd: ~/iot-farm)" ;;
esac
info "Thư mục agent: $EDGE_DIR | user chạy service: $RUN_USER:$RUN_GROUP"

# ---------------------------------------------------------------- 1. apt
if [ "$SKIP_APT" -eq 0 ]; then
  info "Cài gói hệ thống (python3-venv, pip, i2c-tools, sqlite3)..."
  apt-get update
  apt-get install -y python3 python3-pip python3-venv python3-dev i2c-tools sqlite3 ca-certificates
fi
PY="$(command -v python3)" || fail "Không tìm thấy python3"
info "Python hệ thống: $($PY --version 2>&1)"

# ---------------------------------------------------------------- 2. venv + pip
mkdir -p "$EDGE_DIR/data" "$EDGE_DIR/logs"
chown -R "$RUN_USER:$RUN_GROUP" "$EDGE_DIR"
if [ ! -x "$EDGE_DIR/.venv/bin/python" ]; then
  info "Tạo virtualenv (--system-site-packages để dùng Jetson.GPIO có sẵn của JetPack)..."
  sudo -u "$RUN_USER" "$PY" -m venv --system-site-packages "$EDGE_DIR/.venv"
fi
info "Cài thư viện Python (bản cuối còn hỗ trợ Python 3.6)..."
sudo -u "$RUN_USER" "$EDGE_DIR/.venv/bin/python" -m pip install --upgrade "pip<22" "setuptools<60" wheel
sudo -u "$RUN_USER" "$EDGE_DIR/.venv/bin/python" -m pip install -r "$EDGE_DIR/requirements.txt"

# ---------------------------------------------------------------- 3. nhóm quyền
info "Thêm $RUN_USER vào nhóm i2c, dialout (USB-RS485), gpio..."
for g in i2c dialout gpio; do
  getent group "$g" >/dev/null || groupadd -r -f "$g"
  usermod -aG "$g" "$RUN_USER"
done
# udev rule cho Jetson.GPIO (cần khi relay_enabled = true và chạy không phải root)
GPIO_RULES="$("$PY" - <<'EOF' 2>/dev/null || true
import os
try:
    import Jetson.GPIO as G
    p = os.path.join(os.path.dirname(G.__file__), "99-gpio.rules")
    print(p if os.path.exists(p) else "")
except Exception:
    print("")
EOF
)"
if [ -n "$GPIO_RULES" ] && [ ! -f /etc/udev/rules.d/99-gpio.rules ]; then
  info "Cài udev rule Jetson.GPIO: $GPIO_RULES"
  cp "$GPIO_RULES" /etc/udev/rules.d/99-gpio.rules
  udevadm control --reload-rules && udevadm trigger || true
fi

# ---------------------------------------------------------------- 4. kiểm tra phần cứng
if [ -e /dev/i2c-0 ]; then
  info "Có /dev/i2c-0 (chân 27 SDA / 28 SCL). Quét bus 0:"
  i2cdetect -y -r 0 || true
  if i2cdetect -y -r 0 2>/dev/null | grep -q " 38"; then
    info "Thấy DHT20 tại địa chỉ 0x38"
  else
    warn "Chưa thấy 0x38 trên bus 0 – kiểm tra dây DHT20 (VCC 3.3V, GND, SDA=27, SCL=28)"
  fi
else
  warn "Không thấy /dev/i2c-0 – kiểm tra JetPack / device-tree (sudo /opt/nvidia/jetson-io/jetson-io.py)"
fi
if ls /dev/ttyUSB* >/dev/null 2>&1; then
  info "Cổng USB-serial: $(ls /dev/ttyUSB* | tr '\n' ' ')"
else
  warn "Không thấy /dev/ttyUSB* – cắm bộ chuyển USB-RS485 của cảm biến CWT"
fi
if dpkg -l brltty 2>/dev/null | grep -q '^ii'; then
  warn "Gói brltty có thể chiếm /dev/ttyUSB0 (chip CH340/CH341). Nếu cổng biến mất: sudo apt-get remove -y brltty"
fi

# ---------------------------------------------------------------- 5. NTP
if systemctl is-active --quiet chrony 2>/dev/null || systemctl is-active --quiet ntp 2>/dev/null; then
  info "Đang dùng chrony/ntp để đồng bộ giờ – giữ nguyên"
else
  info "Bật đồng bộ giờ NTP (systemd-timesyncd)..."
  timedatectl set-ntp true || warn "timedatectl set-ntp lỗi"
  systemctl enable systemd-timesyncd >/dev/null 2>&1 || true
  systemctl restart systemd-timesyncd || warn "Không khởi động được systemd-timesyncd"
fi
if [ "$SET_TZ" -eq 1 ]; then
  timedatectl set-timezone Asia/Ho_Chi_Minh && info "Đã đặt múi giờ Asia/Ho_Chi_Minh"
fi
timedatectl status || true

# ---------------------------------------------------------------- 6. cấu hình
if [ ! -f "$EDGE_DIR/config.ini" ]; then
  cp "$EDGE_DIR/config.example.ini" "$EDGE_DIR/config.ini"
  warn "Đã tạo config.ini từ mẫu – HÃY SỬA db_url / api_key / email / password:  nano $EDGE_DIR/config.ini"
fi
chown "$RUN_USER:$RUN_GROUP" "$EDGE_DIR/config.ini"
chmod 600 "$EDGE_DIR/config.ini"

# ---------------------------------------------------------------- 7. systemd
UNIT="/etc/systemd/system/${SERVICE_NAME}.service"
sed -e "s|@RUN_USER@|${RUN_USER}|g" -e "s|@RUN_GROUP@|${RUN_GROUP}|g" -e "s|@EDGE_DIR@|${EDGE_DIR}|g" \
  "$EDGE_DIR/systemd/${SERVICE_NAME}.service" > "$UNIT"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
info "Đã cài service $UNIT (tự chạy khi khởi động, Restart=always)"

if [ "$NO_START" -eq 0 ]; then
  systemctl restart "$SERVICE_NAME"
  sleep 3
  systemctl --no-pager --lines=15 status "$SERVICE_NAME" || true
else
  warn "Chưa khởi động service (--no-start). Khi sẵn sàng: sudo systemctl start $SERVICE_NAME"
fi

cat <<EOF

==================== HOÀN TẤT ====================
Test phần cứng 1 lần :  sudo -u $RUN_USER $EDGE_DIR/.venv/bin/python $EDGE_DIR/run_agent.py --once
Xem log trực tiếp   :  journalctl -u $SERVICE_NAME -f      (hoặc tail -f $EDGE_DIR/logs/agent.log)
Khởi động lại       :  sudo systemctl restart $SERVICE_NAME
Lưu ý: nhóm i2c/dialout/gpio có hiệu lực ngay cho service; với shell của bạn cần đăng xuất/đăng nhập lại.
EOF
