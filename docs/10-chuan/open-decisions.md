# Các quyết định cần chốt trước production

> Ánh xạ từ plan §20 (Các quyết định cần chốt trước production).

Các quyết định sau **chưa được chốt** và phải được quyết định trước khi đưa hệ thống vào production. Bộ tài liệu hiện tại không tự quyết thay.

## Danh sách quyết định

| # | Quyết định | Trạng thái | Ghi chú |
|---|---|---|---|
| 1 | Phương thức Telegram collection và sender | ĐÃ CHỐT (ADR-0013) | Collection = `USER_SESSION` (nguồn là channel bên thứ ba, BOT không khả thi); sender reporting ưu tiên `BOT` |
| 2 | Quyền truy cập các Telegram channels | ĐÃ CHỐT một phần | Public: USER_SESSION join trực tiếp; private: cần invite link lưu trong `collection_config_json`. Cần số điện thoại + session cho collection |
| 3 | Phương thức truy cập X được phép và phương án fallback | CHƯA CHỐT | Không dùng API trả phí; spike Playwright trước |
| 4 | Broker, MT5 environment và kết quả technical spike | CHỐT một phần | Broker **Vantage Markets**, server `vantagemarkets-demo`, môi trường **demo**. Môi trường MT5: **Linux Docker + Wine** (ghim version; fallback Windows host nếu spike rớt). Còn mở duy nhất: **kết quả spike Phase 0** |
| 5 | Symbol mapping và timezone | CHƯA CHỐT | Ví dụ: `GOLD → XAUUSD.a` |
| 6 | Risk limits và yêu cầu SL | CHƯA CHỐT | Config theo tài khoản |
| 7 | Policy cho từng loại update | CHƯA CHỐT | TP1, cancel setup, close all... |
| 8 | Người có quyền approve và bật/tắt kill switch | ĐÃ CHỐT | Duy nhất 1 biến env `OPERATOR_USERNAMES` (comma-separated); username thuộc danh sách mới được approve/kill switch |
| 9 | Quy tắc xử lý Telegram publication UNKNOWN | CHƯA CHỐT | Tránh bài trùng |
| 10 | Thời hạn lưu raw messages, screenshots, audit logs và backups | ĐÃ CHỐT | Retention **7 ngày** cho tất cả. Cảnh báo: audit log 7 ngày là giới hạn theo quyết định vận hành; hệ thống tự purge sau 7 ngày |
| 11 | Mẫu bài đăng Telegram khi vào lệnh | ĐÃ CHỐT | Khung `Direction Instrument - status` + Entry/SL/TP + tên nguồn + URL nguồn + screenshot; limit/filled/tp/sl/close chung 1 khung; update reply bài đầu; direction hiển thị Long/Short |
| 12 | Danh mục operator bot commands | ĐÃ CHỐT | Lệnh xem + approve/reject + kill + `/resume` kèm `/confirm` 2 bước + bật/tắt nguồn + reconcile; chỉ private chat + `OPERATOR_USERNAMES`; cấm qua bot: đổi risk limits, sửa template, xóa dữ liệu, deploy |
| 13 | Ảnh báo cáo gen bằng code thay vì chụp MT5 | ĐÃ CHỐT | FloatingPnLCardRenderer (HTML/CSS + Playwright, 1280×180); local volume + retention 7 ngày; API async BullMQ; bỏ hẳn chụp màn hình MT5 |
| 14 | Nơi chứa backup offsite | ĐÃ CHỐT | Máy local operator, mô hình pull (scp repo restic mã hóa); restic password operator tự giữ; drill restore hàng tháng |
| 15 | Mô hình deploy production | ĐÃ CHỐT | B: Actions SSH vào VPS, build tại chỗ khi merge `main` (gate CI trước, rollback tự động); GHCR dời lại sau |

## Kế hoạch triển khai theo phase

| Phase | Công việc | Gate |
|---|---|---|
| 0 | MT5 Docker technical spike | Restart, reconnect, screenshot và duplicate prevention pass |
| 1 | Foundation: repo, API, DB, Redis, auth, audit, CI | CI xanh |
| 2 | Source CRUD, Telegram/X ingestion, dedupe | Connector health và failure isolation pass |
| 3 | Parser, matching, signal versions, approval | Không execute khi thiếu field hoặc approval stale |
| 4 | MT5 execution, risk engine, bridge, reconciliation | Demo E2E pass; timeout không tạo lệnh trùng |
| 5 | Screenshot, sender/destination/template, replies | Publication và reply đúng |
| 6 | Monitoring, backup/restore, deploy/rollback | Recovery test pass |

## Liên kết tài liệu

- Definition of Done: [definition-of-done.md](definition-of-done.md)
- Acceptance tests: [09-kiem-thu/acceptance-tests.md](../09-kiem-thu/acceptance-tests.md)
