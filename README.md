# Hệ thống Giám sát & Cảnh báo IoT (ESP32 · HC-SR04 & PIR)

> **Báo cáo Bài tập lớn Giữa kỳ – Môn IoT và Ứng dụng (PTIT)**  
> **Lớp:** D24TXCN05-K – **Nhóm 10**  
> **Thành viên:** Đỗ Thị Hằng, Nguyễn Hoàng Khôi, Nguyễn Ngọc Mạnh, Lê Đức Minh Quân

---

## 📌 Giới thiệu Dự án
Dự án xây dựng ứng dụng web IoT mô phỏng và trực quan hóa dữ liệu thu thập từ **2 cảm biến** (Cảm biến khoảng cách siêu âm **HC-SR04** và Cảm biến chuyển động hồng ngoại **PIR**), tích hợp cơ cấu điều khiển **Còi thông minh (Smart Buzzer)** dạng tìm xe ô tô và lưu trữ dữ liệu lên nền tảng đám mây **ThingSpeak**.

---

## ✨ Các tính năng nổi bật

### 1. Giám sát Đồng thời 2 Cảm biến
- **HC-SR04**: Đo khoảng cách vật thể phía trước (2 – 400 cm).
- **PIR (HC-SR501)**: Phát hiện chuyển động của người/vật thể trong khu vực giám sát (0: Yên tĩnh, 1: Có chuyển động).
- **Điều khiển Bật/Tắt Cảm biến bằng tay**: Cho phép bật/tắt độc lập từng cảm biến hoặc kích hoạt chuyển động tức thì để kiểm thử.

### 2. Cơ chế Còi thông minh kiểu Tìm xe ô tô (Adaptive Smart Buzzer)
- **Khi đang có báo động (Nguy hiểm)**: Nút bấm tự chuyển sang trạng thái `🔕 Tắt còi tạm thời (Mute)` – bấm nút lập tức ngắt tiếng còi hú để tránh gây ồn, hệ thống chuyển sang cảnh báo im lặng (đèn vàng/chú ý).
- **Khi đang bình thường / an toàn**: Nút bấm hiển thị `📢 Thử còi / Tìm xe (Bíp ngắn)` – bấm nút còi sẽ chỉ phát tín hiệu bíp ngắn (1.5 giây) rồi tự động tắt, kèm nháy đèn xanh lam định vị.

### 3. Đồ thị & Báo cáo Thống kê
- **Line Chart kép (Dual-Axis)**: Trục trái đo Cự ly (cm), Trục phải đo Logic PIR (0/1).
- **Bar Chart**: Phân bố cự ly theo các khoảng cự ly & số lượt phát hiện chuyển động.
- **Doughnut Chart**: Tỉ lệ các trạng thái hệ thống (An toàn, Chú ý, Nguy hiểm, Đã tắt tạm thời).
- **Khung Báo cáo Thống kê**: Tóm tắt tổng số lần báo động, số lần PIR kích hoạt, số lần tắt còi tạm thời, số lần tìm xe và tỷ lệ an toàn.
- **Xuất dữ liệu CSV**: Hỗ trợ xuất toàn bộ lịch sử mẫu đo ra file CSV chuẩn UTF-8 BOM hiển thị tiếng Việt trên Excel.

### 4. Tích hợp Cloud ThingSpeak
- Gửi dữ liệu định kỳ lên ThingSpeak qua API với 6 trường:
  - `field1`: Khoảng cách HC-SR04 (cm)
  - `field2`: Mức cảnh báo (0 An toàn, 1 Chú ý, 2 Nguy hiểm)
  - `field3`: Cảm biến PIR (0 Yên tĩnh, 1 Chuyển động)
  - `field4`: Trạng thái Còi (0 Tắt, 1 Hú, 2 Tắt tạm thời, 3 Tìm xe)
  - `field5`: Đèn LED (0 Tắt, 1 Bật)
  - `field6`: Khoảng cách trung bình chu kỳ (cm)
- Tải và xem lại 20 bản ghi mới nhất từ Cloud ngay trên web.

---

## 🚀 Hướng dẫn Chạy ứng dụng
1. Clone repository về máy:
   ```bash
   git clone https://github.com/Wanlee199/IoT.git
   ```
2. Mở file `index.html` trực tiếp bằng bất kỳ trình duyệt web nào (Chrome, Edge, Firefox...).
3. Không cần cài đặt server hay cấu hình phức tạp (chạy hoàn toàn Client-side với thư viện Chart.js qua CDN).

---

## 📂 Cấu trúc Thư mục
```
├── index.html               # Giao diện chính của ứng dụng
├── style.css                # Tùy biến kiểu dáng giao diện hiện đại & responsive
├── app.js                   # Logic mô phỏng 2 cảm biến, còi thông minh, Chart.js & ThingSpeak
├── Bao-cao-BT-giuaky.docx   # Báo cáo BTL chi tiết theo 10 bước thiết kế IoT
└── README.md                # Tài liệu hướng dẫn dự án
```
