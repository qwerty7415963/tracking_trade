# Signal Parsing & Matching

> Ánh xạ từ plan §5 (Signal parsing và matching).

## 1. Normalized signal

Parser chuyển nội dung thô thành **normalized signal** với các trường sau:

| Trường | Ghi chú |
|---|---|
| `event_type` | Loại sự kiện |
| `instrument` | Công cụ chuẩn hóa |
| `direction` | Hướng (BUY/SELL) |
| `order_type` | Loại lệnh |
| `entry` | Vùng entry |
| `stop_loss` | Stop loss |
| `take_profits` | Danh sách take profits |
| `update_action` | Hành động update (nếu là update) |
| `source_message_id` | ID message gốc |
| `source_platform` | Nền tảng nguồn |
| `source_url` | URL nguồn |
| `source_timestamp` | Thời điểm nguồn |
| `thread_id` | ID thread |
| `reply_to_message_id` | ID message được reply |
| `quoted_message_id` | ID message được quote |
| `confidence` | Độ tin cậy parse |
| `missing_fields` | Các trường thiếu |
| `ambiguities` | Các điểm mơ hồ |
| `parser_version` | Phiên bản parser |

### Quy tắc

- **Không tự điền các trường còn thiếu.**
- Mapping symbol phải rõ ràng, ví dụ: `GOLD → XAUUSD.a`.
- **Không fuzzy-match symbol sàn** (chỉ map data-driven từ universe Hyperliquid).

### Chuẩn hoá text và coin (2026-10-16)

- Parser chuẩn hoá trước regex: bỏ `$`/`#` đầu ticker, cắt `/USDT`/`/USD`/`/PERP`, xoá dấu phẩy ngăn nghìn (`1,223` → `1223`, quy ước format Mỹ).
- Ticker có marker (`$ETH`, `#ZEC`, `ZEC/USDT`) luôn được tách; từ thường chỉ nhận nếu nằm trong coin list.
- Coin trích được đối chiếu **coin list do operator quản lý** (`tradable_coins`): không có → giữ tên thật + gắn `unmapped_symbol_<X>` → `NEEDS_REVIEW`. Không bao giờ đoán coin.
- Leverage `30x` được trích vào payload (sizing vẫn theo account, dùng sau).
- Entry dạng vùng `1223 - 1154` → `entry=1223`, `entryZoneHigh=1154`, `entries=[1223]` (vùng = 1 lệnh duy nhất).
- **Nhiều entry (DCA)**: `Entry: 3000 2950 2900` hoặc `Entry: 3000, 2950` → `entries=[3000,2950,2900]` với `entry` = phần tử đầu. Số liền sau bởi `x` (leverage `5x`) **không** bị đọc thành entry. Thứ tự phải cùng chiều với hướng lệnh: **LONG giảm dần, SHORT tăng dần** — sai thứ tự → chỉ lấy entry đầu + gắn ambiguity `entries_wrong_order`.
- TP phần trăm (`Tp: 20% 40% 60%`): có entry thì quy đổi ra giá theo hướng (LONG `entry*(1+p/100)`, SHORT ngược lại) + gắn `tp_percent_converted`; thiếu entry thì review. Giả định TP% = biên giá, không phải % vị thế.
- Bài chỉ có ảnh (số nằm trong chart) → thiếu field → `NEEDS_REVIEW`, chờ OCR/vision giai đoạn sau.

### Parser profile theo nguồn

- Mỗi nguồn có thể gán `parserProfileId` (bảng `parser_profiles`).
- Profile chứa `coinAliases` (ví dụ `{"PAWS": "BTC"}`), đè lên map mặc định khi parse bài của nguồn đó.
- Flow vận hành: channel format lạ → `NEEDS_REVIEW` → operator xác nhận mapping **1 lần** → `PATCH /v1/sources/:id {parserProfileId}` → các bài sau tự động.
- Coin sau alias vẫn phải qua coin list (`unmapped_symbol_<X>` nếu không có).

## 2. Matching update với tín hiệu gốc

Thứ tự ưu tiên khi khớp update với tín hiệu gốc:

1. Reply/quote ID **trực tiếp**.
2. **Cùng thread**.
3. **Cùng source và author**.
4. **Instrument và direction** tương thích.
5. **Timestamp và giá** tương thích.
6. Semantic similarity **chỉ là yếu tố hỗ trợ** (không dùng làm tiêu chí chính).

> Nếu **nhiều tín hiệu cùng phù hợp**, đưa vào **review queue** — không tự chọn.

### Dedupe cross-source

- Dedupe key là **source + external message ID + revision/hash** — mỗi channel là một source độc lập.
- Nội dung **gần giống nhau từ 2 channel khác nhau không tính là trùng**: mỗi bên tạo signal riêng, đi qua approval và risk riêng.
- Hệ quả: nhiều channel cùng hô 1 lệnh có thể mở nhiều vị thế cùng chiều cùng symbol → RiskEngine chặn bằng **max positions / max positions per symbol**.

### Message edit → version mới (không tạo signal trùng)

- Chủ channel **sửa bài** (edit) → hệ thống lưu **revision mới** của cùng `(sourceId, externalMessageId)`, không ghi đè lịch sử.
- Revision > 1 parse ra NEW sẽ **nối version mới** (`eventType: EDIT`) vào signal đã sinh từ revision cũ, thay vì tạo signal trùng.
- Version mới làm **approval cũ mất hiệu lực** (approve bắt đúng version id mới nhất); signal `FINAL` (REJECTED/CLOSED/...) giữ nguyên trạng thái.
- Không tìm được signal gốc (ví dụ bản gốc chưa từng thấy) → fallback tạo signal mới như thường.

## 3. Quy tắc update

| Hành động | Quy tắc |
|---|---|
| `Modify SL` | Chỉ sửa SL của vị thế **đã xác minh** |
| `Modify TP` | Chỉ sửa TP của vị thế **đã xác minh** |
| `Partial close` | Kiểm tra **volume step** và **volume tối thiểu** |
| `Close all` | Chỉ đóng đúng vị thế mục tiêu **đã match** |
| `TP1 hit` | **Không tự động đóng** vị thế trừ khi policy quy định rõ |
| `Cancel setup` | Chỉ hủy setup **chưa vào lệnh**, trừ khi message nói rõ cần đóng vị thế đang mở |

### Quy tắc chung

- Mọi update tự động phải qua **risk checks** và **action allowlist**.
- Update mơ hồ / không xác thực → không mở/đóng vị thế, đưa review (hỏi operator).
- Update đồng thời phải được **serialize theo signal/position**.

## 4. Liên kết tài liệu

- Vòng đời update: [02-du-lieu/state-machines.md](../02-du-lieu/state-machines.md)
- Duyệt thủ công: [manual-approval.md](manual-approval.md)
- Kiểm soát rủi ro: [04-risk-execution/risk-engine.md](../04-risk-execution/risk-engine.md)
- Xử lý trùng lặp/đồng thời: [04-risk-execution/retry-idempotency.md](../04-risk-execution/retry-idempotency.md)
