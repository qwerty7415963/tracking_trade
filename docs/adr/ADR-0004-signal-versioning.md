# ADR-0004: Signal versioning bất biến cho approval

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

Tín hiệu từ nguồn có thể thay đổi (edit, update SL/TP...). Nếu approval gắn với tín hiệu "hiện tại" mà nội dung đổi, operator có thể vô tình duyệt một phiên bản khác với bản được hiển thị.

## Decision

Mỗi tín hiệu lưu nhiều **`signal_versions` bất biến**. Approval gắn với **exact `signal_version_id`**. Khi tín hiệu thay đổi, **tạo version mới** thay vì sửa lịch sử cũ.

## Consequences

- Tích cực: approval luôn xác định đúng nội dung được duyệt; version đổi → approval cũ mất hiệu lực.
- Tích cực: audit trail đầy đủ cho lịch sử tín hiệu.
- Tiêu cực: thêm phức tạp khi query (cần join version mới nhất).
- Ràng buộc: trước khi execute phải kiểm tra approval đúng version hiện tại; nếu đổi → duyệt lại.

## Alternatives considered

- Approval gắn với signal hiện tại: rủi ro duyệt sai nội dung khi signal thay đổi giữa chừng.
