# Database Design

> Ánh xạ từ plan §3 (Database design).

## 1. Nguyên tắc chung

- Dùng transaction và database constraints cho các thao tác nội bộ.
- Dùng **transactional outbox** để không mất event giữa DB commit và background processing.
- Giá và volume dùng **decimal-safe representation** (không dùng float).
- Không chỉ dựa vào Redis hoặc in-memory cache để deduplicate.
- Không lưu secret dạng plaintext trong logs.
- **Giá Hyperliquid là nguồn sự thật** cho mark price; DB + ledger là hệ thống ghi chép nhất quán.
- Xóa nguồn là **soft delete** để giữ lịch sử.

## 2. Các bảng chính

### 2.1 `sources`

Quản lý nguồn Telegram và X.

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `platform` | `TELEGRAM` \| `X` |
| `external_source_id` | ID nguồn bên ngoài |
| `display_name` | Tên hiển thị |
| `source_kind` | `SIGNAL` \| `NEWS` \| `MIXED` |
| `enabled` | Bật/tắt thu thập |
| `priority` | Độ ưu tiên khi khớp update |
| `collection_config_json` | Cấu hình thu thập dạng JSON |
| `parser_profile_id` | Hồ sơ parser được gán |
| `created_by` | Người tạo |
| `updated_by` | Người sửa |
| `deleted_at` | Soft delete |
| `last_error_code` | Mã lỗi connector gần nhất (xem quy ước bên dưới) |
| `last_error_at` | Thời điểm lỗi gần nhất |
| `created_at` | Thời điểm tạo |
| `updated_at` | Thời điểm cập nhật |

#### Quy ước `last_error_code` cho nguồn Telegram

| Mã | Ý nghĩa | Hành động |
|---|---|---|
| `BOT_NOT_ADMIN` | Bot bị gỡ quyền admin khỏi channel | Báo operator; kiểm tra lại quyền |
| `SESSION_EXPIRED` | USER_SESSION hết hạn | Re-login, cập nhật credential |
| `SESSION_REVOKED` | Session bị thu hồi/ban | Dừng collection nguồn liên quan, báo operator |
| `JOIN_FLOOD_WAIT` | Join channel quá nhanh, dính flood limit | Backoff, join lại sau; giảm tốc độ join |
| `NOT_A_MEMBER` | Session chưa join channel | Join lại trước khi bật collection |
| `PRIVATE_NEED_INVITE` | Channel private thiếu invite link | Bổ sung invite link vào `collection_config_json` |
| `MISSING_CREDENTIALS` | Thiếu `TELEGRAM_API_ID/HASH/SESSION_STRING` | Điền env rồi thử lại |
| `UNKNOWN_COLLECTION_ERROR` | Lỗi thu thập chưa phân loại | Xem log, báo operator |
| `CONNECTOR_DISABLED` | X connector chưa có sau spike | Chờ Phase 0/2 hoàn thành spike |
| `CIRCUIT_OPEN` | X circuit breaker đang mở | Chờ cooldown, kiểm tra lại sau |

> Source gặp lỗi collection chuyển `health` sang error; pipeline các nguồn khác vẫn chạy bình thường.

### 2.2 `connector_credentials`

Quản lý tham chiếu tới credentials đã mã hóa.

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `provider` | Nhà cung cấp (telegram/x/...) |
| `credential_name` | Tên credential |
| `encrypted_secret_ref` | Tham chiếu secret đã mã hóa (không lưu plaintext) |
| `account_label` | Nhãn tài khoản |
| `status` | Trạng thái |
| `last_validated_at` | Lần xác thực gần nhất |

> **Không lưu** password, session cookie hoặc token dạng plaintext trong database.

### 2.3 `source_credential_bindings`

Liên kết credentials với nguồn và mục đích sử dụng.

- Một credential có thể được **chia sẻ** giữa nhiều nguồn.
- Xóa nguồn **không được xóa** credential đang được nguồn khác sử dụng.

### 2.4 `source_messages`

Lưu message gốc.

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `source_id` | FK tới `sources` |
| `external_message_id` | ID message bên ngoài |
| `revision` | Bản sửa (khi nguồn edit message) |
| `content_raw` | Nội dung thô gốc |
| `author_id` | ID tác giả |
| `author_name` | Tên tác giả |
| `source_url` | URL gốc (nếu có) |
| `thread_id` | ID thread |
| `reply_to_message_id` | ID message được reply |
| `quoted_message_id` | ID message được quote |
| `source_timestamp` | Thời điểm nguồn phát |
| `received_at` | Thời điểm hệ thống nhận |
| `content_hash` | Hash nội dung |

