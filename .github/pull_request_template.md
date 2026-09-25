<!-- Tiêu đề PR: <type>(<scope>): <mô tả tiếng Anh> [<task-id>]   vd: feat(db): core schema and RLS [T1.1] -->

Agent: <!-- claude-1 | claude-2 | codex-1 | codex-2 | human  (mượn task: "claude-2 (mượn từ lane codex-1)") -->
Task: <!-- T1.1 — xem docs/ai/tasks.yaml và docs/PLAN.md §9 -->

## Tóm tắt

## Cách kiểm thử
<!-- lệnh đã chạy và kết quả; ảnh chụp vi/en + sáng/tối nếu là UI -->

## Handoff
<!-- API/contract mới, quyết định đã chọn, việc còn lại cho task phụ thuộc -->

## Yêu cầu cho lane khác
<!-- "claude-1: cần thêm variant `destructive` cho Button" — để trống nếu không có -->

## Việc cho người
<!-- bước người phải làm (secret, Coolify, Cloudflare, Google Cloud…) — để trống nếu không có -->

## Checklist
- [ ] Chỉ một task; chỉ sửa file trong vùng lane (+ `touches`) — không sửa tay lockfile/types/CHANGELOG
- [ ] Đã merge `origin/main` mới nhất; `lint`, `typecheck`, `test`, `i18n:check` pass
- [ ] Không chuỗi hiển thị hard-code; key mới có đủ `vi` và `en`
- [ ] Bảng mới có RLS + policy + pgTAP; thao tác quan trọng có audit log
- [ ] Env mới có trong `.env.example`; tài liệu người dùng vi/en cập nhật nếu hành vi đổi
