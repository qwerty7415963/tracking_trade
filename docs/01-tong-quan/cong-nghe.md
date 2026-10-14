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
| ApprovalFlowService | Duyệt = mở lệnh (2 mode AUTO/APPROVE) |
| VirtualTradingService | Mở/đóng vị thế giấy, multi-TP split, TP/SL detector |
| VirtualAccountsService | Quản trị tài khoản ảo (nạp/rút/reset/mode/leverage) |
| MarketDataService | Giá Hyperliquid (meta/allMids, mapping data-driven) |
| OperatorBotService | Lệnh operator + nút Approve/Reject trên Telegram |
| RiskEngine | Kiểm tra giới hạn rủi ro (virtual, thích ứng từ bản MT5) |
| ScreenshotWorker | Render card + publish + market-watch poll |
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
| Market data | Hyperliquid public info API (`meta`/`allMids`, không cần key) |
| Paper trading | Virtual account cross-margin (mặc định x10), engine PnL/margin/liquidation nội bộ |
| Orchestration | Docker Compose |
| CI/CD | GitHub Actions |
| Container registry | GitHub Container Registry (GHCR) |

## 3. Cân nhắc kiến trúc liên quan

- **X connector** không dùng X API trả phí; phải thử nghiệm tính khả thi trước (xem [05-connectors/x-connector.md](../05-connectors/x-connector.md)).
- Quyết định kiến trúc được lưu trong [ADR](../adr/README.md).
- Mọi dependency tuân thủ **quy trình khóa version và cập nhật package** (xem [08-deploy/docker-cicd.md](../08-deploy/docker-cicd.md)).
