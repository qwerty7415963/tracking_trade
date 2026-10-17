# Telegram Reporting

> Ánh xạ từ plan §10 (Telegram reporting).

## 1. Sender và destination

- Hỗ trợ sender: **`BOT`** và **`USER_SESSION`**.
- Cần **xác minh sender có quyền đăng lên destination channel**.
- **Không tự chuyển sang sender khác** khi gửi lỗi trừ khi người dùng cấu hình rõ.

## 2. Template placeholders

Placeholder được phép (allowlist):

- `{{instrument}}`
- `{{direction}}`
- `{{fill_price}}`
- `{{filled_volume}}`
- `{{actual_sl}}`
- `{{actual_tp}}`
- `{{execution_status}}`
- `{{source_display_name}}`
- `{{source_url}}`
- `{{source_telegram_name}}`
- `{{destination_channel_name}}`
- `{{executed_at}}`
- `{{screenshot_caption}}`
- `{{status}}` — token trạng thái hiển thị: `limit` / `filled` / `tp` / `sl` / `close` (map từ `execution_status`)
- `{{entry_price}}` — giá entry hiển thị: lệnh limit chưa khớp → giá đặt; đã filled → `fill_price`

### Ràng buộc template

- **Không** cho chạy JavaScript tùy ý hoặc truy vấn database trực tiếp từ template.
- Phải **escape Markdown/HTML**.
- Chỉ dùng các placeholder trong allowlist.

## 3. Publication intent (snapshot)

Khi tạo publication intent, **snapshot** các giá trị sau:

- Sender.
- Destination.
- Template version.
- Rendered text.
- Source metadata.
- Destination channel name.

> Điều này bảo đảm **thay đổi template sau đó không làm thay đổi bài đã xếp hàng**.

## 4. Publication rules

1. Chỉ báo **filled** khi vị thế ảo đã được mở và ghi DB.
2. Khi nguồn là **X và có URL**, phải hiển thị link nguồn X.
3. Nếu **thiếu URL bắt buộc**, báo validation error/review; **không tự bịa link**. Ngoại lệ duy nhất: nguồn Telegram không lưu URL thì dùng link chuẩn `https://t.me/{channel}/{msgId}` (dựng xác định, không bịa).
4. Hiển thị nguồn Telegram **nếu có**; nếu không có, ghi rõ "không có nguồn Telegram".
5. Luôn có **tên destination channel** từ snapshot.
6. **Ảnh card là bằng chứng hiển thị**, không phải nguồn sự thật về vị thế (DB + ledger mới là chuẩn).
7. Update phải **reply đúng `telegram_message_id`** của báo cáo gốc trong đúng destination. `replyTo` chốt lúc request, kiểm tra lại lúc gửi (bài gốc có thể publish sau).
8. Nếu update đến **trước khi bài gốc được publish**: giữ chờ retryable tối đa **5 phút** (`ORIGINAL_NOT_PUBLISHED_YET`); quá hạn mới đăng lẻ + audit `publication.orphaned`. Đã implement.
9. **Publication failure không được kích hoạt lại giao dịch.**

## 5. Mẫu bài đăng khi vào lệnh

Template chính thức (chỉ dùng placeholder allowlist, parse_mode HTML, nội dung escape):

```text
{{direction}} {{instrument}} - {{status}}

- Entry: {{entry_price}}
- SL: {{actual_sl}}
- TP: {{actual_tp}}

{{source_display_name}}

{{source_url}}
```

Ví dụ render thật:

```text
Short ETH - limit

- Entry: 2583.79
- SL: 2597.17
- TP: 2499

Osho

https://t.me/traderosho/4375
```

### Quy tắc áp dụng

- Lệnh **limit / filled / tp / sl / close đều dùng chung khung trên**, chỉ đổi token `{{status}}`.
- `{{direction}}` hiển thị **Long/Short**.
- Bài đầu tiên **đính kèm ảnh card P&L gen bằng code** (1280×180, từ dữ liệu vị thế đã xác minh — không chụp MT5; gửi dạng photo + caption là nội dung trên; caption Telegram giới hạn 1024 ký tự).
- Mọi bài cập nhật sau bài đầu tiên **reply vào bài đầu tiên** (xem rule #7).
- Thiếu `source_url` bắt buộc → validation error/review, **không bịa link**.
- Ngoại lệ rule "luôn có tên destination channel": mẫu này không in tên kênh vì bài đăng nằm ngay trong channel đích (tên kênh là implicit).

## 6. Tách render/gửi (worker/API)

- Worker (`card-render`): chỉ render PNG bằng Chromium vào volume `artifacts` chung.
- API (`telegram-send`): dựng caption từ DB, đọc PNG, gửi Telegram, cập nhật `telegram_publications`.
- API (`market-watch`): poll giá TP/SL, enqueue publish khi hit.
- Không lưu metadata ảnh trong DB; file PNG dọn theo mtime sau 7 ngày.

## 7. Liên kết tài liệu

- API: [06-api/reporting-api.md](../06-api/reporting-api.md)
- Vòng đời publication: [02-du-lieu/state-machines.md](../02-du-lieu/state-machines.md)
- ADR: [ADR-0012](../adr/ADR-0012-publication-snapshot.md)
- Retry publication: [04-risk-execution/retry-idempotency.md](../04-risk-execution/retry-idempotency.md)
