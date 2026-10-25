# Definition of Done

> Ánh xạ từ plan §17 (Definition of Done).

Hệ thống được coi là **hoàn thành** khi đạt tất cả các điều kiện sau:

- Có CRUD cho nguồn Telegram và X.
- Có health check và trạng thái connector.
- Mode `APPROVE`: tín hiệu mới **luôn cần manual approval theo version** (approve = mở lệnh).
- Update được **xác minh và ghép duy nhất**; mơ hồ thì hỏi operator kèm nút reject nhanh.
- Tài khoản ảo cross-margin với **ledger đầy đủ** (nạp/rút/chốt lãi-lỗ).
- Mở lệnh **idempotent** theo signal+version; sizing từ notional cố định theo ticker; multi-TP đúng tỉ lệ.
- TP/SL hit theo **giá Hyperliquid thật**; thiếu quote thì từ chối, không đoán.
- Có **risk engine và kill switch**.
- Có **sender/destination/template/route** configuration.
- Báo cáo có card ảnh gen từ dữ liệu thật, source URL khi cần; bài TP/SL/close **reply đúng bài gốc**.
- Docker Compose deploy được lên VPS.
- GitHub Actions CI/CD có **health checks và rollback**.
- **Backup/restore, restart recovery và audit** được kiểm thử.
- **Demo E2E pass** (mở → TP1 → TP2 → báo cáo).
- Hệ thống chỉ giao dịch giấy — **không có live trading**.

## Liên kết tài liệu

- Acceptance tests: [09-kiem-thu/acceptance-tests.md](../09-kiem-thu/acceptance-tests.md)
- Kế hoạch triển khai: [10-chuan/open-decisions.md](open-decisions.md)
