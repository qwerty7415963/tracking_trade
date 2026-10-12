# ADR-0011: Live trading disabled mặc định sau restart/deploy

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

Sau restart hoặc deploy, trạng thái broker/command có thể chưa được khôi phục. Tự bật live trading ngay là nguy hiểm (gửi lệnh trùng, quên reconcile, thiếu config).

## Decision

Hệ thống **mặc định disabled live trading** sau restart/deploy. Chỉ cho phép giao dịch khi **operator xác nhận các điều kiện an toàn** (DB/Redis ok, bridge heartbeat ok, reconcile SENT/UNKNOWN xong, queue/publication pending khôi phục).

## Consequences

- Tích cực: an toàn theo mặc định; người vận hành kiểm soát thời điểm bật.
- Tiêu cực: cần quy trình thủ công rõ ràng để bật lại.
- Ràng buộc: không tự bật kill switch hoặc trading sau deploy; quy trình recovery theo §13.5.

## Alternatives considered

- Tự bật trading khi startup: rủi ro giao dịch sai sau restart, bị loại.
