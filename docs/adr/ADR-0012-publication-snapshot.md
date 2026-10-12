# ADR-0012: Publication snapshot (template/version cố định khi queue)

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

Báo cáo Telegram được xếp hàng trước khi gửi. Nếu template bị sửa giữa lúc xếp hàng và gửi, bài đăng sẽ thay đổi nội dung không kiểm soát; update reply cũng cần trỏ đúng bài gốc.

## Decision

Khi tạo publication intent, **snapshot** các giá trị: sender, destination, template version, rendered text, source metadata, destination channel name vào bảng `telegram_publications`. Thay đổi template sau đó **không làm đổi bài đã xếp hàng**.

## Consequences

- Tích cực: bài đăng ổn định theo thời điểm snapshot; reply update trỏ đúng `telegram_message_id` gốc.
- Tiêu cực: phải duy trì consistency giữa snapshot và dữ liệu gốc khi render.
- Ràng buộc: publication failure không kích hoạt lại execution; retry thận trọng để tránh bài trùng.

## Alternatives considered

- Render tại thời điểm gửi: nội dung có thể đổi do template thay đổi giữa chừng.
