<!--
Tiêu đề PR = commit message sau squash-merge (CI kiểm tra bằng commitlint):
  <type>(<scope>): <mô tả tiếng Anh, chữ thường đầu câu> [<task-id>]     vd: feat(db): add core schema and RLS [T1.1]
  type : feat | fix | perf | refactor | security | docs | chore | ci | test | build | style | revert
  scope: web | collab | db | editor | table | search | auth | i18n | infra | ci | release | docs | deps (có thể bỏ trống)
  feat/fix xuất hiện trong trang "What's new" → viết câu người dùng đọc hiểu được.
Xem CONTRIBUTING.md và AGENTS.md.
-->

Agent: <!-- claude-1 | claude-2 | claude-3 | codex-1 | human  (mượn task: "claude-2 (mượn từ lane codex-1)") -->
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

## Checklist (Definition of Done)

<!-- Đánh dấu [x]; mục không áp dụng thì ghi "N/A" ở cuối dòng, đừng xoá. -->

**Phạm vi**

- [ ] Chỉ một task; chỉ sửa file trong vùng lane (+ `touches`) — không sửa tay `pnpm-lock.yaml`, `types.gen.ts`, `CHANGELOG.md`, version
- [ ] Đã merge `origin/main` mới nhất; mọi `deps` của task đã có trên `main`

**Changelog & version**

- [ ] Tiêu đề PR đúng Conventional Commits, scope hợp lệ, có `[Txx]`
- [ ] Thay đổi phá vỡ có `!` hoặc footer `BREAKING CHANGE:` (và đi theo expand → contract)

**i18n**

- [ ] Không chuỗi hiển thị hard-code; key mới có đủ `vi` và `en`, cùng tham số ICU
- [ ] `pnpm i18n:check` pass; key thuộc namespace của lane mình

**DB & bảo mật**

- [ ] Bảng mới bật RLS trong cùng migration + policy tường minh + test pgTAP (gồm khách mời)
- [ ] Thao tác quan trọng có audit log (trigger DB); `pnpm db:reset && pnpm db:test` pass; đã `pnpm db:types`
- [ ] Không secret trong code; env mới có trong `.env.example` + schema zod

**Chất lượng**

- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass; E2E liên quan được cập nhật
- [ ] Dependency mới có license trong allowlist (MIT, Apache-2.0, BSD, ISC, MPL-2.0); không TipTap Pro
- [ ] Tài liệu người dùng (vi + en) cập nhật nếu hành vi đổi; UI có ảnh chụp vi/en × sáng/tối
