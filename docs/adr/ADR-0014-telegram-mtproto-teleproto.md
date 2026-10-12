# ADR-0014: Telegram MTProto client dùng teleproto

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

ADR-0013 chốt collection dùng `USER_SESSION` (MTProto client). Cần chọn thư viện MTProto cho Node.js/TypeScript. GramJS (`npm telegram`) là thư viện quen thuộc nhưng **đã archived, không còn maintained** (xác nhận trên README GramJS, gram.js.org và thông báo deprecated trên npm).

## Decision

Dùng package npm **`teleproto`** cho USER_SESSION collection:

- Là fork của GramJS, được chính GramJS team chỉ định kế nhiệm (*"actively maintained fork"*).
- API tương thích GramJS gần như hoàn toàn (`TelegramClient`, `StringSession`, events) — đổi import là chạy.
- Maintain tích cực (release hàng tuần, theo kịp TL layer mới), xử lý các auth/abuse flow mới (email verification, reCaptcha, frozen-account errors) mà GramJS cũ không có.
- MIT license, pure JavaScript (không native build), 6 dependencies.
- Dùng `StringSession`, mã hóa chuỗi session trước khi lưu vào `connector_credentials`.

## Consequences

- Tích cực: connector không chết dần khi Telegram đổi protocol; theo kịp TL layer.
- Tiêu cực: bus factor thấp (1 collaborator trên npm, dù repo có nhiều contributors); fork mới từ 2025, cộng đồng nhỏ hơn GramJS thời đỉnh.
- Ràng buộc giảm thiểu: **pin version chính xác** (không `latest`/range trôi), **lockfile commit kèm repo**, cài bằng `npm ci` trong CI/Docker, **dependency scan trong CI**, cập nhật theo lịch qua PR riêng có review (xem quy trình trong docker-cicd và security-checklist).

## Alternatives considered

- GramJS gốc (`npm telegram`): đã archived, tụt hậu TL layer — loại.
- Telethon (Python): thêm runtime Python vào stack Node.js — không phù hợp kiến trúc đã chốt.
- Tự viết MTProto client: chi phí và rủi ro không chấp nhận được.
