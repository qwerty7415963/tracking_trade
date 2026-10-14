# Risk Engine (paper)

> Ánh xạ từ plan §7 (Risk engine), thích ứng cho paper trading.

## 1. Các kiểm tra bắt buộc

Trước khi mở vị thế ảo (`evaluateVirtualRisk`), hệ thống kiểm tra:

- **Kill switch** không chặn (`STOP_ALL_MUTATIONS` chặn mọi mutation; `STOP_NEW_TRADES` chặn mở mới).
- **Approval hợp lệ** (đúng version, decision APPROVED).
- **Coin đã map** (resolve được từ universe Hyperliquid live).
- **Size** ≥ min size và đúng step (`sizeIncrement`).
- **Leverage** hợp lệ (1..50).
- **Margin đủ**: `notional / leverage ≤ equity`.
- **Max positions** chưa vượt ngưỡng.
- **Daily loss** (lỗ đã chốt hôm nay) chưa vượt ngưỡng.
- **Risk per trade** (size × stop distance) trong giới hạn.

Mọi kết quả kiểm tra được ghi vào bảng `risk_events`.

## 2. Position sizing (perp)

Size (đơn vị coin) tính từ **risk budget (USDC)** và stop distance:

```
size = riskBudget / |entry − stopLoss|
```

- Entry = giá mid lúc mở (không đoán).
- **Làm tròn size xuống** theo `sizeIncrement` từ `meta`.
- Size tối thiểu từ ngưỡng notional $10 (`minSize`).
- Nếu size < min → **reject lệnh** (`MIN_SIZE_EXCEEDS_BUDGET`).

## 3. Cross-margin account (MVP)

- `equity = balance + Σ unrealized PnL`.
- `marginRatio = Σ(notional × MMR) / equity` (MMR mặc định 1%).
- `liquidation ≈ entry × (1 ∓ (1/leverage − MMR))` — công thức xấp xỉ để hiển thị, không phải nguồn xác minh.
- MVP **không** tính fee/funding (ghi rõ trong hiển thị và ADR).

## 4. Multi-TP split

- TP1 đóng **50%** size; các TP còn lại chia đều phần còn lại; TP duy nhất đóng 100%.
- SL đóng **toàn bộ** phần còn lại.
- Mỗi lần đóng ghi realized PnL vào ledger (`virtual_transactions`).

## 5. Kill switch

Hai chế độ:

| Chế độ | Ý nghĩa |
|---|---|
| `STOP NEW TRADES` | Chặn mở mới |
| `STOP ALL AUTOMATED MUTATIONS` | Chặn mọi mutation tự động (kể cả TP/SL worker bỏ qua chu kỳ) |

### Quy tắc

- Kill switch **không tự động đóng** các vị thế hiện có.
- Kill switch được bật/tắt bởi người có quyền (xem open-decisions) và phải ghi audit log.

## 6. Liên kết tài liệu

- Kiểm tra trước khi mở: [03-nghiep-vu/manual-approval.md](../03-nghiep-vu/manual-approval.md)
- Vòng đời vị thế: [02-du-lieu/state-machines.md](../02-du-lieu/state-machines.md)
- Kill switch thiết kế: [ADR-0010](../adr/ADR-0010-kill-switch.md)
- API kill switch: [06-api/operations-api.md](../06-api/operations-api.md)
