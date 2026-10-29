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
3. Nếu **thiếu URL bắt buộc**, báo validation error/review; **không tự bịa link**. Ngoại lệ duy nhất: nguồn Telegram không lưu URL thì dùng link chuẩn `https://t.me/{channel}/{msgId}` (dựng xác định, không bịa). Nguồn operator (`sourceKind=MANUAL`) **không bắt buộc link**: caption hiện tên nguồn (tự nhận diện từ link dán trong text / `src=`, mặc định `Operator (manual)`) không kèm URL.
4. Hiển thị nguồn Telegram **nếu có**; nếu không có, ghi rõ "không có nguồn Telegram".
5. Luôn có **tên destination channel** từ snapshot.
6. **Ảnh card là bằng chứng hiển thị**, không phải nguồn sự thật về vị thế (DB + ledger mới là chuẩn).
7. Update phải **reply đúng `telegram_message_id`** của báo cáo gốc trong đúng destination. `replyTo` chốt lúc request, kiểm tra lại lúc gửi (bài gốc có thể publish sau).
8. Nếu update đến **trước khi bài gốc được publish**: giữ chờ retryable tối đa **5 phút** (`ORIGINAL_NOT_PUBLISHED_YET`); quá hạn mới đăng lẻ + audit `publication.orphaned`. Đã implement.
9. **Publication failure không được kích hoạt lại giao dịch.**
10. Lệnh limit đăng **text-only ngay lúc đặt** (không ảnh), hiển thị **đủ các entry**; bài này là thread gốc. Khi entry đầu khớp, card `filled` **reply vào bài text limit** (không đăng bài gốc mới).

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

Với lệnh limit nhiều entry, dòng Entry liệt kê đủ ladder: `- Entry: 3000, 2950, 2900`.

### Quy tắc áp dụng

- Lệnh **limit / filled / tp / sl / close đều dùng chung khung trên**, chỉ đổi token `{{status}}`; riêng bài `limit` lúc đặt lệnh là **text-only, không đính kèm ảnh**, và liệt kê đủ các entry.
- `{{direction}}` hiển thị **Long/Short**.
- `{{actual_tp}}` = **danh sách mọi TP theo thứ tự** (không còn chỉ TP cuối); TP nào đã khớp thì thêm ngoặc, ví dụ `- TP: 2323 (đã khớp TP1), 2478, 2628`, chưa khớp nào thì `- TP: 2323, 2478, 2628`. Card `tp` **tự ghi luôn TP của chính nó** dù settle gửi card trước khi chốt (ordinal `tpIndex` đi cùng job), nên không bị lệch 1 nhịp; đánh giá theo **chỉ số** chứ không theo giá để TP trùng giá không ghi nhầm. Tương tự `- Entry:` có thể kèm ` (đã khớp 2/3 lệnh)` với lệnh nhiều entry.
- Bài limit lúc đặt lệnh là **text-only**, không render Chromium; khi khớp, card `filled` (photo + caption) **reply vào bài text limit**. Các bài card còn lại **đính kèm ảnh card gen bằng code** (từ dữ liệu vị thế đã xác minh — không chụp MT5; gửi dạng photo + caption là nội dung trên; caption Telegram giới hạn 1024 ký tự). Có **2 kind ảnh card** (`virtual_positions.card_kind`):
  - **`pnl-strip`** (mặc định) — 1280×180: symbol/direction/size + `entry → mark` + PnL lớn.
  - **`position-stats`** — 1040×480 (page 520×240 render ở 2×, font IBM Plex Sans nhúng offline, chuỗi ưu tiên `BinancePlex` nếu máy có sẵn), palette Binance dark (`#181a20` nền, `#0ecb81` lãi/long, `#f6465d` lỗ/short, `#848e9c` nhãn/số 0), label tiếng Việt cỡ 17px, số giữ 18px, header +2px; badge L/S + symbol + tên account + `Cross {lev}X`; PNL (USDT) + ROI; *Kích thước / Margin / Tỉ lệ ký quỹ*; *Giá vào lệnh / Giá đánh dấu / Giá thanh lý*. Card **tự tính** `PNL = dir × (mark−entry) × size` và `ROI = PNL / (size × entry / leverage)` (không phụ thuộc `floatingProfit`; field đó chỉ là fallback khi thiếu giá/size), `notional = size × mark`, `margin = notional/leverage` (hai số này đổi theo mark), `tỉ lệ ký quỹ = Σ maintenance margin (MMR theo bậc notional) / equity tài khoản` (cross account, cùng công thức `/accounts`; snapshot cũ fallback `MMR × leverage`), thanh lý tính bằng `crossLiquidationPrice()` (công thức Cross Binance) — trả `null` → card hiện `--` khi **không có nghiệm dương**: mẫu số `size × (MMR − 1)` của LONG luôn âm nên với equity lớn hơn rất nhiều so với vị thế (VD balance 1,54 triệu vs LONG 129k notional) giá thanh lý là số âm → `--` là kết quả đúng (cùng dữ liệu ở SHORT cho ra số dương, ví dụ 29.532). Không fallback sang giá isolated vì đó không phải mức bị thanh lý thật với tài khoản cross; PNL = 0 hiển thị xám `#848e9c`; `entry` lấy từ signal (fallback mid), `mark` lấy live tại lúc render.
  - `/pos` mở dialog 2 nút hỏi kind (**1 phút** — hết giờ tự render `pnl-strip`). Market entry `/pos`: bot báo `Đang chờ 3s…`, sau đó mới lấy mid và tạo card/publication; job delayed 1 phút và card không render trước **entry + 3s** kể cả khi bấm style sớm; bấm nút chỉ promote job **còn delayed** (marker `delayMs`). Limit entry: position `PENDING_ENTRY`, **đăng ngay bài text limit (không ảnh, đủ entry)**; nút chỉ lưu `card_kind` + `style_chosen` cho card khi khớp; khi entry đầu khớp, nếu đã chọn thì card `filled` reply ngay vào bài text limit, nếu chưa thì job được delay **đúng phần còn lại của 1 phút** rồi fallback PnL (bấm nút trong lúc chờ vẫn promote được). Card TP/SL **kế thừa** kind từ card mở — đọc `virtual_positions.card_kind` **lúc render** và bị render consumer **hold tới khi dialog kết thúc** nên TP/SL nổ giữa dialog vẫn ra đúng kind. Card mở **đông cứng entry/volume/status lúc yêu cầu** (`entry` = signal entry, volume = `size`, `status=OPEN`) nên không hỏng khi position đóng trong 1 phút chờ; `mark` do API fetch live tại lúc render; ROI tính trên margin ban đầu. Card TP/SL/close render `status=CLOSED`.
