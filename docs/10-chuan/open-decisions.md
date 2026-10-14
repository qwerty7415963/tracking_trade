# Các quyết định cần chốt trước production

> Ánh xạ từ plan §20 (Các quyết định cần chốt trước production).

Các quyết định sau **chưa được chốt** và phải được quyết định trước khi đưa hệ thống vào production. Bộ tài liệu hiện tại không tự quyết thay.

## Danh sách quyết định

| # | Quyết định | Trạng thái | Ghi chú |
|---|---|---|---|
| 1 | Phương thức Telegram collection và sender | ĐÃ CHỐT (ADR-0013) | Collection = `USER_SESSION` (nguồn là channel bên thứ ba, BOT không khả thi); sender reporting ưu tiên `BOT` |
| 2 | Quyền truy cập các Telegram channels | ĐÃ CHỐT một phần | Public: USER_SESSION join trực tiếp; private: cần invite link lưu trong `collection_config_json`. Cần số điện thoại + session cho collection |
| 3 | Phương thức truy cập X được phép và phương án fallback | CHƯA CHỐT | Không dùng API trả phí; spike Playwright trước |
| 4 | ~~Broker, MT5 environment và kết quả technical spike~~ | HỦY (pivot paper trading) | Bỏ hẳn MT5 — không còn broker, terminal, spike. Thay bằng nguồn giá Hyperliquid (quyết định 16) |
| 5 | Symbol mapping và timezone | CHƯA CHỐT | Ví dụ: `GOLD → XAUUSD.a` |
| 6 | Risk limits và yêu cầu SL | CHƯA CHỐT | Config theo tài khoản |
| 7 | Policy cho từng loại update | CHƯA CHỐT | TP1, cancel setup, close all... |
| 8 | Người có quyền approve và bật/tắt kill switch | ĐÃ CHỐT | Duy nhất 1 biến env `OPERATOR_USERNAMES` (comma-separated); username thuộc danh sách mới được approve/kill switch |
| 9 | Quy tắc xử lý Telegram publication UNKNOWN | CHƯA CHỐT | Tránh bài trùng |
| 10 | Thời hạn lưu raw messages, screenshots, audit logs và backups | ĐÃ CHỐT | Retention **7 ngày** cho tất cả. Cảnh báo: audit log 7 ngày là giới hạn theo quyết định vận hành; hệ thống tự purge sau 7 ngày |
| 11 | Mẫu bài đăng Telegram khi vào lệnh | ĐÃ CHỐT | Khung `Direction Instrument - status` + Entry/SL/TP + tên nguồn + URL nguồn + screenshot; limit/filled/tp/sl/close chung 1 khung; update reply bài đầu; direction hiển thị Long/Short |
| 12 | Danh mục operator bot commands | ĐÃ CHỐT | Lệnh approve/reject/open/close/positions/account/mode/deposit/withdraw/reset/review + kill switch; nút inline Approve/Reject cho review; chỉ private chat + `OPERATOR_USERNAMES` + rate limit; cấm qua bot: đổi risk limits, sửa template, xóa dữ liệu, deploy |
| 13 | Ảnh báo cáo gen bằng code thay vì chụp MT5 | ĐÃ CHỐT | FloatingPnLCardRenderer (HTML/CSS + Playwright, 1280×180); local volume + retention 7 ngày; API async BullMQ; bỏ hẳn chụp màn hình MT5 |
| 14 | Nơi chứa backup offsite | ĐÃ CHỐT | Máy local operator, mô hình pull (scp repo restic mã hóa); restic password operator tự giữ; drill restore hàng tháng |
| 15 | Mô hình deploy production | ĐÃ CHỐT | B: Actions SSH vào VPS, build tại chỗ khi merge `main` (gate CI trước, rollback tự động); GHCR dời lại sau |
| 16 | Nguồn giá + phạm vi symbol | ĐÃ CHỐT | Hyperliquid `meta`/`allMids` public (không key); mapping data-driven từ universe (vàng → `PAXG` đã verify live); không match → review |
| 17 | Virtual account | ĐÃ CHỐT | Cross margin, đòn bẩy mặc định x10 (1..50); MVP chỉ PnL + margin ratio + liquidation xấp xỉ (chưa fee/funding) |
| 18 | Mode mở lệnh | ĐÃ CHỐT | `APPROVE` (mặc định, approve = mở) / `AUTO` (tự mở khi đủ field); đổi qua API + bot `/mode` |
| 19 | Multi-TP | ĐÃ CHỐT | TP1 đóng 50%, còn lại chia đều; TP duy nhất đóng 100%; SL đóng hết phần còn lại |
| 20 | Review mơ hồ | ĐÃ CHỐT | Hỏi operator qua noti + nút inline Approve/Reject; private-chat + allowlist + rate limit |

## Kế hoạch triển khai theo phase

| Phase | Công việc | Gate |
|---|---|---|
| 0 | ~~MT5 Docker technical spike~~ | HỦY (pivot paper trading) |
| 1 | Foundation: repo, API, DB, Redis, auth, audit, CI | CI xanh |
| 2 | Source CRUD, Telegram/X ingestion, dedupe | Connector health và failure isolation pass |
| 3 | Parser, matching, signal versions, approval | Không mở khi thiếu field hoặc approval stale |
| 4 | Virtual trading: market-data, account, risk, multi-TP/SL | Demo E2E pass (mở → TP1 → TP2 → báo cáo) |
| 5 | Card gen, sender/destination/template, replies, operator bot | Publication và reply đúng |
| 6 | Monitoring, backup/restore, deploy/rollback | Recovery test pass |

## Liên kết tài liệu

- Definition of Done: [definition-of-done.md](definition-of-done.md)
- Acceptance tests: [09-kiem-thu/acceptance-tests.md](../09-kiem-thu/acceptance-tests.md)
