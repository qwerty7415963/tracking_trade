# ADR-0006: At-least-once + idempotency (không exactly-once)

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

PostgreSQL và MT5 broker không có transaction nguyên tử chung. Không thể đảm bảo exactly-once cho thao tác giao dịch. Tuyên bố exactly-once sẽ là sai lệch nguy hiểm.

## Decision

Sử dụng **at-least-once delivery** kết hợp **idempotency**, **command journal** và **reconciliation**. Mọi retry execution dùng **cùng command ID/idempotency key**. Không tuyên bố hệ thống có exactly-once execution.

## Consequences

- Tích cực: an toàn với duplicate delivery từ queue/bridge.
- Tích cực: trạng thái UNKNOWN được xử lý qua reconcile thay vì đoán.
- Tiêu cực: consumer phải thực hiện idempotency đúng; không retry OPEN mù sau timeout.
- Ràng buộc: timeout sau gửi → TIMEOUT_UNKNOWN → kiểm tra journal → query broker → reconcile trước khi xử lý tiếp.

## Alternatives considered

- Exactly-once bằng transaction phân tán: không khả thi với MT5/PostgreSQL.