- Thao tác tay: card `/tp` một phần render `status=OPEN` với `volume = remaining` (snapshot override `open:true`); `/tp` toàn bộ và `/close` render `CLOSED` với `volume = phần vừa chốt`. `/sl` không đăng card.
- Mọi bài cập nhật sau bài đầu tiên **reply vào bài đầu tiên** (xem rule #7).
- Thiếu `source_url` bắt buộc → validation error/review, **không bịa link**.
- Ngoại lệ rule "luôn có tên destination channel": mẫu này không in tên kênh vì bài đăng nằm ngay trong channel đích (tên kênh là implicit).

## 6. Tách render/gửi (trong API)

- API (`card-render`): `apps/api/src/reporting/render.consumer.ts` render PNG bằng Chromium (Playwright) vào volume `artifacts`; chạy trong process API, `concurrency: 1`, tắt bằng `RENDER_WORKER_ENABLED=false`. Card **TP/SL/close được hold** (`styleDialogRemainingMs` → `job.moveToDelayed` + `DelayedError`, re-check mỗi 5s) khi position còn dialog `/pos` đang mở, và kind đọc **lúc render** — card update không bao giờ ra kind cũ do chốt lúc enqueue.
- API (`telegram-send`): dựng caption từ DB, đọc PNG, gửi Telegram, cập nhật `telegram_publications`. Bài limit lúc đặt dùng nhánh **text-only** (`sendMessage`, không đọc artifact). Retry **10 lần, exponential backoff từ 5s** (5s, 10s, 20s… — lần đầu nhanh, đuôi vượt hold 5 phút); trong lúc chờ card gốc thì đổi row sang `RETRY_PENDING`; hết attempts → `FINAL_FAILURE` + bot báo `❌ Không đăng được card …`. Card `filled` sau limit chờ bài text gốc tối đa 5 phút rồi mới đăng lẻ + audit. Card khớp entry DCA dùng `status=entry` (caption vẫn hiện `filled`) và thêm ghi chú `- Entry: <TB> (đã khớp 2/3 lệnh)`.
- API (`market-watch`): poll giá TP/SL, **chỉ detect** rồi enqueue 1 job `position-settle` (jobId dedupe theo vị thế + TP ordinal). Settle: render + reply card trước (chờ tối đa `SETTLE_PUBLISH_TIMEOUT_MS`, mặc định 60s), **mới** đóng lệnh với giá đóng băng — xem [04-risk-execution/risk-engine.md](../04-risk-execution/risk-engine.md) §5. Event `ENTRY` (khớp level DCA) **không qua settle**: poll đã ghi position inline, market-watch chỉ `requestPositionPublish(status=entry)` → card update kế thừa kind + hold khi dialog còn mở.
- `apps/screenshot-worker` chỉ còn là legacy/rollback, không nằm trong compose stack.
- Không lưu metadata ảnh trong DB; file PNG bị xóa ngay sau khi publication `PUBLISHED`. Không còn dọn theo mtime sau 7 ngày.

## 7. Liên kết tài liệu

- API: [06-api/reporting-api.md](../06-api/reporting-api.md)
- Vòng đời publication: [02-du-lieu/state-machines.md](../02-du-lieu/state-machines.md)
- ADR: [ADR-0012](../adr/ADR-0012-publication-snapshot.md)
- Retry publication: [04-risk-execution/retry-idempotency.md](../04-risk-execution/retry-idempotency.md)
