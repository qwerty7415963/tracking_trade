# ADR-0009: Broker là source of truth + reconciliation

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

DB có thể lệch với trạng thái thực tế ở broker (timeout, reconnect, partial fill, vị thế lạ). Tin tưởng DB mà không đối chiếu broker sẽ dẫn đến quyết định sai.

## Decision

**Broker là nguồn sự thật** về vị thế thực tế. ReconciliationService định kỳ và sau sự kiện UNKNOWN đối chiếu DB với trạng thái broker. Vị thế không rõ nguồn → gắn cờ review, **không tự đóng**. Order/deal/position ID là các định danh riêng biệt, không gộp.

## Consequences

- Tích cực: phát hiện vị thế lạ, partial fill, execution chưa rõ.
- Tiêu cực: trạng thái UNKNOWN không được bỏ qua; phải reconcile trước khi xử lý tiếp.
- Ràng buộc: không báo filled trước khi broker xác nhận; không retry OPEN mù sau timeout.

## Alternatives considered

- Tin DB là nguồn sự thật: rủi ro cao khi DB lệch broker (mất lệnh, đóng nhầm).
