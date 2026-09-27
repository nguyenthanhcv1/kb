# CLAUDE.md — Hướng dẫn riêng cho Claude Code

Quy tắc chung (bắt buộc, dùng chung với Codex) nằm ở `AGENTS.md` và được import dưới đây. Quy trình chạy song song: `docs/ai/WORKFLOW.md`. Danh sách task (một hàng đợi chung, theo thứ tự): `docs/ai/tasks.yaml`.

@AGENTS.md

## Riêng cho Claude Code

- Không có lane: lấy task bằng `pnpm ai:next` (task ready đầu tiên chưa ai nhận) và làm bất kỳ loại task nào — DB/migration, server, UI, editor, collab, CI, hạ tầng. Tên agent ghi trong PR: tên người dùng đưa ở đầu phiên, không có thì dùng `claude`.
- Môi trường Claude Code on the web có thể ép tên nhánh (vd `claude/<tên-phiên>`). Khi đó vẫn giữ mã task trong **tiêu đề PR** (`[T3.2]`) và dòng `Agent:`/`Task:` trong thân PR, và mở **draft PR** ngay sau commit đầu tiên — đó là dấu hiệu "đã nhận task" mà agent khác kiểm tra (nhánh bị ép tên không mang mã task).
- Task `ui: true`: theo "Chuẩn UI" trong `AGENTS.md`; chụp ảnh màn hình (vi/en × sáng/tối) bằng Playwright với Chromium có sẵn trong container.
