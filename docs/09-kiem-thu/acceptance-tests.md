# Acceptance Tests

> Ánh xạ từ plan §16 (Acceptance tests).

## 1. Ingestion và parsing

- Message trùng **không tạo tín hiệu trùng**.
- Edit/revision được **lưu đúng**.
- Message **edit nối version mới** vào signal gốc (`eventType: EDIT`), không tạo signal trùng; approval cũ mất hiệu lực.
- Ingest lại **đúng row cũ** trả signal đã có (idempotent), không tạo mới, không đổi trạng thái.
- Approve version thiếu coin/hướng/entry (trừ `entry market`)/SL/TP bị **từ chối kèm lý do**; nút Approve hiện luôn lý do open-failed.
- Payload version lưu row id bài gốc ở key **camelCase `sourceMessageId`** (đọc cả snake_case cũ để tương thích); review/matching đều resolve qua key này.
- Coin parse được phải có trong **coin list** (`tradable_coins`); coin lạ giữ tên thật + gắn `unmapped_symbol_<X>` → review, không đoán.
- CRUD coin qua API/bot đều có audit; trùng symbol → `409`; xóa coin là xóa hẳn.
- 3 bài mẫu (CoinCodeCap/Alwayswin/MegaLodon) là golden test chống regress parser.
- Signal `FINAL` bị edit giữ nguyên trạng thái.
- Thiếu entry (trừ `entry market`)/SL/TP chuyển sang **review**.
- Nhiều hướng giao dịch **mâu thuẫn** chuyển sang review.
- Raw message và parser version được lưu.
- Hai channel khác nhau đăng nội dung gần giống nhau tạo **2 signal riêng** (không tính trùng); vượt **max positions per symbol** bị chặn.

## 2. Approval và updates

- Mode `APPROVE`: không có manual approval thì **không mở vị thế mới**.
- Mode `AUTO`: chỉ tự mở khi đủ field, không mơ hồ, map được coin.
- Switch toàn cục `MANUAL` ép chờ **mọi ví** kể cả ví `AUTO`; `AUTO` giữ logic theo ví; đổi switch ghi audit; thiếu row fail-safe về `MANUAL`.
- Signal version đổi làm **approval cũ mất hiệu lực**.
- Update mơ hồ hoặc nguồn không xác thực **không mở/đóng vị thế** — đưa review + noti operator.
- Noti review **không in id đầy đủ hay `UNKNOWN`**, luôn kèm bài gốc (forward thật nếu được, fallback text đã lưu) + nút Approve/Reject.
- `/review` và card review kèm **link bài viết cụ thể** (`https://t.me/{channel}/{msgId}` hoặc URL đã lưu), không chỉ tên channel; nguồn X/id không số thì không có link.
- `/review` tối đa 5+5 item, mỗi item kèm nút Approve/Reject (signal thêm Bổ sung); update mơ hồ có nút chọn ứng viên; nhập số bổ sung nối version `MANUAL`, hết hạn 5 phút.
- Nút Reject từ chối ngay, ghi audit.
- Update đồng thời **không gây mutation sai thứ tự**.

## 3. Virtual trading và risk

- Cùng signal+version đang mở → **không tạo vị thế trùng**.
- Thiếu quote/mapping → **từ chối**, không đoán giá.
- Size sai step/min, margin thiếu, SL thiếu bị **chặn**.
- Notional cố định theo ticker (BTC/ETH/SOL 100k, còn lại 50k) và **kill switch** chặn mở mới; đổi notional qua `/vol` hoặc API có audit.
- TP1 đóng **50%**, các TP còn lại chia đều; TP duy nhất đóng 100%.
- SL đóng **toàn bộ** phần còn lại; SL thắng khi chạm cả 2 phía.
- Mỗi lần đóng ghi realized PnL vào **ledger**; số dư chỉ đổi qua ledger.
- Limit entry tạo `PENDING_ENTRY` size 0, **không card/không margin**; giá chạm entry[0] → `OPEN`; `/tp` `/sl` bị từ chối, `/close` hủy không PnL/card.
- `/pos entry market 2950 2900`: bot báo chờ 3s, sau đó mới lấy mid; khớp full notional tại giá đó, các level số còn lại DCA khi chạm giá; card không render trước entry + 3s.
- DCA: mọi level chờ khớp; entry[0] full notional, level sau notional/N; card `entry` reply dưới card gốc.

## 4. Reporting

- Card `filled` chỉ sau khi vị thế đã mở (không báo trước). Limit entry chưa khớp **không đăng card**; entry đầu khớp mới đăng.
- Dialog chọn style **1 phút**: chọn trước khi limit khớp → lưu style, đăng ngay khi khớp; không chọn → fallback `pnl-strip` sau 1 phút; khớp khi đã quá 1 phút → fallback ngay. Market `/pos` chọn style sớm vẫn chờ đủ 3s sau entry mới render.
- Worker chỉ render PNG; API gửi Telegram — render lỗi **không mở/đóng vị thế**.
- Telegram retry **không làm thay đổi vị thế**.
- Bài TP/SL/close **reply đúng bài gốc**; update đến trước thì giữ chờ tối đa 5 phút, quá hạn đăng lẻ + audit (không mất bài).
- Template thay đổi **không làm đổi publication snapshot**.
- Thiếu X URL bắt buộc gây **validation failure**.
- Sender không có quyền đăng kênh tạo **lỗi rõ ràng**.
- Bài đăng khớp đúng **mẫu đã chốt** (direction/instrument/status/entry/SL/TP/nguồn/URL + ảnh card).

## 5. Telegram connector (collection)

- USER_SESSION chết/bị revoke → source chuyển **error** (`SESSION_EXPIRED`/`SESSION_REVOKED`), pipeline các nguồn khác **vẫn chạy**, không mất dữ liệu cũ.
- Bot reporting bị gỡ admin → báo lỗi rõ ràng (`BOT_NOT_ADMIN`), không tự chuyển sender khác.
- Join channel quá nhanh dính flood limit → **backoff** (`JOIN_FLOOD_WAIT`), thử lại sau.
- Backfill history khi thêm nguồn mới **không tạo signal trùng**.
- Non-operator gửi lệnh bot bị **từ chối**; lệnh trong group/channel bị **bỏ qua**.
- `/resume` thiếu `/confirm` thì **vô hiệu** (trading vẫn disabled).
- Mọi lệnh bot đổi trạng thái đều có **audit log** ghi username thực hiện.
- Thêm nguồn hàng loạt chấp nhận **mỗi dòng một handle/ID**, bỏ qua trùng tương đương handle, lỗi từng dòng **không hủy batch**.
- Định danh mơ hồ **không được đoán**, phải yêu cầu operator dùng ID; xóa nguồn qua bot luôn là **soft delete**.

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
