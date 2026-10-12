# MT5 Bridge / EA

> Ánh xạ từ plan §8 (MT5 Bridge / EA).

## 1. Thông tin bridge cần cung cấp

- Account/server/terminal status.
- Symbol metadata.
- Quotes và spread.
- Balance/equity/margin.
- Open positions.
- Order/deal history.
- Heartbeat.
- Command status/history.

## 2. Command contract

Mỗi command cần:

| Trường | Ghi chú |
|---|---|
| `command_id` | ID lệnh |
| `idempotency_key` | Khóa idempotency |
| `account_id` | Tài khoản MT5 |
| `signal_id` | Tín hiệu liên quan |
| `signal_version_id` | Version tín hiệu |
| `execution_id` | Execution liên quan |
| `command_type` | Loại lệnh |
| `created_at` | Thời điểm tạo |
| `expires_at` | Thời điểm hết hạn |
| `payload` | Payload lệnh |
| `correlation_id` | ID tương quan |
| `schema_version` | Phiên bản schema |

### Command types

- `OPEN`
- `MODIFY_SLTP`
- `PARTIAL_CLOSE`
- `CLOSE_POSITION`
- `CLOSE_ALL_TARGET`
- `QUERY_STATE`

## 3. Response contract

Response gồm:

- Kết quả: `ACCEPTED` / `REJECTED` / `IN_PROGRESS` / `CONFIRMED` / `UNKNOWN`.
- Broker retcode.
- Order/deal/position IDs.
- Requested/filled volume.
- Fill price.
- Actual SL/TP.
- Timestamps.
- Account snapshot.

> `ACCEPTED` không đồng nghĩa lệnh đã fill — phải đợi `CONFIRMED`.

## 4. Timeout và reconciliation

Nếu backend **timeout** sau khi gửi OPEN:

1. Chuyển trạng thái thành **`TIMEOUT_UNKNOWN`**.
2. Kiểm tra **bridge journal**.
3. Truy vấn **positions/orders/deals** của broker.
4. Đối chiếu với **execution record**.
5. Chỉ xử lý tiếp khi **đã xác định được kết quả**.

> **Không gửi OPEN mới chỉ vì chưa nhận được response.**

## 5. Bảo mật kết nối

- Ưu tiên kết nối **outbound có xác thực** từ bridge tới backend.
- Dùng **TLS**, **replay protection** và **account allowlist**.
- **Không mở cổng điều khiển MT5 trực tiếp ra Internet.**

## 6. Giới hạn đảm bảo

- PostgreSQL và MT5 **không có transaction nguyên tử chung**.
- Sử dụng **at-least-once delivery, idempotency, command journal và reconciliation**.
- **Không tuyên bố exactly-once.**

## 7. Liên kết tài liệu

- Vòng đời command: [02-du-lieu/state-machines.md](../02-du-lieu/state-machines.md)
- Bảng execution: [02-du-lieu/database-design.md](../02-du-lieu/database-design.md)
- Retry và idempotency: [retry-idempotency.md](retry-idempotency.md)
- MT5 trong Docker: [08-deploy/mt5-docker-spike.md](../08-deploy/mt5-docker-spike.md)
- ADR: [ADR-0006](../adr/ADR-0006-at-least-once-va-idempotency.md), [ADR-0007](../adr/ADR-0007-mt5-bridge-outbound-authenticated.md), [ADR-0009](../adr/ADR-0009-broker-source-of-truth-va-reconciliation.md)
