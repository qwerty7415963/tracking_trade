# Kiến trúc tổng thể

> Ánh xạ từ plan §1 (Mục tiêu) và §2 (Kiến trúc tổng thể).
> Pivot: paper trading trên giá Hyperliquid — không còn MT5/execution thật.

## 1. Mục tiêu

Hệ thống Node.js/TypeScript có khả năng:

- Theo dõi các nguồn tín hiệu **Telegram** và **X**.
- Phân tích nội dung thành tín hiệu giao dịch có cấu trúc.
- Mở **vị thế giấy** theo 2 mode: `AUTO` (tự mở khi đủ field) hoặc `APPROVE` (mặc định — approve = mở lệnh).
- Theo dõi giá **Hyperliquid** realtime và tự phát hiện TP/SL hit.
- Tính lãi-lỗ, margin ratio, giá liquidation trên **tài khoản ảo cross-margin** (mặc định x10).
- Sinh ảnh card và đăng **báo cáo lên Telegram** (reply đúng bài gốc).
- Xác minh update từ nguồn, ghép với tín hiệu gốc.
- Cho phép thêm, sửa, xóa, bật và tắt các nguồn tín hiệu.
- Cho phép cấu hình Telegram sender, destination channel và reporting template.
- Deploy toàn hệ thống lên một VPS qua Docker Compose và GitHub Actions.

## 2. Quy tắc bắt buộc

Đây là các ràng buộc bất biến của toàn hệ thống. Mọi thay đổi kiến trúc không được phá vỡ các quy tắc này.

1. Mode `APPROVE`: tín hiệu mở vị thế mới luôn cần **manual approval** (approve = mở lệnh).
2. **Không tự điền** dữ liệu tín hiệu còn thiếu.
3. Update mơ hồ hoặc không xác thực được **không được mở/đóng vị thế** — đưa review, hỏi operator kèm nút reject nhanh.
4. **Không đoán giá**: thiếu quote thì từ chối, không bịa entry/close price.
5. Không báo TP/SL hit **trước khi giá chạm thật** trên feed.
6. Mọi thao tác tài chính (mở/đóng/nạp/rút/reset) phải có **audit trail** + ledger.
7. X connector lỗi **không được làm sập pipeline Telegram**.
8. Market-data lỗi **không được đoán** — bỏ qua chu kỳ poll, không tác động vị thế.
9. Publication failure **không kích hoạt lại giao dịch**.

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
   Approval (AUTO/    Validation / Review
   manual + open)     (hỏi operator + nút reject)
          |               |
          +-------+-------+
                  |
                  v
         Virtual Trading Service
          (sizing, risk gate, multi-TP split)
                  |
                  v
         Virtual Positions (giấy, cross-margin)
                  |
                  v
     Hyperliquid Market Data (allMids/ws)
         TP/SL detector (poll ~5s)
                  |
          +-------+--------+
          |                |
          v                v
   API (render + publish)
   (Chromium card, Telegram reply)
```

### 3.1 Giải thích luồng

1. **Source Management** cấu hình nguồn (Telegram/X), bật/tắt, credential.
2. **Telegram/X Connector** thu thập message/bài đăng thô kèm metadata.
3. **Ingestion/Normalization** lưu raw messages, deduplicate.
4. **Signal Parser** chuyển nội dung thành tín hiệu có cấu trúc (chuẩn hóa).
5. **Signal Matcher** ghép update với tín hiệu gốc.
6. **Approval**: mode `AUTO` tự mở khi đủ field; mode `APPROVE` chờ operator (`/approve` hoặc nút Approve) — approve đồng nghĩa mở lệnh. Update mơ hồ → review queue + noti operator.
7. **Virtual Trading Service** tính size từ notional cố định theo ticker, chạy risk gate, chia multi-TP (TP1 50%, còn lại chia đều).
8. **Virtual Positions** lưu vị thế giấy gắn signal gốc (traceability).
9. **Hyperliquid Market Data** (`allMids`, mapping data-driven từ `meta`) + **TP/SL detector** poll giá, phát hiện hit.
10. **API** render card PNG (Chromium, consumer `card-render` trong process API), dựng caption, gửi báo cáo Telegram, reply đúng bài gốc và chạy market-watch TP/SL.

## 4. Nguyên tắc thiết kế chủ đạo

- **Giá Hyperliquid là nguồn sự thật** cho mark price; thiếu quote thì bỏ qua, không đoán.
- **Mapping symbol data-driven** từ universe `meta` (ví dụ vàng → `PAXG`); không match thì review.
- **Approval gắn với đúng phiên bản tín hiệu**; version đổi → approval cũ mất hiệu lực.
- **Mọi mutation phải qua risk checks**; idempotency theo signal+version (không mở trùng).
- **Mọi event phải có audit trail** (+ ledger cho mọi biến động số dư).
- **Không tự bật giao dịch thật** — hệ thống chỉ giao dịch giấy.
