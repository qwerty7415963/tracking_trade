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
- **Không fuzzy-match symbol broker.**

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
- Update mơ hồ / không xác thực → không tác động MT5, đưa review.
- Update đồng thời phải được **serialize theo signal/position**.

## 4. Liên kết tài liệu

- Vòng đời update: [02-du-lieu/state-machines.md](../02-du-lieu/state-machines.md)
- Duyệt thủ công: [manual-approval.md](manual-approval.md)
- Kiểm soát rủi ro: [04-risk-execution/risk-engine.md](../04-risk-execution/risk-engine.md)
- Xử lý trùng lặp/đồng thời: [04-risk-execution/retry-idempotency.md](../04-risk-execution/retry-idempotency.md)