Dedupe dựa trên **nguồn + external message ID + revision/hash**.

### 2.5 `signals`

Lưu thực thể tín hiệu gốc.

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `source_id` | FK tới `sources` |
| `instrument` | Công cụ giao dịch |
| `direction` | Hướng giao dịch |
| `status` | Trạng thái vòng đời (xem state machines) |
| `created_at` | Thời điểm tạo |
| `updated_at` | Thời điểm cập nhật |

### 2.6 `signal_versions`

Lưu từng phiên bản tín hiệu **bất biến**.

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `signal_id` | FK tới `signals` |
| `version_number` | Số phiên bản (tăng dần) |
| `event_type` | Loại sự kiện |
| `instrument` | Công cụ |
| `direction` | Hướng |
| `order_type` | Loại lệnh |
| `entry` | Vùng entry |
| `stop_loss` | Stop loss |
| `take_profits` | Take profits (danh sách) |
| `normalized_payload_json` | Payload chuẩn hóa |
| `parser_version` | Phiên bản parser |
| `created_at` | Thời điểm tạo |

> Khi tín hiệu thay đổi, **tạo version mới** thay vì sửa lịch sử cũ.

### 2.7 `signal_updates`

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `source_message_id` | FK tới `source_messages` |
| `matched_signal_id` | FK tới `signals` (sau khi match) |
| `match_confidence` | Độ tin cậy khớp |
| `validation_status` | Trạng thái xác thực |
| `action_type` | Loại hành động |
| `action_payload_json` | Payload hành động |
| `review_reason` | Lý do đưa vào review |
| `created_at` | Thời điểm tạo |

### 2.8 `approvals`

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `signal_id` | FK tới `signals` |
| `signal_version_id` | FK tới `signal_versions` |
| `decision` | `APPROVED` \| `REJECTED` |
| `approved_by` | Người duyệt |
| `reason` | Lý do |
| `created_at` | Thời điểm |

> Approval phải gắn với chính xác `signal_version_id`. Nếu version thay đổi, approval cũ **không còn quyền cho phép execute**.

### 2.9 `virtual_accounts`

Tài khoản giấy (paper) mô phỏng cross-margin Hyperliquid.

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `name` | Tên tài khoản |
| `balance` | Số dư USDC (chỉ đổi khi nạp/rút/chốt lãi-lỗ) |
| `leverage` | Đòn bẩy mặc định (mặc định 10, 1..50) |
| `mode` | `APPROVE` (mặc định) \| `AUTO` |
| `margin_type` | Luôn `CROSS` trong MVP |
| `created_at` / `updated_at` | Thời điểm |

### 2.10 `virtual_positions`

Vị thế giấy theo dõi giá Hyperliquid.

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `account_id` | FK tới `virtual_accounts` |
| `signal_id` / `signal_version_id` | FK tới tín hiệu gốc (traceability) |
| `coin` | Tên coin Hyperliquid đã resolve (ví dụ `ETH`, `PAXG`) |
| `direction` | `LONG` \| `SHORT` |
| `size` | Size mở (đơn vị coin) |
| `entry_price` | Giá entry của signal (fallback mid lúc mở) |
| `stop_loss` | SL (bắt buộc) |
| `take_profits` | Mảng TP theo thứ tự |
| `leverage` | Đòn bẩy lúc mở (snapshot từ account) |
| `remaining_size` | Size còn mở |
| `filled_tps` | Các TP đã chạm |
| `status` | `OPEN` / `TP_HIT` / `SL_HIT` / `CLOSED` / `CANCELLED` |
| `opened_at` / `closed_at` | Thời điểm |
| `close_price` | Giá đóng cuối |
| `realized_pnl` | Lãi-lỗ đã chốt cộng dồn (USDC) |
| `card_kind` | Style ảnh card: `pnl-strip` (mặc định, 1280×180) \| `position-stats` (card thống kê tiếng Việt). Chọn lúc `/pos` — mọi card update (TP/SL) kế thừa. |

Quy tắc multi-TP: TP1 đóng 50%, các TP còn lại chia đều phần còn lại; TP duy nhất đóng 100%; SL đóng toàn bộ phần còn lại.

### 2.11 `virtual_transactions`

Sổ cái (ledger) mọi biến động số dư: `DEPOSIT` / `WITHDRAW` / `REALIZED_PNL`, kèm `reference` và thời điểm. Nguồn duy nhất tính balance history và realized PnL.

### 2.12 `risk_events`

Lưu risk check, cấu hình liên quan, kết quả và lý do từ chối (cho cả mở lệnh ảo).

