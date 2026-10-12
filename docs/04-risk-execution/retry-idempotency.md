# Retry & Idempotency

> Ánh xạ từ plan §12 (Retry và idempotency).

## 1. Bảng tình huống xử lý

| Tình huống | Xử lý |
|---|---|
| Message trùng | Dedupe bằng source + external ID + revision/hash (khác source = không trùng, kể cả nội dung giống nhau) |
| Parse lại | Key gồm message ID + parser version + payload hash |
| Approval | Gắn với signal + exact version |
| Retry execution | Dùng cùng command ID/idempotency key |
| OPEN timeout | UNKNOWN và **reconcile trước khi retry** |
| Telegram timeout | Publication UNKNOWN; xử lý thận trọng để tránh bài trùng |
| Lỗi tạm thời | Exponential backoff + jitter, max attempts, DLQ |
| Lỗi vĩnh viễn | Không retry mù; báo operator |
| Update đồng thời | Serialize theo signal/position |
| Vị thế không rõ nguồn | Gắn cờ review; không tự đóng |

## 2. Nguyên tắc

- Hệ thống dùng **at-least-once delivery**, không exactly-once.
- Deduplicate dựa trên database constraints, **không chỉ dựa vào Redis/in-memory**.
- Mọi retry execution dùng **cùng idempotency key** — không tạo lệnh mới.
- **Không retry OPEN mù sau timeout**; phải reconcile với broker trước.
- Retry Telegram publication thận trọng để tránh **bài trùng**.
- Lỗi tạm thời: backoff + jitter + max attempts + DLQ.
- Lỗi vĩnh viễn: báo operator, không retry mù.

## 3. Liên kết tài liệu

- Timeout/reconcile: [mt5-bridge.md](mt5-bridge.md)
- ADR: [ADR-0006](../adr/ADR-0006-at-least-once-va-idempotency.md), [ADR-0005](../adr/ADR-0005-transactional-outbox.md)
- Publication rules: [07-reporting/telegram-reporting.md](../07-reporting/telegram-reporting.md)
