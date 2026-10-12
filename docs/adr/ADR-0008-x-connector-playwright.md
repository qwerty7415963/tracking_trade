# ADR-0008: X connector bằng Playwright, tách biệt + circuit breaker

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

Không dùng X API trả phí. Cần thu thập bài đăng X nhưng phải tuân thủ điều khoản, không né chống bot, và không để lỗi X ảnh hưởng pipeline chính.

## Decision

X connector dùng **browser automation (Playwright)** và được **tách riêng** khỏi pipeline chính, có **circuit breaker** và **health status**. Phải **thử nghiệm tính khả thi** trước khi phụ thuộc. Nếu X connector lỗi, pipeline Telegram vẫn hoạt động bình thường.

## Consequences

- Tích cực: không phụ thuộc API trả phí; cô lập lỗi khỏi pipeline chính.
- Tiêu cực: browser automation nhạy cảm với thay đổi giao diện/điều khoản; cần fallback được phép.
- Ràng buộc: không né CAPTCHA, anti-bot, rate limits hoặc access controls; không tự vượt cơ chế bảo vệ truy cập của X.

## Alternatives considered

- X API trả phí: ngoài phạm vi chi phí.
- Scraping qua endpoint nội bộ: vi phạm điều khoản và anti-bot.
