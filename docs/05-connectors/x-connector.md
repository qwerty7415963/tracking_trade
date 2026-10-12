# X Connector

> Ánh xạ từ plan §9.1 (X connector).

## 1. Yêu cầu

- **Không dùng X API trả phí**; thử nghiệm browser automation bằng **Playwright**.
- Phải **thử nghiệm tính khả thi** trước khi phụ thuộc vào connector này.

## 2. Ràng buộc bắt buộc

- Phải tuân thủ **điều khoản và giới hạn truy cập hiện hành** của X.
- **Không né CAPTCHA, anti-bot, rate limits hoặc access controls.**
- **Không tự vượt cơ chế bảo vệ truy cập của X.**

## 3. Kiến trúc

- Connector phải **tách riêng** khỏi pipeline chính.
- Có **circuit breaker** và **health status**.
- **Nếu X connector lỗi, pipeline Telegram vẫn phải hoạt động.**

## 4. Fallback

- Cần có phương án fallback được phép (xem open-decisions).
- X connector lỗi không được làm sập các nguồn khác.

## 5. Liên kết tài liệu

- ADR: [ADR-0008](../adr/ADR-0008-x-connector-playwright.md)
- Source management: [06-api/source-management-api.md](../06-api/source-management-api.md)
- Quyết định chưa chốt: [10-chuan/open-decisions.md](../10-chuan/open-decisions.md)
