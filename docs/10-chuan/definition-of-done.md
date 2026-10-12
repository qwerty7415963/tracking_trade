# Definition of Done

> Ánh xạ từ plan §17 (Definition of Done).

Hệ thống được coi là **hoàn thành** khi đạt tất cả các điều kiện sau:

- Có CRUD cho nguồn Telegram và X.
- Có health check và trạng thái connector.
- Tín hiệu mới **luôn cần manual approval theo version**.
- Update được **xác minh và ghép duy nhất** trước khi tác động vị thế.
- MT5 bridge có **journal, idempotency và reconciliation**.
- Có **risk engine và kill switch**.
- Có **sender/destination/template/route** configuration.
- Báo cáo có fill details thực tế, screenshot, source URL khi cần, nguồn Telegram nếu có và destination channel name.
- Update **reply đúng bài gốc**.
- Docker Compose deploy được lên VPS.
- GitHub Actions CI/CD có **health checks và rollback**.
- **Backup/restore, restart recovery và audit** được kiểm thử.
- **Demo E2E pass**.
- **Live trading mặc định disabled** sau restart/deploy.

## Liên kết tài liệu

- Acceptance tests: [09-kiem-thu/acceptance-tests.md](../09-kiem-thu/acceptance-tests.md)
- Kế hoạch triển khai: [10-chuan/open-decisions.md](open-decisions.md)
