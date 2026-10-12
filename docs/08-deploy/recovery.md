# Recovery sau restart

> Ánh xạ từ plan §13.5 (Recovery sau restart).

## 1. Quy trình

1. Giữ **execution disabled**.
2. Kiểm tra **database, Redis và cấu hình**.
3. Kiểm tra **terminal, account và bridge heartbeat**.
4. **Reconcile command SENT/UNKNOWN**.
5. Khôi phục **queue và publication pending**.
6. Chỉ cho phép giao dịch khi **operator xác nhận các điều kiện an toàn**.

## 2. Nguyên tắc

- **Không tự bật live trading** sau restart/deploy.
- Trạng thái UNKNOWN không được bỏ qua; phải reconcile với broker.
- Mọi bước recovery phải có audit trail.

## 3. Liên kết tài liệu

- Reconcile: [04-risk-execution/mt5-bridge.md](../04-risk-execution/mt5-bridge.md)
- Kill switch: [04-risk-execution/risk-engine.md](../04-risk-execution/risk-engine.md)
- ADR: [ADR-0011](../adr/ADR-0011-live-trading-disabled-mac-dinh.md)
