# MT5 Docker Technical Spike

> Ánh xạ từ plan §14 (Rủi ro kỹ thuật: MT5 chạy trong Docker).

## 1. Vấn đề

MT5 terminal là ứng dụng native Windows. Chạy trong **Linux Docker qua Wine/Xvfb** có thể không ổn định. Mô hình **một VPS tất cả trong Docker** không được giả định là hoạt động nếu chưa kiểm chứng.

## 2. Technical spike — các hạng mục bắt buộc

Phải chứng minh trước khi phụ thuộc:

- **Terminal tự khởi động** sau reboot.
- **Demo login** hoạt động.
- **EA/bridge duy trì heartbeat**.
- **Reconnect không tạo lệnh trùng**.
- **Screenshot** hoạt động ở resolution cố định.
- **Command journal phục hồi** sau crash.
- Có thể **truy vấn trạng thái broker** sau timeout.

## 3. Các phương án fallback nếu spike thất bại

- Cân nhắc **Windows VPS/native MT5**.
- Hoặc **tách bridge sang Windows host** (MT5 chạy native, backend chạy Linux).

## 4. Gate

Spike **pass** khi: restart, reconnect, screenshot và duplicate prevention đều đạt.

## 5. Liên kết tài liệu

- Kiến trúc deploy: [docker-cicd.md](docker-cicd.md)
- Bridge/EA: [04-risk-execution/mt5-bridge.md](../04-risk-execution/mt5-bridge.md)
- Recovery: [recovery.md](recovery.md)
