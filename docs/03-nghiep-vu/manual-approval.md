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
