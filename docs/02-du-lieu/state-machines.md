# State Machines

> Ánh xạ từ plan §4 (State machines).

Tài liệu mô tả vòng đời trạng thái của 4 thực thể chính: tín hiệu, update, execution command và publication.

## 1. Signal lifecycle

```text
DETECTED
  -> PARSED
  -> PENDING_APPROVAL
  -> APPROVED
  -> EXECUTING
  -> OPEN / PARTIALLY_OPEN
  -> CLOSED
```

Các trạng thái nhánh khác:

- `NEEDS_REVIEW` — thiếu field hoặc mâu thuẫn, cần review thủ công.
- `REJECTED` — bị từ chối (approval hoặc risk).
- `CANCELLED` — hủy setup trước khi vào lệnh.
- `EXPIRED` — hết hạn trước khi execute.
- `EXECUTION_FAILED` — không thể thực thi.
- `UNKNOWN` — trạng thái không xác định, phải reconcile.

### Quy tắc

- Mọi tín hiệu **mở lệnh mới** phải đi qua `APPROVED` trước khi `EXECUTING`.
- `PENDING_APPROVAL` chỉ được duyệt khi gắn với **đúng version** hiện tại của signal.
- Nếu signal có version mới, approval cũ không còn hiệu lực.

## 2. Update lifecycle

```text
RECEIVED
  -> MATCHING
  -> MATCHED
  -> VALIDATING
  -> VALIDATED
  -> ACTION_PENDING
  -> EXECUTING
  -> APPLIED
```

Các trạng thái nhánh lỗi:

- `AMBIGUOUS` — khớp nhiều tín hiệu, chuyển review queue.
- `UNVERIFIED` — không xác thực được nguồn.
- `REJECTED` — bị từ chối.
- `ACTION_PENDING_REVIEW` — cần review thủ công.
- `EXECUTION_UNKNOWN` — kết quả thực thi không rõ.
- `RETRYABLE_FAILURE` — lỗi tạm thời, có thể retry.
- `FINAL_FAILURE` — lỗi vĩnh viễn, báo operator.

### Quy tắc

- Update mơ hồ hoặc không xác thực **không được tác động MT5**.
- Chỉ khi `VALIDATED` mới được đưa vào `ACTION_PENDING`.
- Mọi action tự động phải qua risk checks và action allowlist.

## 3. Execution command lifecycle

```text
CREATED
  -> RISK_CHECKED
  -> SENT
  -> ACKNOWLEDGED
  -> CONFIRMED
```

Các trạng thái nhánh khác:

- `REJECTED` — bị risk engine hoặc broker từ chối.
- `TIMEOUT_UNKNOWN` — timeout sau khi gửi, kết quả chưa rõ.
- `RECONCILING` — đang đối chiếu với broker.
- `RETRYABLE_FAILURE` — lỗi tạm thời.
- `FINAL_FAILURE` — lỗi vĩnh viễn.

### Quy tắc

- `ACKNOWLEDGED` **không đồng nghĩa với lệnh đã fill**.
- `SENT`/`TIMEOUT_UNKNOWN` không được phát OPEN mới — phải reconcile trước.
- Mọi retry dùng **cùng command ID/idempotency key**.

## 4. Publication lifecycle

```text
PENDING
  -> SENDING
  -> PUBLISHED
```

Nhánh khác:

- `RETRY_PENDING` — lỗi tạm thời, sẽ retry.
- `UNKNOWN` — kết quả gửi không rõ.
- `FINAL_FAILURE` — lỗi vĩnh viễn.

### Quy tắc

- **Publication lỗi không được kích hoạt lại execution.**
- Publication `UNKNOWN` phải xử lý thận trọng để tránh bài trùng (xem retry/idempotency).

## 5. Liên kết tài liệu

- Dữ liệu lưu trữ: [database-design.md](database-design.md)
- Execution & timeout: [04-risk-execution/mt5-bridge.md](../04-risk-execution/mt5-bridge.md)
- Retry và idempotency: [04-risk-execution/retry-idempotency.md](../04-risk-execution/retry-idempotency.md)
