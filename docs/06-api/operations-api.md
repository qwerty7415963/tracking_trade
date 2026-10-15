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
| POST | `/api/v1/signals/:id/approve` | Duyệt + mở vị thế ảo (approve = open) |
| POST | `/api/v1/signals/:id/reject` | Từ chối tín hiệu |
| POST | `/api/v1/signals/:id/expire` | Hết hạn tín hiệu |
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
| `/reject <id> [lý do]` | Từ chối tín hiệu |
| `/open <signalId> [accountId]` | Mở lại cho signal đã approve |
| `/close <positionId>` | Đóng vị thế theo giá thị trường |
| `/positions [status]` | Danh sách vị thế ảo |
| `/account [id]` | Tổng quan tài khoản (equity, margin, PnL) |
| `/mode [auto\|approve] [accountId]` | Xem/đổi mode mở lệnh |
| `/deposit <accountId> <amount>` | Nạp vốn ảo |
| `/withdraw <accountId> <amount>` | Rút vốn ảo |
| `/reset <accountId> <balance>` | Đóng hết + đặt lại số dư |
| `/review` | Hàng đợi review (signals + updates) |
| `/sources` | Danh sách kênh đang theo dõi |
| `/source_add` | Thêm nhiều kênh, mỗi dòng một handle/ID; trùng handle được bỏ qua |
| `/source_del` | Xóa mềm nhiều kênh theo handle/ID, giữ lịch sử |
| `/source_edit <ref> name=".." kind=.. priority=..` | Sửa kênh theo handle/ID |
| `/source_enable\|/source_disable <ref> [...]` | Bật/tắt thu thập từng kênh |
| `/source_health <ref> [...]` | Xem health đã lưu của từng kênh |
| `/kill [new\|all]` | Bật kill switch (`STOP NEW TRADES` / `STOP ALL AUTOMATED MUTATIONS`) |

Review mơ hồ: bot **DM thẳng từng operator** (theo `OPERATOR_CHAT_IDS`) kèm nút **Approve** / **Reject** (inline buttons); bấm Reject từ chối ngay. Một operator block bot không ảnh hưởng người còn lại; chưa cấu hình chat nào thì không gửi (log warn).

> Điều kiện tiên quyết: mỗi operator nhắn `/start` cho bot **một lần**, nếu không Telegram chặn DM từ bot. Lấy chat_id bằng cách forward 1 tin nhắn bất kỳ cho @userinfobot.

### Quy tắc

- Chỉ username trong `OPERATOR_USERNAMES`, chỉ trong **private chat** — bot không nhận lệnh trong group/channel.
- Rate limit lệnh liên tiếp; mọi lệnh đổi trạng thái tuân thủ đúng rule mục 2 (auth, audit, conflict checks, approval đúng version).
- Quản lý nguồn qua bot dùng cùng resolver “không đoán”: ID trước, handle chuẩn hóa sau; mơ hồ thì yêu cầu dùng ID.
- **Không cho qua bot:** đổi risk limits, sửa template/route, xóa dữ liệu, deploy. Ngoại lệ duy nhất là vòng đời nguồn (`/source_add`, `/source_del`, `/source_edit`, enable/disable), trong đó xóa nguồn luôn là **soft delete**, giữ lịch sử và ghi audit.

## 4. Liên kết tài liệu

- Duyệt thủ công: [03-nghiep-vu/manual-approval.md](../03-nghiep-vu/manual-approval.md)
- Risk: [04-risk-execution/risk-engine.md](../04-risk-execution/risk-engine.md)
