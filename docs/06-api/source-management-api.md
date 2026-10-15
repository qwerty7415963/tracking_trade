# Source Management API

> Ánh xạ từ plan §9 (Source management API).

## 1. Endpoints

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/api/v1/sources` | Danh sách nguồn |
| POST | `/api/v1/sources` | Tạo nguồn mới |
| POST | `/api/v1/sources/bulk` | Thêm nhiều nguồn, mỗi dòng một handle/ID |
| POST | `/api/v1/sources/bulk-delete` | Xóa mềm nhiều nguồn theo handle/ID |
| GET | `/api/v1/sources/:id` | Chi tiết nguồn |
| PATCH | `/api/v1/sources/:id` | Cập nhật nguồn |
| DELETE | `/api/v1/sources/:id` | Xóa mềm (soft delete) |
| POST | `/api/v1/sources/:id/test-connection` | Kiểm tra kết nối |
| POST | `/api/v1/sources/:id/enable` | Bật thu thập |
| POST | `/api/v1/sources/:id/disable` | Tắt thu thập |
| GET | `/api/v1/sources/:id/health` | Trạng thái health/error |

## 2. Định danh nguồn và bulk API

Bot và bulk API chấp nhận ID, handle Telegram/X (`@channel`, `channel`, `x:@user`, `tg:@channel`) hoặc display name:

- Khớp ID trực tiếp trước, sau đó khớp handle đã chuẩn hóa (`@`, chữ hoa/thường).
- Không khớp hoặc khớp nhiều nguồn đều **báo lỗi rõ ràng**, không đoán thay operator.
- Bulk API trả kết quả từng dòng: `created`, `skipped-duplicate`, `deleted`, `failed`; một dòng lỗi không hủy cả batch.
- Bulk create chuẩn hóa handle về chữ thường và bỏ trùng tương đương handle trước khi tạo.

```json
{
  "lines": ["@alpha", "x:@watcher"],
  "sourceKind": "SIGNAL"
}
```

```json
{
  "refs": ["@alpha", "9f3c2a1e-..."]
}
```

## 3. Khả năng bắt buộc của nguồn

- Hỗ trợ **Telegram** và **X**.
- **Priority** cho nguồn.
- **Collection configuration**.
- **Parser profile**.
- **Enable/disable**.
- **Health/error status**.
- **Credential binding** (kèm ràng buộc: xóa nguồn không xóa credential dùng chung).

## 4. Quy tắc

- Xóa nguồn là **soft delete** để giữ lịch sử.
- Mọi thay đổi phải ghi **audit log** (`created_by`, `updated_by`).
- Endpoint thay đổi trạng thái cần authentication, role authorization và conflict checks.
- Nguồn Telegram `enabled` được **tự động đọc bài mới realtime** (IngestionService subscribe + resync 60s, không cần restart); tắt nguồn thì bài mới bị bỏ qua.

## 5. `test-connection` — kiểm tra quyền thực tế

`POST /api/v1/sources/:id/test-connection` phải kiểm tra quyền đọc/gửi thật, không chỉ kiểm tra credential tồn tại:

- Nguồn Telegram collection (`USER_SESSION`): session còn sống không, đã join channel chưa, có đọc được message mới nhất không.
- Sender `BOT`: bot còn là admin của destination channel không, có quyền post không.
- Kết quả fail ghi `last_error_code` theo quy ước (xem database-design) và cập nhật health.

## 6. Liên kết tài liệu

- Dữ liệu: [02-du-lieu/database-design.md](../02-du-lieu/database-design.md)
- Connector X: [05-connectors/x-connector.md](../05-connectors/x-connector.md)
- Connector Telegram: [05-connectors/telegram-connector.md](../05-connectors/telegram-connector.md)
