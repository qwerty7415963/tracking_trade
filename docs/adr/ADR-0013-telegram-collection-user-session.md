# ADR-0013: Telegram collection dùng USER_SESSION, reporting ưu tiên BOT

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

Nguồn tín hiệu là **channel Telegram của bên thứ ba** — hệ thống không có quyền admin trên các channel này. Cần chọn phương thức truy cập cho 2 chiều: thu thập (collection) và báo cáo (reporting sender). Giới hạn Bot API đã được kiểm chứng với tài liệu chính thức của Telegram.

## Decision

- **Collection: `USER_SESSION` (MTProto client) duy nhất.** BOT bị loại vì: không tự join channel được (phải được chủ kênh add làm admin); trong channel bot chỉ tồn tại dạng administrator; chỉ nhận bài mới từ lúc được add (`channel_post`/`edited_channel_post`), không đọc lịch sử cũ, không đọc channel lạ.
- **Reporting sender: ưu tiên `BOT`.** Channel đích là của mình — add bot làm admin có quyền post là đủ, đơn giản và ổn định. `USER_SESSION` chỉ là fallback khi bot không đáp ứng.

## Consequences

- Tích cực: collection đọc được channel bên thứ ba + backfill history; reporting đơn giản qua Bot API.
- Tiêu cực: USER_SESSION cần số điện thoại + session string (secret nhạy cảm, lưu mã hóa); join quá nhanh dễ dính flood limit/ban — phải join từ từ, có backoff, tuân thủ rate limits và điều khoản Telegram.
- Ràng buộc: channel private cần invite link trong `collection_config_json`; session chết → source chuyển error theo quy ước `last_error_code`, không làm sập pipeline nguồn khác.
- Ràng buộc: `test-connection` phải kiểm tra quyền thực tế (session sống + đã join + đọc được; bot còn admin + quyền post).

## Alternatives considered

- BOT cho cả 2 chiều: không khả thi cho collection vì các giới hạn Bot API nêu trên.
- USER_SESSION cho cả 2 chiều: phức tạp không cần thiết cho reporting; BOT đủ và ổn định hơn.
