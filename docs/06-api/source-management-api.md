# Source Management API

> Ánh xạ từ plan §9 (Source management API).

## 1. Endpoints

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/sources` | Danh sách nguồn |
| POST | `/api/v1/sources` | Tạo nguồn mới |
| GET | `/api/v1/sources/:id` | Chi tiết nguồn |
| PATCH | `/api/v1/sources/:id` | Cập nhật nguồn |
| DELETE | `/api/v1/sources/:id` | Xóa mềm (soft delete) |
| POST | `/api/v1/sources/:id/test-connection` | Kiểm tra kết nối |
| POST | `/api/v1/sources/:id/enable` | Bật thu thập |
| POST | `/api/v1/sources/:id/disable` | Tắt thu thập |
| GET | `/api/v1/sources/:id/health` | Trạng thái health/error |

## 2. Khả năng bắt buộc của nguồn

- Hỗ trợ **Telegram** và **X**.
- **Priority** cho nguồn.
- **Collection configuration**.
- **Parser profile**.
- **Enable/disable**.
- **Health/error status**.
- **Credential binding** (kèm ràng buộc: xóa nguồn không xóa credential dùng chung).

## 3. Quy tắc

- Xóa nguồn là **soft delete** để giữ lịch sử.
- Mọi thay đổi phải ghi **audit log** (`created_by`, `updated_by`).
- Endpoint thay đổi trạng thái cần authentication, role authorization và conflict checks.

## 4. `test-connection` — kiểm tra quyền thực tế

`POST /api/v1/sources/:id/test-connection` phải kiểm tra quyền đọc/gửi thật, không chỉ kiểm tra credential tồn tại:

- Nguồn Telegram collection (`USER_SESSION`): session còn sống không, đã join channel chưa, có đọc được message mới nhất không.
- Sender `BOT`: bot còn là admin của destination channel không, có quyền post không.
- Kết quả fail ghi `last_error_code` theo quy ước (xem database-design) và cập nhật health.

## 5. Liên kết tài liệu

- Dữ liệu: [02-du-lieu/database-design.md](../02-du-lieu/database-design.md)
- Connector X: [05-connectors/x-connector.md](../05-connectors/x-connector.md)
- Connector Telegram: [05-connectors/telegram-connector.md](../05-connectors/telegram-connector.md)
