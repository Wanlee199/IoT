# Hệ thống Giám sát & Cảnh báo IoT (ESP32 · HC-SR04 & PIR · ThingSpeak Live)

> **Báo cáo Bài tập lớn Giữa kỳ – Môn IoT và Ứng dụng (PTIT)**  
> **Lớp:** D24TXCN05-K – **Nhóm 10**  
> **Thành viên:** Đỗ Thị Hằng, Nguyễn Hoàng Khôi, Nguyễn Ngọc Mạnh, Lê Đức Minh Quân

---

## 📌 Giới thiệu Dự án
Ứng dụng web giám sát và điều khiển trực tiếp qua **ThingSpeak** cho hệ thống 2 cảm biến (**HC-SR04** đo khoảng cách siêu âm và **PIR** phát hiện chuyển động hồng ngoại), tích hợp cơ cấu điều khiển **Còi thông minh kiểu Smartkey xe máy** (mặc định Auto, tắt còi tạm thời khi đang báo động, hoặc kích hoạt kêu 2–3 giây tìm xe khi còi đang tắt).

---

## ✨ Các tính năng chính

### 1. Đồng bộ Dữ liệu Trực tiếp từ ThingSpeak (Channel `3576953`)
- Tự động đọc trực tiếp dữ liệu đầy đủ của cả 2 cảm biến và trạng thái mạch từ ThingSpeak:
  - `field1`: Cảm biến PIR (`0`: Yên tĩnh, `1`: Có chuyển động)
  - `field2`: Khoảng cách HC-SR04 (`cm`, giá trị `-1` hiển thị Ngoài tầm)
  - `field3`: Trạng thái Đèn thực tế trên mạch (`0`: Tắt, `1`: Bật)
  - `field4`: Trạng thái Còi thực tế trên mạch (`0`: Tắt, `1`: Đang kêu)
  - `field5`: Lệnh điều khiển Đèn (`0`/`1`)
  - `field6`: Lệnh điều khiển Còi (`0`/`1`)

### 2. Điều khiển Manual kiểu Smartkey xe máy (Mặc định AUTO)
- **Chế độ mặc định `AUTO`**: Tự động hiển thị và cảnh báo theo dữ liệu cảm biến từ ThingSpeak.
- **Khi còi đang kêu / báo động**: Nút chuyển sang `🔕 Tắt còi tạm thời (Mute)` — bấm để ngắt còi tạm thời và gửi lệnh `field6=0` lên ThingSpeak (có nút `↩ Về Auto` hoặc tự động quay về Auto khi hết nguy hiểm).
- **Khi còi đang tắt**: Nút hiển thị `📢 Kêu còi tìm xe (2,5s)` (chọn được `2s / 2,5s / 3s`) — bấm để gửi `field6=1`, phát tiếng còi định vị trên trình duyệt và tự động ngắt về `AUTO` (`field6=0`) sau 2–3 giây.
- **Hàng đợi xử lý giới hạn 15 giây của ThingSpeak**: Tự động chờ cooldown 15s nếu gửi hai lệnh liên tiếp (như `field6=1` rồi `field6=0`) để không bị mất lệnh.

### 3. Đồ thị, Thống kê & Xuất CSV
- **Line Chart kép (Dual-Axis)**: Khoảng cách HC-SR04 (cm) và tín hiệu PIR (`0`/`1`) theo thời gian thực.
- **Bar Chart & Doughnut Chart**: Phân bố khoảng cách, số lần ngoài tầm, số lượt PIR phát hiện và tỉ lệ trạng thái hệ thống.
- **Bảng 20 bản ghi mới nhất & Xuất CSV**: Xuất toàn bộ dữ liệu 2 cảm biến và lệnh điều khiển từ ThingSpeak ra file CSV chuẩn UTF-8 BOM.

---

## 🚀 Hướng dẫn Chạy ứng dụng
1. Mở trực tiếp file `index.html` bằng trình duyệt web (Chrome, Edge, Firefox...) hoặc chạy qua web server tĩnh (`python -m http.server`).
2. Ứng dụng tự động kết nối và đọc dữ liệu từ ThingSpeak Channel `3576953`.
