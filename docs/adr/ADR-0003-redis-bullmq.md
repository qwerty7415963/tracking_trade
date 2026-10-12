# ADR-0003: Redis + BullMQ cho queue

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

Hệ thống có nhiều tác vụ nền: xử lý ingestion, parse, execution, screenshot, publication, retry. Cần hàng đợi đáng tin cậy với retry, delay, DLQ và khả năng khôi phục sau restart.

## Decision

Dùng **Redis + BullMQ** cho hàng đợi job (ingestion, parse, execution send, screenshot, publication).

## Consequences

- Tích cực: retry/backoff/DLQ tích hợp, job bền qua restart khi dùng Redis persist.
- Tích cực: BullMQ có rate limiting, scheduling, progress.
- Tiêu cực: Redis **không dùng để deduplicate** dữ liệu nghiệp vụ — dedupe phải ở database (source + external ID + revision/hash).
- Ràng buộc: Redis có persistent volume; không `down -v`.
- Ràng buộc: khi restart, khôi phục queue và publication pending trước khi cho phép giao dịch.

## Alternatives considered

- RabbitMQ: nặng hơn nhu cầu, thêm thành phần vận hành.
- In-process queue: không bền qua restart, không phù hợp worker tách process.
