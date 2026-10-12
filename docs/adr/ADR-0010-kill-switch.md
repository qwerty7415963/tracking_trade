# ADR-0010: Kill switch 2 chế độ

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

Cần cơ chế dừng giao dịch khẩn cấp nhưng phải rõ ràng về phạm vi: có thể chỉ muốn chặn lệnh mới, hoặc chặn mọi thay đổi vị thế tự động.

## Decision

Kill switch có **hai chế độ**:

- `STOP NEW TRADES`: chặn lệnh mới.
- `STOP ALL AUTOMATED MUTATIONS`: chặn mọi thay đổi vị thế tự động.

## Consequences

- Tích cực: linh hoạt theo mức rủi ro vận hành mong muốn.
- Tiêu cực: cần phân quyền bật/tắt rõ ràng và audit log.
- Ràng buộc: kill switch **không tự động đóng** vị thế hiện có; **không được xóa** trạng thái command UNKNOWN; **không tự bật live trading sau deploy/restart**.

## Alternatives considered

- Một công tắc duy nhất tắt toàn bộ: kém linh hoạt khi chỉ muốn chặn lệnh mới.
