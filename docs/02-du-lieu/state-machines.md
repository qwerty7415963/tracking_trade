# State Machines

> Ánh xạ từ plan §4 (State machines).

Tài liệu mô tả vòng đời trạng thái của 4 thực thể chính: tín hiệu, update, virtual position và publication.

## 1. Signal lifecycle

```text
DETECTED
  -> PARSED
  -> PENDING_APPROVAL
  -> APPROVED (đồng nghĩa mở vị thế ảo)
```

Mode `AUTO` bỏ qua bước chờ: đủ field + map được coin → tự approve + mở. Mode `APPROVE` (mặc định) chờ operator.

Các trạng thái nhánh khác:

- `NEEDS_REVIEW` — thiếu field hoặc mâu thuẫn, cần review thủ công (hỏi operator + nút reject nhanh).
- `REJECTED` — bị từ chối (approval hoặc risk).
- `CANCELLED` — hủy setup trước khi vào lệnh.
- `EXPIRED` — hết hạn trước khi mở.

### Quy tắc

- Mode `APPROVE`: tín hiệu **mở vị thế mới** phải đi qua `APPROVED` (approve = mở lệnh).
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
  -> APPLIED
```

Các trạng thái nhánh lỗi:

- `AMBIGUOUS` — khớp nhiều tín hiệu, chuyển review queue (hỏi operator).
- `UNVERIFIED` — không xác thực được nguồn.
- `REJECTED` — bị từ chối (tay hoặc nút inline).
- `ACTION_PENDING_REVIEW` — cần review thủ công.
- `RETRYABLE_FAILURE` — lỗi tạm thời, có thể retry.
- `FINAL_FAILURE` — lỗi vĩnh viễn, báo operator.

### Quy tắc

- Update mơ hồ hoặc không xác thực **không được mở/đóng vị thế**.
- Chỉ khi `VALIDATED` mới được đưa vào `ACTION_PENDING`.
- Mọi action tự động phải qua risk checks và action allowlist.

## 3. Virtual position lifecycle

```text
OPEN
  -> TP_HIT (chạm TP nhưng còn size)
  -> CLOSED (chạm TP cuối / đóng tay)
OPEN -> SL_HIT (chạm SL, đóng hết)
OPEN -> CANCELLED
```

### Quy tắc

- Cùng signal+version đang mở → trả vị thế hiện có, **không mở trùng**.
- TP1 đóng 50%, các TP còn lại chia đều; TP duy nhất đóng 100%.
- SL đóng toàn bộ phần còn lại; SL thắng khi giá chạm cả 2 phía.
- Mỗi lần đóng ghi realized PnL vào ledger; số dư chỉ đổi qua ledger.

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

- **Publication lỗi không được mở/đóng vị thế.**
- Publication `UNKNOWN` phải xử lý thận trọng để tránh bài trùng (xem retry/idempotency).

## 5. Liên kết tài liệu

- Dữ liệu lưu trữ: [database-design.md](database-design.md)
- Risk & sizing: [04-risk-execution/risk-engine.md](../04-risk-execution/risk-engine.md)
- Retry và idempotency: [04-risk-execution/retry-idempotency.md](../04-risk-execution/retry-idempotency.md)
