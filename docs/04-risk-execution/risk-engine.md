# Risk Engine

> Ánh xạ từ plan §7 (Risk engine).

## 1. Các kiểm tra bắt buộc

Trước mọi thao tác giao dịch (mở lệnh, sửa SL/TP, close), RiskEngine phải kiểm tra:

- Đúng **tài khoản MT5**.
- **Terminal và EA heartbeat** khỏe.
- **Kill switch** không chặn lệnh.
- Tín hiệu **chưa hết hạn**.
- **Approval đúng version**.
- **Symbol mapping** tồn tại.
- **Spread** dưới giới hạn.
- **Price deviation** dưới giới hạn.
- **Volume** nằm trong min/max/step.
- **Margin** đủ.
- **SL/TP hợp lệ**.
- **Stop distance** đáp ứng yêu cầu broker.
- **Risk per trade** trong giới hạn.
- **Daily loss** chưa vượt ngưỡng.
- **Total open risk** chưa vượt ngưỡng.
- Không vượt **max positions** hoặc **max positions per symbol**.
- Không mở thêm lệnh nếu lệnh OPEN trước đó đang **UNKNOWN**.

Mọi kết quả kiểm tra được ghi vào bảng `risk_events`.

## 2. Position sizing

Volume phải được tính từ **monetary risk budget** và thông số broker:

- Tick size.
- Tick value.
- Contract size.
- Currency conversion.
- Stop distance.
- Volume step.

### Quy trình

1. Tính volume từ risk budget và stop distance.
2. **Làm tròn volume xuống** theo broker step.
3. **Tính lại risk** với volume đã làm tròn.
4. Nếu volume tối thiểu khiến risk vượt giới hạn → **reject lệnh**.

## 3. Kill switch

Hai chế độ:

| Chế độ | Ý nghĩa |
|---|---|
| `STOP NEW TRADES` | Chặn lệnh mới |
| `STOP ALL AUTOMATED MUTATIONS` | Chặn mọi thay đổi vị thế tự động |

### Quy tắc

- Kill switch **không tự động đóng** các vị thế hiện có.
- Kill switch **không được xóa** trạng thái command UNKNOWN.
- Kill switch được bật/tắt bởi người có quyền (xem open-decisions) và phải ghi audit log.
- **Không tự bật live trading** sau deploy/restart — mặc định trading disabled.

## 4. Liên kết tài liệu

- Kiểm tra trước khi execute: [03-nghiep-vu/manual-approval.md](../03-nghiep-vu/manual-approval.md)
- Vòng đời command: [02-du-lieu/state-machines.md](../02-du-lieu/state-machines.md)
- Kill switch thiết kế: [ADR-0010](../adr/ADR-0010-kill-switch.md)
- API kill switch: [06-api/operations-api.md](../06-api/operations-api.md)
