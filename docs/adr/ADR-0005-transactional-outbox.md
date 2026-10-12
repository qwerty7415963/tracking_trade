# ADR-0005: Transactional outbox

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

Giữa DB commit và background processing có khoảng trống mất event (crash giữa chừng). Mất event nghiệp vụ (vd: execution command đã commit nhưng worker chưa xử lý) là không chấp nhận được.

## Decision

Dùng **transactional outbox**: mọi event được ghi vào bảng `outbox_events` **trong cùng transaction** với thay đổi nghiệp vụ; background dispatcher đọc outbox và đẩy lên queue.

## Consequences

- Tích cực: không mất event giữa DB commit và processing; hỗ trợ at-least-once.
- Tiêu cực: dispatcher cần chạy định kỳ; outbox cần cleanup/retention.
- Ràng buộc: kết hợp idempotency ở consumer (xem ADR-0006) vì consumer có thể nhận trùng.

## Alternatives considered

- Ghi event trực tiếp lên queue khi commit: rủi ro mất event nếu queue push fail sau commit.
