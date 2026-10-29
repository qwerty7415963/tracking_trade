# Test plan: TP theo R-multiple cho `/pos`

## Scope

Hỗ trợ TP nhập theo bội số R trong cùng một block TP:

```text
/pos LONG BTC @100000 SL 98000 TP 1R 130000 450000
```

Kết quả kỳ vọng:

```text
1R = |entry - SL| = 2000
TPs = [102000, 130000, 450000]
```

Thứ tự TP phải giữ nguyên thứ tự đã nhập.

## Contract

- `1R = |entry - stopLoss|`
- LONG: `TP(nR) = entry + n × 1R`
- SHORT: `TP(nR) = entry - n × 1R`
- Làm tròn theo số thập phân lớn nhất của `entry`, `SL`, `n`.
- `TP` thường: giá tuyệt đối.
- `TP` phần trăm: `%` theo khoảng cách từ entry.
- Block TP hỗ trợ nhiều token liên tiếp: `1R`, `2R`, `1.5R`, `130000`, `20%`.
- Syntax cũ không được regression:
  - `TP 105000`
  - `TP1 2350 TP2 2360`
  - `TP 20% 40% 60%`

## Domain unit tests

### Parser

1. `LONG ETH entry 3000 SL 2800 TP 1R 3100 2R`
   - `takeProfits = [3200, 3100, 3400]`
   - `takeProfitSpecs = [r1, price3100, r2]`
2. `LONG BTC entry 100000 SL 98000 TP 1R 130000 450000`
   - `takeProfits = [102000, 130000, 450000]`
3. `SHORT ETH entry 3000 SL 3200 TP 1R 2R`
   - `takeProfits = [2800, 2600]`
4. `LONG ETH entry market SL 2800 TP 1R 3100`
   - `takeProfits = []` vì R chưa resolve được
   - `takeProfitSpecs = [r1, price3100]`
5. `LONG ETH entry 3000 SL 2800 TP 3100 3200`
   - giữ nguyên absolute list
6. `LONG ETH entry 3000 SL 2800 TP 1R lev 5`
   - `lev 5` không bị đọc thành TP
7. `TP 20% 40%`
   - giữ ambiguity `tp_percent_converted`

### Risk distance

1. `SL == entry`
   - resolve trả `null`
2. LONG với `SL >= entry`
   - reject
3. SHORT với `SL <= entry`
   - reject
4. `0R`
   - reject

## API tests

### Signals

1. `/pos` với `TP 1R 130000 450000` và entry cụ thể
   - version được approve
   - payload có `takeProfitSpecs`
2. `/pos` với `TP 1R 130000 450000` và `entry market`
   - version vẫn approve được vì có specs
   - `takeProfits` numeric có thể rỗng cho đến lúc open

### Virtual trading

1. Market entry với specs `[r1, price3100]`
   - open dùng giá khớp thực tế
   - `takeProfits = [entry + 1R, 3100]`
2. Limit entry với specs `[r1, price3100]`
   - open dùng signal entry
3. Market entry với R spec nhưng SL sai phía
   - throw `INVALID_TAKE_PROFIT_SPEC`
4. Position create phải giữ đúng thứ tự TP

## Integration/manual E2E

1. `/pos LONG BTC @100000 SL 98000 TP 1R 130000 450000`
   - position open
   - card TP hiển thị `102000, 130000, 450000`
2. `/pos LONG BTC entry market SL 98000 TP 1R 130000 450000`
   - chờ giá đổi
   - TP tính theo giá khớp thực tế
3. TP hit theo thứ tự:
   - hit TP1 trước
   - card settle đúng ordinal
4. Reporting:
   - `TP` caption hiển thị đúng list và trạng thái hit

## Edge cases

| Case | Expected |
|---|---|
| `TP 1R 130000 450000` | mixed, giữ thứ tự |
| `TP 1R` | một TP theo R |
| `TP 1R 2R 3R` | toàn bộ theo R |
| `TP1 1R TP2 2R TP3 3R` | parse theo từng TP |
| `TP 1R - 130000, 450000` | parse được |
| `TP 1R lev 5` | không đọc `lev 5` thành TP |
| `TP 1R 20% 3100` | hỗ trợ trộn R, percent, price |
| `TP 1R` nhưng SL thiếu | `missing stop_loss` |
| `entry market` + R | resolve khi open |
| DCA entry ladder | dùng entry đầu tiên làm mốc R |
| SL sai phía | reject trước khi open |
| risk distance = 0 | reject |
| `0R` | reject |
| absolute TP cũ | không regression |
| percent TP cũ | không regression |

## Commands

```powershell
npm run typecheck
npm test -- --colors=false packages/domain
npm test -- --colors=false apps/api
npm run build
```

## Regression checklist

- `packages/domain/src/signal-parser.spec.ts` phải pass.
- `apps/api/src/trading/virtual-trading.service.spec.ts` phải pass.
- `apps/api/src/signals/signals.service.spec.ts` phải pass.
- Không thay đổi schema DB.
- Không làm vỡ card rendering, TP hit detection, settle flow.