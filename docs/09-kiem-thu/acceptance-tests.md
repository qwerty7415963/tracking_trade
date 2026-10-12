# Acceptance Tests

> Ánh xạ từ plan §16 (Acceptance tests).

## 1. Ingestion và parsing

- Message trùng **không tạo tín hiệu trùng**.
- Edit/revision được **lưu đúng**.
- Thiếu entry/SL/TP chuyển sang **review**.
- Nhiều hướng giao dịch **mâu thuẫn** chuyển sang review.
- Raw message và parser version được lưu.
- Hai channel khác nhau đăng nội dung gần giống nhau tạo **2 signal riêng** (không tính trùng); vượt **max positions per symbol** bị chặn.

## 2. Approval và updates

- Không có manual approval thì **không mở lệnh mới**.
- Signal version đổi làm **approval cũ mất hiệu lực**.
- Update mơ hồ hoặc nguồn không xác thực **không tác động MT5**.
- SL/TP update **đúng vị thế**.
- Partial close **tuân thủ volume step**.
- TP1 **không tự đóng** nếu policy chưa cho phép.
- Update đồng thời **không gây mutation sai thứ tự**.

## 3. Execution và risk

- Timeout sau gửi lệnh **không tạo OPEN thứ hai**.
- Broker rejection được xử lý.
- Partial fill được **ghi nhận chính xác**.
- Thiếu symbol map bị **từ chối**.
- Volume sai, spread cao, margin thiếu và SLTP sai bị **chặn**.
- **Daily loss limit** và **kill switch** chặn lệnh.
- Reconnect reconciliation **phát hiện vị thế lạ**.
- Kill switch trong lúc command đang chạy được kiểm thử.

## 4. Reporting

- **Không báo filled** trước broker confirmation.
- Screenshot lỗi **không kích hoạt execute lại**.
- Telegram retry **không làm thay đổi execution**.
- Reply update **đúng message ID gốc**.
- Update tới trước publication gốc phải **chờ**.
- Template thay đổi **không làm đổi publication snapshot**.
- Thiếu X URL bắt buộc gây **validation failure**.
- Sender không có quyền đăng kênh tạo **lỗi rõ ràng**.
- Bài đăng vào lệnh khớp đúng **mẫu đã chốt** (direction/instrument/status/entry/SL/TP/nguồn/URL + screenshot); bài update **reply đúng bài đầu tiên**.

## 5. Telegram connector (collection)

- USER_SESSION chết/bị revoke → source chuyển **error** (`SESSION_EXPIRED`/`SESSION_REVOKED`), pipeline các nguồn khác **vẫn chạy**, không mất dữ liệu cũ.
- Bot reporting bị gỡ admin → báo lỗi rõ ràng (`BOT_NOT_ADMIN`), không tự chuyển sender khác.
- Join channel quá nhanh dính flood limit → **backoff** (`JOIN_FLOOD_WAIT`), thử lại sau.
- Backfill history khi thêm nguồn mới **không tạo signal trùng**.
- Non-operator gửi lệnh bot bị **từ chối**; lệnh trong group/channel bị **bỏ qua**.
- `/resume` thiếu `/confirm` thì **vô hiệu** (trading vẫn disabled).
- Mọi lệnh bot đổi trạng thái đều có **audit log** ghi username thực hiện.

## 6. CI/CD và recovery

- CI fail thì **deploy bị chặn**.
- Production deploy được **serialize**.
- Migration/smoke failure có **recovery plan**.
- VPS reboot **giữ dữ liệu** và **trading disabled**.
- **Backup restore** pass.
- Thiếu secret làm hệ thống **fail-safe**.
- X connector down **không làm gián đoạn** Telegram pipeline.

## 7. Liên kết tài liệu

- Definition of Done: [10-chuan/definition-of-done.md](../10-chuan/definition-of-done.md)
- Kế hoạch triển khai (Phase/gate): [10-chuan/open-decisions.md](../10-chuan/open-decisions.md)
