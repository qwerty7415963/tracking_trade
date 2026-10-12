# Kiến trúc tổng thể

> Ánh xạ từ plan §1 (Mục tiêu) và §2 (Kiến trúc tổng thể).

## 1. Mục tiêu

Hệ thống Node.js/TypeScript có khả năng:

- Theo dõi các nguồn tín hiệu **Telegram** và **X**.
- Phân tích nội dung thành tín hiệu giao dịch có cấu trúc.
- Yêu cầu người vận hành **duyệt thủ công** trước khi mở lệnh mới.
- Thực thi giao dịch trên một tài khoản **MT5**.
- Theo dõi kết quả thực thi thực tế từ broker.
- Chụp ảnh giao dịch và đăng **báo cáo lên Telegram**.
- Xác minh update từ nguồn, ghép với tín hiệu gốc và quản lý đúng vị thế MT5.
- Cho phép thêm, sửa, xóa, bật và tắt các nguồn tín hiệu.
- Cho phép cấu hình Telegram sender, destination channel và reporting template.
- Deploy toàn hệ thống lên một VPS qua Docker Compose và GitHub Actions.

## 2. Quy tắc bắt buộc

Đây là các ràng buộc bất biến của toàn hệ thống. Mọi thay đổi kiến trúc không được phá vỡ các quy tắc này.

1. Tín hiệu mở lệnh mới luôn cần **manual approval**.
2. **Không tự điền** dữ liệu tín hiệu còn thiếu.
3. Update mơ hồ hoặc không xác thực được **không được tác động MT5**.
4. **Không retry lệnh OPEN** một cách mù quáng sau timeout.
5. Không báo lệnh đã khớp **trước khi broker xác nhận**.
6. **Không tự bật live trading** sau deploy hoặc restart.
7. Mọi thao tác tài chính phải có **audit trail**.
8. X connector lỗi **không được làm sập pipeline Telegram**.
9. Không tuyên bố hệ thống có **exactly-once execution**; sử dụng idempotency, journal và reconciliation.

## 3. Kiến trúc tổng thể

```text
Source Management
       |
       v
Telegram Connector ---- X Connector
       |                     |
       +----------+----------+
                  |
                  v
       Ingestion / Normalization
                  |
                  v
         Signal Parser
                  |
                  v
         Signal Matcher
                  |
          +-------+-------+
          |               |
     New Signal       Signal Update
          |               |
          v               v
   Manual Approval   Validation / Review
          |               |
          +-------+-------+
                  |
                  v
             Risk Engine
                  |
                  v
          Execution Service
                  |
                  v
             MT5 Bridge
                  |
                  v
             MT5 / Broker
                  |
                  v
          Reconciliation
                  |
          +-------+--------+
          |                |
          v                v
   Screenshot Worker  Telegram Publisher
```

### 3.1 Giải thích luồng

1. **Source Management** cấu hình nguồn (Telegram/X), bật/tắt, credential.
2. **Telegram/X Connector** thu thập message/bài đăng thô kèm metadata.
3. **Ingestion/Normalization** lưu raw messages, deduplicate.
4. **Signal Parser** chuyển nội dung thành tín hiệu có cấu trúc (chuẩn hóa).
5. **Signal Matcher** ghép update với tín hiệu gốc.
6. **Manual Approval** duyệt tín hiệu mới (bắt buộc) / **Validation-Review** cho update.
7. **Risk Engine** kiểm tra giới hạn rủi ro trước mọi thao tác.
8. **Execution Service** tạo và theo dõi execution commands.
9. **MT5 Bridge** (MQL5 EA) giao tiếp với MT5/broker.
10. **Reconciliation** đối chiếu DB với trạng thái broker thực tế.
11. **Screenshot Worker + Telegram Publisher** đăng báo cáo kèm ảnh.

## 4. Nguyên tắc thiết kế chủ đạo

- **Broker là nguồn sự thật** về vị thế thực tế.
- **At-least-once delivery + idempotency** thay vì exactly-once.
- **Approval gắn với đúng phiên bản tín hiệu**; version đổi → approval cũ mất hiệu lực.
- **Mọi mutation phải qua risk checks và action allowlist**.
- **Mọi event phải có audit trail** (transactional outbox).
- **Live trading mặc định disabled** sau restart/deploy.
