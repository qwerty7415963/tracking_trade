# MT5 Docker Technical Spike

> Ánh xạ từ plan §14 (Rủi ro kỹ thuật: MT5 chạy trong Docker).

## 1. Vấn đề

MT5 terminal là ứng dụng native Windows. Chạy trong **Linux Docker qua Wine/Xvfb** có thể không ổn định. Mô hình **một VPS tất cả trong Docker** không được giả định là hoạt động nếu chưa kiểm chứng.

**Quyết định môi trường (ĐÃ CHỐT):** Linux Docker + Wine. Fallback: Windows host tách riêng (backend giữ nguyên nhờ bridge outbound — xem ADR-0007).

## 2. Chính sách ghim version (bắt buộc)

Cộng đồng 2026 vẫn báo MT5 gãy trên Wine theo version (crash sau update OS/Wine, MT5 tự update phá tương thích):

- **Wine pin exact** trong Dockerfile (không `latest`), ghi version vào docs khi spike pass.
- **Hoãn MT5 auto-update**: test bản build mới ở môi trường tách biệt trước khi cho terminal production update; giám sát build version qua heartbeat.
- **Giám sát**: heartbeat EA mất quá ngưỡng → cảnh báo + auto-restart container; mọi reconnect đều đi qua reconciliation (không lệnh trùng).
- Mọi thay đổi version Wine/MT5 đều ghi lại ngày + kết quả kiểm thử.

## 3. Technical spike — các bước chạy

| Bước | Hạng mục | Cách kiểm chứng |
|---|---|---|
| 1 | Dựng image | Base Ubuntu/Debian + Wine pinned + Xvfb + script `mt5linux.sh` của MetaQuotes; build lại được từ Dockerfile |
| 2 | Demo login | Login `vantagemarkets-demo` bằng creds `.env`; quotes chảy về |
| 3 | EA heartbeat | Cài EA Bridge, allow-list URL backend; heartbeat đều lên backend |
| 4 | Reboot | Restart container → terminal tự lên, heartbeat trở lại, **không lệnh trùng** |
| 5 | Crash | Kill process giả crash → journal phục hồi, command giữ UNKNOWN |
| 6 | Timeout | Giả timeout sau OPEN → query positions/orders/deals đối chiếu đúng |
| 7 | Ghi kết quả | Pass/fail từng hạng mục + version Wine/MT5 ghi vào docs |

Gate **pass** khi cả 7 bước đạt. Fail → kích hoạt fallback: Windows VPS/native MT5, hoặc tách bridge sang Windows host (MT5 native, backend Linux).

> Ảnh báo cáo **gen bằng code** (FloatingPnLCardRenderer), không chụp màn hình MT5 — hạng mục "screenshot ở resolution cố định" đã bỏ.

## 4. Liên kết tài liệu

- Kiến trúc deploy: [docker-cicd.md](docker-cicd.md)
- Bridge/EA: [04-risk-execution/mt5-bridge.md](../04-risk-execution/mt5-bridge.md)
- Recovery: [recovery.md](recovery.md)
