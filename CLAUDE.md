# CLAUDE.md — Hướng dẫn riêng cho Claude Code

Quy tắc chung (bắt buộc, dùng chung với Codex) nằm ở `AGENTS.md` và được import dưới đây. Quy trình nhiều agent: `docs/ai/WORKFLOW.md`. Phát hành & trang "Có gì mới": `docs/runbooks/release.md`. Roadmap task MVP (không bắt buộc cho việc thường ngày): `docs/ai/tasks.yaml`.

@AGENTS.md

## Riêng cho Claude Code

- **Việc theo yêu cầu là mặc định**: người đưa yêu cầu (lỗi, chỉnh sửa, tính năng mới, kèm ảnh) → làm luôn, **không** kiểm tra/hỏi "đã có task trong `tasks.yaml` chưa" và **không** tự thêm task. PR ghi `Task: none`, tiêu đề không có `[Txx]`. Chỉ dùng `pnpm ai:next` khi người bảo "lấy task kế tiếp" hoặc nêu mã `Txx`. Tên agent ghi trong PR: tên người dùng đưa ở đầu phiên, không có thì dùng `claude`.
- Môi trường Claude Code on the web có thể ép tên nhánh (vd `claude/<tên-phiên>`) — cứ dùng tên đó. Mở **draft PR** sau commit đầu tiên khi việc kéo dài; chỉ mở PR khi người yêu cầu (hoặc quy trình task đòi hỏi).
- Làm tiếp một yêu cầu sau khi PR của nó đã merge → coi là việc mới: nhánh mới từ `main` mới nhất, PR mới.
- Việc có giao diện: theo "Chuẩn UI" trong `AGENTS.md`; chụp ảnh màn hình (vi/en × sáng/tối) bằng Playwright với Chromium có sẵn trong container.
- Người nói "phát hành" / "cập nhật Có gì mới": theo `docs/runbooks/release.md` (mục "Agent làm gì khi người yêu cầu phát hành").
