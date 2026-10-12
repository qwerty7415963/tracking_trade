# Architecture Decision Records (ADR)

## 1. Mục đích

Lưu trữ các quyết định kiến trúc quan trọng của dự án. Mỗi ADR là một quyết định đã được chấp thuận, bất biến theo thời gian. **Không sửa ADR cũ** — nếu quyết định thay đổi, tạo ADR mới.

## 2. Danh sách ADR

| # | Quyết định | Trạng thái |
|---|---|---|
| [0001](ADR-0001-kien-truc-modular-monolith.md) | NestJS modular monolith + TypeScript | Accepted |
| [0002](ADR-0002-postgresql-prisma.md) | PostgreSQL + Prisma | Accepted |
| [0003](ADR-0003-redis-bullmq.md) | Redis + BullMQ cho queue | Accepted |
| [0004](ADR-0004-signal-versioning.md) | Signal versioning bất biến cho approval | Accepted |
| [0005](ADR-0005-transactional-outbox.md) | Transactional outbox | Accepted |
| [0006](ADR-0006-at-least-once-va-idempotency.md) | At-least-once + idempotency (không exactly-once) | Accepted |
| [0007](ADR-0007-mt5-bridge-outbound-authenticated.md) | MT5 bridge MQL5 EA, outbound authenticated | Accepted |
| [0008](ADR-0008-x-connector-playwright.md) | X connector bằng Playwright, tách biệt + circuit breaker | Accepted |
| [0009](ADR-0009-broker-source-of-truth-va-reconciliation.md) | Broker là source of truth + reconciliation | Accepted |
| [0010](ADR-0010-kill-switch.md) | Kill switch 2 chế độ | Accepted |
| [0011](ADR-0011-live-trading-disabled-mac-dinh.md) | Live trading disabled mặc định sau restart/deploy | Accepted |
| [0012](ADR-0012-publication-snapshot.md) | Publication snapshot (template/version cố định khi queue) | Accepted |
| [0013](ADR-0013-telegram-collection-user-session.md) | Telegram collection dùng USER_SESSION, reporting ưu tiên BOT | Accepted |
| [0014](ADR-0014-telegram-mtproto-teleproto.md) | Telegram MTProto client dùng teleproto (pin version + quy trình cập nhật) | Accepted |

## 3. Template chuẩn

Mỗi ADR mới dùng template sau:

```markdown
# ADR-00XX: <Tiêu đề ngắn gọn>

- **Ngày:** YYYY-MM-DD
- **Trạng thái:** Proposed | Accepted | Deprecated

## Context

Bối cảnh và vấn đề cần giải quyết.

## Decision

Quyết định được chọn.

## Consequences

Hệ quả tích cực và tiêu cực, cùng ràng buộc đi kèm.

## Alternatives considered

Các phương án đã cân nhắc và lý do không chọn.
```

## 4. Quy tắc

- Số ADR tăng dần, không dùng lại số đã dùng.
- ADR gắn liền code/tài liệu triển khai — khi code đi ngược ADR phải tạo ADR thay thế.
- Nội dung ADR là tiếng Việt, thuật ngữ kỹ thuật giữ tiếng Anh.