### 2.13 `telegram_sender_accounts`

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `account_type` | `BOT` \| `USER_SESSION` |
| `display_name` | Tên hiển thị |
| `credential_ref` | Tham chiếu credential |
| `status` | Trạng thái |
| `last_validated_at` | Lần xác thực gần nhất |
| `last_error` | Lỗi gần nhất |

### 2.14 `telegram_destinations`

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `sender_account_id` | FK tới sender account |
| `chat_id` | Chat ID Telegram |
| `channel_name` | Tên kênh |
| `enabled` | Bật/tắt |

### 2.15 `reporting_templates`

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `name` | Tên template |
| `event_type` | Loại sự kiện |
| `template_body` | Nội dung template |
| `template_version` | Phiên bản template |
| `required_fields_json` | Các trường bắt buộc |
| `parse_mode` | Chế độ parse (HTML/Markdown) |
| `is_active` | Kích hoạt |
| `created_by` | Người tạo |
| `updated_by` | Người sửa |

### 2.16 `reporting_routes`

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `event_type` | Loại sự kiện |
| `destination_id` | FK tới destination |
| `template_id` | FK tới template |
| `enabled` | Bật/tắt |
| `priority` | Độ ưu tiên |

### 2.17 `telegram_publications`

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `virtual_position_id` | FK tới `virtual_positions` (nullable, bài báo cáo chung) |
| `sender_account_id` | Sender |
| `destination_id` | Destination |
| `template_id` | Template |
| `template_version` | Version template đã snapshot |
| `source_message_id` | Message nguồn |
| `source_platform` | Nền tảng nguồn |
| `source_url` | URL nguồn |
| `source_display_name` | Tên hiển thị nguồn |
| `source_telegram_name` | Tên Telegram nguồn |
| `destination_channel_name` | Tên kênh đích |
| `rendered_text` | Nội dung đã render |
| `telegram_message_id` | Message ID sau khi gửi |
| `publication_status` | Trạng thái publication |
| `created_at` | Thời điểm tạo |
| `published_at` | Thời điểm publish |

> `telegram_publications` là **snapshot** tại thời điểm tạo publication intent — template thay đổi sau đó không làm đổi bài đã xếp hàng.

### 2.18 Ảnh card (không lưu DB)

Ảnh card P&L gen bằng code **không lưu metadata trong database** — worker ghi file PNG vào volume `artifacts` dùng chung (`<renderId>.png`), API đọc file khi gửi. Trạng thái đăng vẫn theo dõi qua `telegram_publications`.

- Retention 7 ngày: API quét folder theo mtime, không cần bảng.
- Idempotency theo `publicationId` (`telegram-send` jobId `send:<publicationId>`, render jobId `render:<publicationId>`).

### 2.19 `tradable_coins` (coin list do operator quản lý)

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `symbol` | Unique, chữ hoa (`BTC`, `ZEC`) |
| `enabled` | Bật/tắt (tắt mềm an toàn hơn xóa) |
| `notional_usd` | Notional cố định mỗi lệnh (USDC); BTC/ETH/SOL 100k, còn lại 50k |
| `notes` | Ghi chú |
| `created_by` / `updated_by` | Audit |
| `created_at` / `updated_at` | Thời điểm |

Seed 8 mã: `BTC, ETH, SOL, XRP, DOGE, XAU, XAG, PAXG`. Xóa hẳn an toàn vì không có FK lịch sử.

### 2.20 `parser_profiles` (alias coin theo channel)

| Trường | Ghi chú |
|---|---|
| `id` | Khóa chính |
| `name` | Unique |
| `coin_aliases` | JSON `{NICKNAME: COIN}`, đè map mặc định |
| `notes`, audit, timestamps | Như `tradable_coins` |

Gán qua `sources.parser_profile_id` (`PATCH /v1/sources/:id`).

### 2.21 Các bảng khác

- `audit_logs` — lịch sử mọi thao tác tài chính và quản trị.
- `outbox_events` — transactional outbox.

## 3. Data integrity

- Transaction + constraints cho thao tác nội bộ.
- Transactional outbox giữa DB commit và background processing.
- Giá/volume dùng decimal-safe representation.
- Deduplicate không dựa vào Redis/in-memory.
- Không lưu secret trong logs.
- Giá Hyperliquid là nguồn sự thật cho mark price; thiếu quote thì từ chối, không đoán.

## 4. Liên kết tài liệu

- Vòng đời trạng thái (signal/update/vị thế ảo/publication): [state-machines.md](state-machines.md)
- Outbox: [ADR-0005](../adr/ADR-0005-transactional-outbox.md)
- Idempotency: [04-risk-execution/retry-idempotency.md](../04-risk-execution/retry-idempotency.md)
