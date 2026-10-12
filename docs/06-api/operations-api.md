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
| GET | `/api/v1/updates/review-queue` | Hàng đợi review update |
| POST | `/api/v1/updates/:id/approve` | Duyệt update |
| POST | `/api/v1/updates/:id/reject` | Từ chối update |
| GET | `/api/v1/executions` | Danh sách execution |
| POST | `/api/v1/operations/kill-switch` | Bật/tắt kill switch |
| POST | `/api/v1/operations/reconcile` | Kích hoạt reconcile |
| GET | `/api/v1/health` | Health check |

## 2. Quy tắc

- Mọi endpoint thay đổi trạng thái cần:
  - **Authentication**.
  - **Role authorization**: username phải thuộc danh sách `OPERATOR_USERNAMES` (1 biến env duy nhất, comma-separated).
  - **Audit log** (ghi rõ username thực hiện).
  - **Conflict checks**.
- Approve/reject tín hiệu phải gắn với **đúng signal version** (xem [manual-approval](../03-nghiep-vu/manual-approval.md)).
- Kill switch có hai chế độ: `STOP NEW TRADES` và `STOP ALL AUTOMATED MUTATIONS` (xem [risk-engine](../04-risk-execution/risk-engine.md)).
- Reconcile dùng cho trạng thái UNKNOWN — không được bỏ qua.

## 3. Operator bot commands

Điều phối viên điều khiển hệ thống qua lệnh chat với bot (lớp vỏ ngoài đúng service + rule của REST API ở mục 1).

| Lệnh | Tác dụng |
|---|---|
| `/status` | Trạng thái hệ thống, kill switch, bridge heartbeat |
| `/signals` | Danh sách tín hiệu chờ duyệt |
| `/signal <id>` | Chi tiết 1 tín hiệu |
| `/approve <id>` | Duyệt tín hiệu (đúng version) |
| `/reject <id> [lý do]` | Từ chối tín hiệu |
| `/approve_update <id>` / `/reject_update <id>` | Duyệt/từ chối update trong review queue |
| `/kill [new\|all]` | Bật kill switch (`STOP NEW TRADES` / `STOP ALL AUTOMATED MUTATIONS`) |
| `/resume` + `/confirm` | Gỡ kill switch / cho phép trading lại — bắt buộc **xác nhận 2 bước**, thiếu `/confirm` thì vô hiệu |
| `/source_enable <id>` / `/source_disable <id>` | Bật/tắt nguồn |
| `/reconcile` | Kích hoạt đối chiếu broker |
| `/executions` / `/health` | Xem executions / health (read-only) |

### Quy tắc

- Chỉ username trong `OPERATOR_USERNAMES`, chỉ trong **private chat** — bot không nhận lệnh trong group/channel.
- Mọi lệnh đổi trạng thái tuân thủ đúng rule mục 2 (auth, audit, conflict checks, approval đúng version).
- **Không cho qua bot:** đổi risk limits, sửa template/route, xóa dữ liệu, deploy.

## 4. Liên kết tài liệu

- Duyệt thủ công: [03-nghiep-vu/manual-approval.md](../03-nghiep-vu/manual-approval.md)
- Risk: [04-risk-execution/risk-engine.md](../04-risk-execution/risk-engine.md)
- Reconcile: [04-risk-execution/mt5-bridge.md](../04-risk-execution/mt5-bridge.md)
