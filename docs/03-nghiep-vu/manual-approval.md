# Manual Approval

> Ánh xạ từ plan §6 (Manual approval).

## 1. Nguyên tắc

Mọi tín hiệu **mở lệnh mới** cần được **duyệt thủ công**. Hệ thống không được tự động mở lệnh mới khi chưa có approval hợp lệ.

## 1.1 Switch toàn cục `open_mode`

- Hai mode: `MANUAL` (mặc định, fail-safe) và `AUTO`, đổi runtime qua `POST /v1/operations/open-mode` hoặc `/openmode` (ghi audit).
- `MANUAL`: mọi bài đều chờ duyệt tay, kể cả ví đang `AUTO`.
- `AUTO`: giữ logic hiện tại — ví nào `AUTO` thì signal sạch (`PENDING_APPROVAL`) tự mở dưới tên `system:auto`; ví `APPROVE` vẫn chờ.
- `NEEDS_REVIEW` không bao giờ tự mở ở mode nào.
- Thứ tự ưu tiên: global `MANUAL` > mode từng ví.

## 1.1 Điều kiện duyệt (chặn approve mù)

`approve()` từ chối version thiếu field mà chắc chắn mở lỗi: coin/hướng `UNKNOWN`, thiếu entry/SL/TP — kèm lý do rõ để operator Bổ sung trước. Coin có tên thật nhưng chưa trong list vẫn được duyệt (thêm coin vào list là mở được). Nút Approve hiển thị luôn lý do open-failed thay vì cụt lủn.

## 1.2 Vị thế chủ động `/pos` (operator tự ra lệnh)

Khi **chính operator** là người ra tín hiệu (không phải channel bên ngoài), không cần bước review:

```
/pos LONG BTC @100000 SL 98000 TP 105000 lev 5 https://t.me/x/1 src="Kaka trades" chat=<id> acc=<accountId>
```

- **Link bài gốc tự nhận diện** (`extractSourceUrl`): dán link vào bất kỳ đâu trong text — `https://t.me/…`, bare `t.me/…`, kể cả kiểu cũ `url=https://…` — hệ thống tự tách link ra khỏi text (parser không thấy link) và lưu làm `sourceUrl`. Link đầu tiên được lấy; toàn bộ link bị strip khỏi text. Không có cờ `url=` nữa. Link-only (không có signal text) → báo `empty signal text`.
- **Tạo signal** (`createOperatorSignal`): nguồn ảo `MANUAL/<key>`, version `eventType=MANUAL`, status `PENDING_APPROVAL` (hoặc `NEEDS_REVIEW` nếu có ambiguity). Thiếu field bắt buộc hoặc coin lạ → báo đúng lỗi, không tạo gì.
- **Tên channel trên caption** (theo thứ tự ưu tiên):
  1. `src="Tên channel"` — **fallback ẩn**: gõ tay khi auto-resolve không đọc được tên (link private mà bot chưa vào channel), có space được, thắng mọi nguồn khác.
  2. Tra DB theo link đã detect — nếu link đã ingest thì lấy `displayName` của channel đã track (không network).
  3. Gọi Bot API `getChat` theo link: `t.me/<username>/...` → `@username`, `t.me/c/<id>/...` → `-100<id>` — **link public luôn đọc được; link private `/c/` chỉ đọc được khi bot đã vào channel đó**. Timeout 5s, mọi lỗi → bước kế.
  4. Fallback: `Operator (manual)` (nguồn ảo `MANUAL/operator`).
  - Mỗi tên resolve được tạo 1 Source row riêng (`platform=MANUAL`, `externalSourceId= tên thường`, `sourceKind=MANUAL`) → hiện trong `/sources`, stats tách theo nguồn; guard `isOperatorSource` vẫn pass nên URL vẫn optional.
- **Tự duyệt + mở + đăng**: `flow.approveSignal` chạy liền sau khi tạo — không qua card review (operator ra lệnh = tự duyệt). Vẫn giữ toàn bộ guard: kill switch, symbol map + mid price, risk gate, approval ≤ 24h.
- **Chọn loại card (dialog 5 phút)**: position mở + publication tạo ngay nhưng render job **delayed 5 phút**; bot reply kèm 2 nút `① Card PnL` / `② Card Thống kê` (callback `style:<kind>:<positionId>`). Bấm nút → `chooseCardStyle` promote job chạy ngay với kind đã chọn + ghi `virtual_positions.card_kind`. Không bấm → job tự chạy render `pnl-strip` (mặc định); bấm sau đó → trả lời "Hết thời gian chọn". Kind lưu trên position nên **mọi card TP/SL sau đó kế thừa**; ingest/luồng AUTO không dialog (mặc định `pnl-strip`).
- **Caption**: hiện tên nguồn (resolve từ `src=`/link) + URL bài gốc đã detect (không bịa link — không có link thì chỉ hiện tên).
- **Không phụ thuộc `open_mode`**: lệnh chủ động đi thẳng `approveSignal`, như `/approve` tay.
- **Entry lấy mid price, không lấy `@entry` trong lệnh**: vị thế mở tại mid tại thời điểm approve (giống mọi luồng open). `SL`/`TP` trong `/pos` là mức tuyệt đối operator đặt — nếu đặt sai phía so với mid (ví dụ LONG `SL > mid`), position chạm SL ngay lần poll đầu. Operator tự chịu entry/SL hợp lý; hệ thống không sửa hay suy đoán.
- REST parity: `POST /v1/signals/manual` — cùng one-shot flow. `sourceName?` = `src=`, `sourceUrl?` = override (hiếm — text cũng tự detect link), `cardKind?` = chọn kind card thẳng (không dialog; không truyền → `pnl-strip`).

## 2. Nội dung bắt buộc của approval

Approval phải lưu:

- Người duyệt.
- Thời điểm.
- Quyết định (`APPROVED` / `REJECTED`).
- Lý do.
- Chính xác **signal version** được duyệt.

## 3. Kiểm tra trước khi thực thi

Trước khi thực thi tín hiệu đã duyệt, phải kiểm tra:

1. **Approval còn hiệu lực**.
2. **Signal version không thay đổi** (so với version được duyệt).
3. **Tín hiệu chưa hết hạn**.
4. **Kill switch** không chặn.
5. **Chạy lại risk checks** (không tái sử dụng kết quả cũ).

> Nếu **version thay đổi**, phải **duyệt lại**.

## 4. Quy tắc

- Approval gắn với đúng `signal_version_id`. Nếu version đổi, approval cũ không còn quyền cho phép execute.
- Thao tác approve/reject phải được **ghi audit log**.
- Endpoint đổi trạng thái phải có authentication, role authorization và **conflict checks**.

## 5. Liên kết tài liệu

- Dữ liệu approval: [02-du-lieu/database-design.md](../02-du-lieu/database-design.md)
- Signal versioning: [ADR-0004](../adr/ADR-0004-signal-versioning.md)
- API duyệt tín hiệu: [06-api/operations-api.md](../06-api/operations-api.md)
- Kiểm tra rủi ro: [04-risk-execution/risk-engine.md](../04-risk-execution/risk-engine.md)
