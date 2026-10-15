# ADR-0015: Ảnh báo cáo gen bằng code, không chụp MT5

- **Ngày:** 2026-10-12
- **Trạng thái:** Accepted

## Context

Báo cáo Telegram cần ảnh kèm bài đăng. Phương án cũ (chụp màn hình MT5 terminal) phụ thuộc cửa sổ desktop, Wine/Xvfb và spike chưa pass — rủi ro và khó kiểm chứng.

## Decision

Gen ảnh **card floating P&L bằng code** (`FloatingPnLCardRenderer`: HTML/CSS + Playwright render PNG 1280×180) từ **dữ liệu vị thế đã xác minh** từ broker. Bỏ hẳn chụp màn hình MT5. Luồng vào lệnh thật giữ nguyên; renderer chỉ đọc, không có quyền trade.

## Consequences

- Tích cực: không phụ thuộc desktop/terminal; render kiểm chứng được bằng test (kích thước, màu, format); idempotent theo render_id.
- Tích cực: P&L/current price lấy từ broker, thiếu thì từ chối render thay vì bịa.
- Tiêu cực: thêm Playwright + browser vào image (nặng); cần volume lưu artifacts + retention.
- Ràng buộc: local volume + retention 7 ngày; API async qua BullMQ; template version cố định theo snapshot.
- Cập nhật 2026-10-15: worker **chỉ render** PNG vào volume chung; **API** dựng caption, gửi Telegram và chạy market-watch. Không lưu metadata ảnh trong DB.

## Alternatives considered

- Chụp màn hình MT5 thật: phụ thuộc spike Wine, không ổn định — loại.
- Không kèm ảnh: giảm giá trị báo cáo cho người đọc mobile — loại.
