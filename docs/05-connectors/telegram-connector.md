# Telegram Connector

> Ánh xạ từ plan §2.1 (TelegramConnector) và §10 (Telegram reporting).

## 1. Nhiệm vụ

Thu thập Telegram messages và metadata phục vụ ingestion, đồng thời hỗ trợ reporting (sender + destination).

## 2. Collection

- Theo dõi các channel/group **bên thứ ba** được cấu hình trong `sources`.
- Lưu raw message kèm metadata: author, thread, reply, quote, timestamp.
- Hỗ trợ message **edit/revision** — lưu revision mới, không ghi đè lịch sử.
- Deduplicate dựa trên source + external message ID + revision/hash.
- **Backfill history**: khi thêm nguồn mới, USER_SESSION có thể đọc lịch sử cũ của channel để dựng ngữ cảnh; backfill không được tạo signal trùng (dedupe như message thường).
- Channel **private** cần invite link, lưu trong `collection_config_json` của nguồn.

## 3. Phương thức truy cập — ĐÃ CHỐT (xem ADR-0013)

Nguồn tín hiệu là **channel bên thứ ba** (không có quyền admin) nên:

| Tiêu chí | BOT (Bot API) | USER_SESSION (MTProto client) |
|---|---|---|
| Tự join channel | Không — phải được chủ kênh add làm admin | Có — join public channel như user thường |
| Đọc channel bên thứ ba | Không | Có |
| Đọc lịch sử cũ | Không — chỉ nhận bài mới từ lúc được add (`channel_post`/`edited_channel_post`) | Có — backfill được |
| Edit/revision | Nhận `edited_channel_post` (chỉ bài sau khi add) | Nhận đầy đủ |
| Dùng cho collection | **Không khả thi** | **Dùng cho collection** |
| Dùng cho reporting sender | **Ưu tiên** (channel đích là của mình, add bot làm admin có quyền post) | Fallback |

**Kết luận:** collection dùng `USER_SESSION` duy nhất; reporting sender ưu tiên `BOT`.

### Triển khai USER_SESSION bằng teleproto

- Dùng package npm **`teleproto`** (fork được maintain của GramJS, API tương thích — xem ADR-0014).
- Cần `api_id` + `api_hash` từ my.telegram.org; login lần đầu bằng số điện thoại + mã xác thực (+ 2FA/email nếu có).
- Dùng **`StringSession`**: chuỗi session sau login (`client.session.save()`) được **mã hóa rồi lưu** vào `connector_credentials`, nạp lại ở lần khởi động sau để không login lại.
- Theo dõi channel qua event `newChannelMessage` / `updateNewChannelMessage`; backfill history qua API lấy message theo channel.
- **Pin version chính xác** của `teleproto` và tuân thủ quy trình cập nhật package (xem docker-cicd).

### Rủi ro và ràng buộc của USER_SESSION

- Cần **số điện thoại + session string**; session là secret nhạy cảm, lưu mã hóa trong `connector_credentials`, không log plaintext.
- **Join quá nhanh nhiều channel dễ dính flood limit/ban** — phải join từ từ, có backoff, tuân thủ rate limits.
- Hành vi phải giống người dùng thật; tuân thủ **điều khoản Telegram**.
- Session chết/bị revoke → source chuyển error (xem quy ước `last_error_code` trong database-design), pipeline các nguồn khác vẫn chạy.

## 4. Sender & Destination

- Sender: `BOT` hoặc `USER_SESSION` (bảng `telegram_sender_accounts`).
- Destination: chat/channel đăng báo cáo (bảng `telegram_destinations`).
- Phải **xác minh sender có quyền đăng lên destination channel**.
- **Không tự chuyển sang sender khác** khi gửi lỗi trừ khi người dùng cấu hình rõ.

## 5. Publication

- Render template → snapshot publication intent → gửi Telegram.
- Publication lỗi không được kích hoạt lại execution.
- Retry thận trọng để tránh bài trùng (xem retry-idempotency).

Chi tiết báo cáo: [07-reporting/telegram-reporting.md](../07-reporting/telegram-reporting.md).

## 6. Xử lý lệnh điều phối (operator commands)

- Bot nhận lệnh điều phối **chỉ trong private chat** với username thuộc `OPERATOR_USERNAMES`; bỏ qua lệnh trong group/channel.
- Xác thực username người gửi trước khi thực thi; non-operator bị từ chối và ghi log.
- Lệnh nguy hiểm (`/resume`) yêu cầu **xác nhận 2 bước** (`/resume` → `/confirm`); thiếu `/confirm` thì vô hiệu.
- Mọi lệnh đổi trạng thái đi qua đúng service, conflict checks và audit log như REST API (xem operations-api).
- Danh sách lệnh: xem [06-api/operations-api.md](../06-api/operations-api.md).

## 7. Ràng buộc

- Nếu X connector lỗi, pipeline Telegram **vẫn phải hoạt động**.
- Secret (token/session) không lưu plaintext; dùng `connector_credentials` mã hóa.

## 8. Liên kết tài liệu

- Dữ liệu: [02-du-lieu/database-design.md](../02-du-lieu/database-design.md)
- Báo cáo: [07-reporting/telegram-reporting.md](../07-reporting/telegram-reporting.md)
- API: [06-api/reporting-api.md](../06-api/reporting-api.md)
- ADR: [ADR-0013](../adr/ADR-0013-telegram-collection-user-session.md)
