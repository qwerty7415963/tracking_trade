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
PENDING_ENTRY
  -> OPEN (entry đầu khớp)
  -> CANCELLED (/close khi chưa khớp)
OPEN
  -> TP_HIT (chạm TP nhưng còn size)
  -> CLOSED (chạm TP cuối / đóng tay)
OPEN -> SL_HIT (chạm SL, đóng hết)
OPEN -> CANCELLED
```

### Quy tắc

- Cùng signal+version đang mở/chờ entry → trả vị thế hiện có, **không mở trùng**.
- Limit entry mới ở `PENDING_ENTRY`: `size=0`, mọi entry nằm trong `pending_entries`; giá chạm level (LONG `≤`, SHORT `≥`) → khớp, entry đầu chuyển `OPEN`; chưa khớp thì không có card, không margin, `/tp` `/sl` bị từ chối, `/close` hủy (`CANCELLED`) không PnL.
- TP1 đóng 50%, các TP còn lại chia đều; TP duy nhất đóng 100%.
- SL đóng toàn bộ phần còn lại; SL thắng khi giá chạm cả 2 phía.
- Mỗi lần đóng ghi realized PnL vào ledger; số dư chỉ đổi qua ledger.
- Chạm TP/SL: **card đăng trước, lệnh đóng sau** (settle job, giá đóng băng lúc detect — xem [04-risk-execution/risk-engine.md](../04-risk-execution/risk-engine.md) §5). Vị thế vì thế hiển thị `OPEN` thêm tối đa 60s.
- Khớp entry DCA: giá chạm level trong `pending_entries` → `size` tăng, `entry_price` chuyển thành **TB có trọng số** của các level đã khớp, level rời khỏi `pending_entries`; có 1 card update (`status=entry`) nhưng **không qua settle** (không đổi ledger, không đóng lệnh).
- Thao tác tay: TP một phần giảm `remaining_size`, giữ nguyên `filled_tps` và status (card `tp` hiện phần còn lại OPEN); TP all hoặc `/close` đóng phần còn lại; dời SL chỉ đổi `stop_loss` (không card). Không chuyển vị thế sang state khác ngoài `CLOSED` khi đóng hết.

## 4. Publication lifecycle

```text
PENDING
  -> SENDING
  -> PUBLISHED
```

Nhánh khác:

- `RETRY_PENDING` — render xong, đang gửi/retrying (kể cả lúc đang chờ card gốc) — **không còn là "chưa render" nên không che dialog chọn kind**.
- `UNKNOWN` — kết quả gửi không rõ.
- `FINAL_FAILURE` — lỗi vĩnh viễn (render hỏng hoặc send hết attempts) → bot báo `❌ Không đăng được card …`.

### Quy tắc

- `PENDING` = row mới tạo, render job chưa chạy (dialog `/pos` giữ row ở trạng thái này tối đa **1 phút**).
- **Publication lỗi không được mở/đóng vị thế.**
- Publication `UNKNOWN` phải xử lý thận trọng để tránh bài trùng (xem retry/idempotency).

## 5. Liên kết tài liệu

- Dữ liệu lưu trữ: [database-design.md](database-design.md)
- Risk & sizing: [04-risk-execution/risk-engine.md](../04-risk-execution/risk-engine.md)
- Retry và idempotency: [04-risk-execution/retry-idempotency.md](../04-risk-execution/retry-idempotency.md)
