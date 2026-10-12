# Module và Công nghệ

> Ánh xạ từ plan §2.1 (Các module) và §2.2 (Công nghệ).

## 1. Các module

| Module | Trách nhiệm |
|---|---|
| SourceManagement | CRUD nguồn, bật/tắt, cấu hình thu thập |
| TelegramConnector | Thu thập Telegram messages và metadata |
| XConnector | Thu thập bài đăng X theo phương thức truy cập được phép |
| IngestionService | Lưu raw messages, deduplicate |
| SignalParser | Parse nội dung thành dữ liệu có cấu trúc |
| SignalMatcher | Ghép update với tín hiệu gốc |
| ApprovalService | Duyệt hoặc từ chối tín hiệu |
| RiskEngine | Kiểm tra giới hạn rủi ro |
| ExecutionService | Tạo và theo dõi execution commands |
| MT5BridgeAdapter | Giao tiếp với MT5 EA/bridge |
| PositionManager | Quản lý SL, TP, partial close và close |
| ReconciliationService | Đối chiếu DB với trạng thái broker |
| ScreenshotWorker | Chụp ảnh giao dịch |
| TelegramPublisher | Render template, gửi báo cáo và reply |
| AuditService | Lưu lịch sử thao tác |
| OperationsAPI | API vận hành và quản trị |

### Ghi chú phân lớp

- Module nằm ở tầng nghiệp vụ (domain/service), độc lập với framework HTTP.
- Chỉ HTTP boundary tiếp xúc với framework web; logic core là thuần service.
- Connector X phải **tách riêng** khỏi pipeline chính (xem [05-connectors/x-connector.md](../05-connectors/x-connector.md)).

## 2. Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Ngôn ngữ | Node.js + TypeScript |
| API + worker | NestJS |
| Database | PostgreSQL + Prisma |
| Queue | Redis + BullMQ |
| Telegram collection | teleproto (MTProto client cho Node.js/TypeScript, USER_SESSION + StringSession) — xem ADR-0014 |
| X connector | Playwright (browser automation, tách biệt pipeline chính) |
| MT5 | MQL5 EA/bridge |
| Orchestration | Docker Compose |
| CI/CD | GitHub Actions |
| Container registry | GitHub Container Registry (GHCR) |

## 3. Cân nhắc kiến trúc liên quan

- **MT5 Docker spike** bắt buộc trước khi phụ thuộc mô hình chạy MT5 trong Linux Docker (xem [08-deploy/mt5-docker-spike.md](../08-deploy/mt5-docker-spike.md)).
- **X connector** không dùng X API trả phí; phải thử nghiệm tính khả thi trước (xem [05-connectors/x-connector.md](../05-connectors/x-connector.md)).
- Quyết định kiến trúc được lưu trong [ADR](../adr/README.md).
- Mọi dependency tuân thủ **quy trình khóa version và cập nhật package** (xem [08-deploy/docker-cicd.md](../08-deploy/docker-cicd.md)).
