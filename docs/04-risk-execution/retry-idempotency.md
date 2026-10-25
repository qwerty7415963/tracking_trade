# Retry & Idempotency

> Ánh xạ từ plan §12 (Retry và idempotency).

## 1. Bảng tình huống xử lý

| Tình huống | Xử lý |
|---|---|
| Message trùng | Dedupe bằng source + external ID + revision/hash (khác source = không trùng, kể cả nội dung giống nhau) |
| Parse lại | Key gồm message ID + parser version + payload hash |
| Approval | Gắn với signal + exact version |
| Mở trùng | Cùng signal+version đang mở → trả vị thế hiện có, không tạo mới |
| Market data lỗi | Bỏ qua chu kỳ poll, không tác động vị thế |
| Telegram timeout | Publication UNKNOWN; xử lý thận trọng để tránh bài trùng |
| Update đến trước bài gốc | Giữ chờ retryable 5 phút (`ORIGINAL_NOT_PUBLISHED_YET`), đổi sang `RETRY_PENDING` trong lúc chờ, rồi đăng lẻ + audit `publication.orphaned` |
| Send job | 10 attempts, fixed backoff **60s** (~10 phút) — phải vượt hold 5 phút, nếu không card TP/SL bắn sớm chết vĩnh viễn |
| Send job hết attempts | Consumer `failed` ở lần cuối → `FINAL_FAILURE` (trước đây im lặng, row kẹt `PENDING` mãi) |
| Settle job (TP/SL) | 5 attempts × 30s, jobId dedupe `settle-<positionId>-TP-<i>` / `-SL`; **card trước, đóng sau** với giá đóng băng |
| Chọn kind card lúc dialog | Quét mọi publication `PENDING/RETRY_PENDING` của position, chỉ promote job **có `delayMs`** (đang delayed) — job TP/SL không delay không được chọn |
| BullMQ jobId | Custom job id **không được chứa `:`** (BullMQ ném lỗi) — prefix `render-`/`send-`/`settle-` |
| Lỗi tạm thời | Exponential backoff + jitter, max attempts, DLQ |
| Lỗi vĩnh viễn | Không retry mù; báo operator |
| Update đồng thời | Serialize theo signal/position |
| Thiếu quote | Từ chối mở/đóng, không đoán giá |

## 2. Nguyên tắc

- Hệ thống dùng **at-least-once delivery**, không exactly-once.
- Deduplicate dựa trên database constraints, **không chỉ dựa vào Redis/in-memory**.
- Mở lệnh idempotent theo signal+version — không tạo vị thế trùng.
- **Không đoán giá**: thiếu quote thì từ chối, không bịa entry/close.
- Retry Telegram publication thận trọng để tránh **bài trùng**.
- Chốt TP/SL: **đăng card xong mới đóng lệnh** (giá đóng đóng băng từ lúc detect); retry không bao giờ đóng slice lần hai.
- Lỗi tạm thời: backoff + jitter + max attempts + DLQ.
- Lỗi vĩnh viễn: báo operator, không retry mù.

## 3. Liên kết tài liệu

- Vòng đời vị thế: [02-du-lieu/state-machines.md](../02-du-lieu/state-machines.md)
- ADR: [ADR-0006](../adr/ADR-0006-at-least-once-va-idempotency.md), [ADR-0005](../adr/ADR-0005-transactional-outbox.md)
- Publication rules: [07-reporting/telegram-reporting.md](../07-reporting/telegram-reporting.md)
