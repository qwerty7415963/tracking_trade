# Operations API

> Ánh xạ từ plan §11 (Operations API).

## 1. Endpoints

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/signals` | Danh sách tín hiệu |
| GET | `/api/v1/signals/:id` | Chi tiết tín hiệu |
| POST | `/api/v1/signals/:id/approve` | Duyệt tín hiệu |
| POST | `/api/v1/signals/:id/reject` | Từ chối tín hiệu |
| POST | `/api/v1/signals/:id/expire` | Hết hạn tín hiệu |
## 1. Endpoints

### Signals (giữ nguyên)

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/signals` | Danh sách tín hiệu |
| GET | `/api/v1/signals/:id` | Chi tiết tín hiệu |
| GET | `/api/v1/operations/open-mode` | Xem switch mở lệnh toàn cục |
| POST | `/api/v1/operations/open-mode` | Đổi switch (`MANUAL`/`AUTO`), ghi audit |
| POST | `/api/v1/signals/:id/approve` | Duyệt + mở vị thế ảo (approve = open) |
| POST | `/api/v1/signals/:id/reject` | Từ chối tín hiệu |
| POST | `/api/v1/signals/:id/expire` | Hết hạn tín hiệu |
| POST | `/api/v1/signals/manual` | Tạo + duyệt + mở + đăng ngay từ text — link trong text tự nhận diện (`text`, `sourceUrl?` override, `sourceName?`, `cardKind?` = `pnl-strip`\|`position-stats`, `accountId?`, `destinationChatId?`) |
| GET | `/api/v1/updates/review-queue` | Hàng đợi review update |
| POST | `/api/v1/updates/:id/approve` | Duyệt update |
| POST | `/api/v1/updates/:id/reject` | Từ chối update |

### Virtual accounts

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/accounts` | Danh sách tài khoản ảo |
| POST | `/api/v1/accounts` | Tạo tài khoản (name, balance, leverage?, mode?) |
| GET | `/api/v1/accounts/:id` | Tổng quan: equity, margin ratio, vị thế mở, PnL |
| POST | `/api/v1/accounts/:id/deposit` | Nạp vốn ảo |
| POST | `/api/v1/accounts/:id/withdraw` | Rút vốn ảo |
| POST | `/api/v1/accounts/:id/reset` | Đóng hết + đặt lại số dư |
| PATCH | `/api/v1/accounts/:id` | Đổi mode (`AUTO`/`APPROVE`) hoặc leverage |

### Virtual positions

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/positions` | Danh sách vị thế (`?status=`) |
| GET | `/api/v1/positions/:id` | Chi tiết vị thế |
| POST | `/api/v1/positions/open` | Mở lại cho signal đã approve (`signalId`, `accountId?`) |
| POST | `/api/v1/positions/:id/close` | Đóng thủ công theo giá thị trường |

### Vận hành

| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/v1/operations/kill-switch` | Bật/tắt kill switch |
| GET | `/api/v1/operations/notional` | Danh sách notional cố định theo coin |
| PUT | `/api/v1/operations/notional/:symbol` | Đổi notional `{notionalUsd}`, ghi audit |
| DELETE | `/api/v1/operations/notional/:symbol` | Reset notional về mặc định theo ticker |
| GET | `/api/v1/health` | Health check |

## 2. Quy tắc

- Mọi endpoint thay đổi trạng thái cần:
  - **Authentication**.
  - **Role authorization**: username phải thuộc danh sách `OPERATOR_USERNAMES` (1 biến env duy nhất, comma-separated).
  - **Audit log** (ghi rõ username thực hiện).
  - **Conflict checks**.
- Approve/reject tín hiệu phải gắn với **đúng signal version** (xem [manual-approval](../03-nghiep-vu/manual-approval.md)). Approve đồng nghĩa mở vị thế ảo; mở thất bại không hủy approval (ghi rõ lý do, retry qua `/positions/open`).
- Kill switch có hai chế độ: `STOP NEW TRADES` và `STOP ALL AUTOMATED MUTATIONS` (xem [risk-engine](../04-risk-execution/risk-engine.md)).

## 3. Operator bot commands

Điều phối viên điều khiển hệ thống qua lệnh chat với bot (lớp vỏ ngoài đúng service + rule của REST API ở mục 1).

> Bot chạy **chung process API** (`OPERATOR_BOT_ENABLED=true` cho service api). Worker để `false`. Chỉ **một** process được poll Telegram trên mỗi bot token, tránh `409 Conflict` và DM trùng.

| Lệnh | Tác dụng |
|---|---|
| `/approve <id>` | Duyệt + mở vị thế ảo (đúng version) |
| `/pos <signal text + post link> [src=".."] [chat=..] [acc=..]` | Tạo signal + duyệt + mở + hỏi chọn card (2 nút, 5 phút — không bấm dùng card PnL); link dán vào text là tự nhận diện. Card mở render từ snapshot đông cứng lúc gọi nên vẫn đăng dù position đóng trong 5 phút chờ; đăng lỗi → bot DM "❌ Không đăng được card …" |
| `/reject <id> [lý do]` | Từ chối tín hiệu |
| `/open <signalId> [accountId]` | Mở lại cho signal đã approve |
| `/close <positionId>` | Đóng vị thế theo giá thị trường |
| `/positions [status]` | Danh sách vị thế ảo (in **id đầy đủ** để dán vào `/close`) |
| `/account [id]` | Tổng quan tài khoản (equity, margin, PnL) |
| `/accounts` | Danh sách tài khoản ảo (in **id đầy đủ** để dán vào `/deposit`/`/withdraw`/`/reset`) |
| `/mode [auto\|approve] [accountId]` | Xem/đổi mode mở lệnh từng ví |
| `/openmode [manual\|auto]` | Xem/đổi switch mở lệnh toàn cục |
| `/deposit <accountId> <amount>` | Nạp vốn ảo |
| `/withdraw <accountId> <amount>` | Rút vốn ảo |
| `/reset <accountId> <balance>` | Đóng hết + đặt lại số dư |
| `/review` | Hàng đợi review (signals + updates) |
| `/sources` | Danh sách kênh đang theo dõi (in **id đầy đủ** để dán vào `/source_del`/`/source_edit`) |
| `/source_add` | Thêm nhiều kênh, mỗi dòng một handle/ID; trùng handle được bỏ qua |
| `/source_del` | Xóa mềm nhiều kênh theo handle/ID, giữ lịch sử |
| `/source_edit <ref> name=".." kind=.. priority=..` | Sửa kênh theo handle/ID |
| `/source_enable\|/source_disable <ref> [...]` | Bật/tắt thu thập từng kênh |
| `/source_health <ref> [...]` | Xem health đã lưu của từng kênh |
| `/coins` | Danh sách coin trade được |
| `/coin_add` | Thêm nhiều coin, mỗi dòng một symbol; trùng được bỏ qua |
| `/coin_del` | Xóa hẳn nhiều coin, giữ lịch sử audit |
| `/coin_enable\|/coin_disable <SYM> [...]` | Bật/tắt từng coin |
| `/vol [SYM] [amount\|reset]` | Xem/đổi notional cố định (USDC) của coin; BTC/ETH/SOL mặc định 100k, còn lại 50k |
| `/kill [new\|all]` | Bật kill switch (`STOP NEW TRADES` / `STOP ALL AUTOMATED MUTATIONS`) |

Review mơ hồ: bot **DM thẳng từng operator** (theo `OPERATOR_CHAT_IDS`) kèm nút **Approve** / **Reject** (inline buttons); bấm Reject từ chối ngay. Một operator block bot không ảnh hưởng người còn lại; chưa cấu hình chat nào thì không gửi (log warn).

### Định dạng review (không hiện id/UNKNOWN)

Mỗi thông báo review gồm card trực quan, không bao giờ in id đầy đủ hay `UNKNOWN UNKNOWN`:

- Signal: hướng + coin + trạng thái + version, lý do review (ví dụ `thiếu entry`), Entry/SL/TP, tên nguồn + nền tảng + giờ bài gốc.
- Update: action + trạng thái validation, tóm tắt signal đã khớp (hoặc “chưa khớp”), lý do review.
- `/review` liệt kê tối đa 5 signal + 5 update, **mỗi item một tin nhắn riêng kèm nút**, thừa thì ghi `+N more`. Mỗi dòng kèm **link tới bài viết gốc** (dựng từ handle + message id, ưu tiên URL đã lưu).

### Hành động ngay trên tin review

- Signal: nút **Approve** / **Reject** / **✏️ Bổ sung** (id nằm trong nút, không hiện ra mắt).
- Update đã khớp: **Approve** / **Reject**.
- Update mơ hồ: nút chọn ứng viên 1️⃣2️⃣3️⃣ + **Reject** (callback 64 bytes nên dùng nonce server-side, hết hạn 15 phút).
- **✏️ Bổ sung**: bấm → reply phần còn thiếu (số **hoặc hướng** `long`/`short`, vd `long entry 1224 sl 1068`) → hệ thống gộp với bài gốc, parse lại, nối version `MANUAL` vào đúng signal → card mới. Reply không thêm gì mới (vd `ok`) bị từ chối, không tạo version rác. Hết hạn sau 5 phút, `/cancel` để hủy; signal đã chốt thì từ chối.

### Forward bài gốc

- Với nguồn Telegram có `external_message_id` là số: bot thử `forwardMessage` bài gốc vào DM trước, rồi gửi card kèm nút.
- Forward thất bại (kênh private, nội dung bảo vệ, nguồn X, id không phải số) → fallback gửi **nội dung text đã lưu trong `source_messages`** kèm tác giả/giờ/nguồn/URL.
- Hiện chỉ forward/gửi text đã lưu; media chưa được ingestion lưu nên chưa kèm được.

> Điều kiện tiên quyết: mỗi operator nhắn `/start` cho bot **một lần**, nếu không Telegram chặn DM từ bot. Lấy chat_id bằng cách forward 1 tin nhắn bất kỳ cho @userinfobot.

### Quy tắc

- Chỉ username trong `OPERATOR_USERNAMES`, chỉ trong **private chat** — bot không nhận lệnh trong group/channel.
- Rate limit lệnh liên tiếp; mọi lệnh đổi trạng thái tuân thủ đúng rule mục 2 (auth, audit, conflict checks, approval đúng version).
- Quản lý nguồn qua bot dùng cùng resolver “không đoán”: ID trước, handle chuẩn hóa sau; mơ hồ thì yêu cầu dùng ID.
- **Không cho qua bot:** đổi risk limits, sửa template/route, xóa dữ liệu, deploy. Ngoại lệ: vòng đời nguồn (`/source_add`, `/source_del`, `/source_edit`, enable/disable), trong đó xóa nguồn luôn là **soft delete**, giữ lịch sử và ghi audit; và `/vol` đổi notional cố định theo coin (có audit, áp dụng ngay).

## 4. Liên kết tài liệu

- Duyệt thủ công: [03-nghiep-vu/manual-approval.md](../03-nghiep-vu/manual-approval.md)
- Risk: [04-risk-execution/risk-engine.md](../04-risk-execution/risk-engine.md)
