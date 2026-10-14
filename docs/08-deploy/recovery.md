# Recovery sau restart

> Ánh xạ từ plan §13.5 (Recovery sau restart).

## 1. Quy trình

1. Hệ thống chỉ giao dịch giấy — không có live trading để bật/tắt.
2. Kiểm tra **database, Redis và cấu hình**.
3. Kiểm tra **market data** (Hyperliquid reachable).
4. Khôi phục **queue và publication pending**.
5. Vị thế OPEN/TP_HIT giữ nguyên, tiếp tục theo dõi từ chu kỳ poll tiếp theo.

## 2. Nguyên tắc

- Không có trạng thái tiền nào nằm ngoài DB + ledger.
- Mọi bước recovery phải có audit trail.

## 3. Liên kết tài liệu

- Vòng đời vị thế: [02-du-lieu/state-machines.md](../02-du-lieu/state-machines.md)
- Kill switch: [04-risk-execution/risk-engine.md](../04-risk-execution/risk-engine.md)
