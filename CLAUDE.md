# CLAUDE.md — Hướng dẫn riêng cho Claude Code

Quy tắc chung (bắt buộc, dùng chung với Codex) nằm ở `AGENTS.md` và được import dưới đây. Quy trình chạy song song: `docs/ai/WORKFLOW.md`. Danh sách task: `docs/ai/tasks.yaml`.

@AGENTS.md

## Riêng cho Claude Code

### Danh tính và lane
- Bạn là `claude-1` hoặc `claude-2` — người dùng nói ở đầu phiên. Chưa được nói → hỏi.
  - `claude-1` — **UI lõi & editor**: khung app, theme/design system, editor TipTap, table block (UI + kéo thả), upload, màn hình đăng nhập. **Kiêm collab (trước thuộc `codex-2`)**: `apps/collab` (Hocuspocus), logic editor không-UI (trích xuất text, parser paste, migration schema), hạ tầng test (Vitest/Playwright, E2E infra), spike T0.10.
  - `claude-2` — **UI tính năng**: Space, thành viên, quản trị, cài đặt, cây trang, tìm kiếm, lịch sử phiên bản, audit, What's new, email template, tài liệu người dùng. **Kiêm platform (trước thuộc `codex-2`)**: tooling monorepo + root config, CI/CD, release-please, Docker, Coolify, backup, production, i18n tooling, runbook/ADR.
- Task **không-UI** trong lane Claude (không có `ui: true`): phần "Chuẩn UI" bên dưới không áp dụng, nhưng vẫn theo mọi quy tắc chung (mã lỗi thay vì câu chữ, license, RLS nếu đụng DB qua `codex-1`, changelog…). `codex-1` được mượn các task này nếu có `stealable: true`.
- Claude là agent **duy nhất** được làm UI. Khi hết task UI khả dụng, Claude được **mượn** task không phải UI có `stealable: true` của lane Codex (luật ở `docs/ai/WORKFLOW.md` §6). Codex không bao giờ mượn task UI.
- Môi trường Claude Code on the web có thể ép tên nhánh (vd `claude/<tên-phiên>`). Khi đó vẫn giữ mã task trong **tiêu đề PR** (`[T3.2]`) và dòng `Agent:`/`Task:` trong thân PR — đó là dấu hiệu "đã nhận task" mà agent khác kiểm tra.

### Chuẩn UI (áp dụng cho mọi task UI)
- Dùng component shadcn/ui có sẵn trong `apps/web/src/components/ui`; chỉ `claude-1` sửa component có sẵn ở đó. Cần component mới → `pnpm dlx shadcn add <name>` (file mới, không xung đột); `claude-2` cần đổi component chung → ghi "Yêu cầu cho lane khác" gửi `claude-1`.
- Màu, spacing, radius qua design token (CSS variables của theme) — không màu hex rời rạc; hỗ trợ **sáng/tối**.
- Responsive: dùng được ở màn hình 360 px (đọc) và ≥ 1024 px (sửa); sidebar thu gọn trên mobile.
- A11y: điều khiển được bằng bàn phím, focus ring rõ, `aria-*` qua i18n, tương phản ≥ WCAG AA.
- **Không chuỗi cứng**: mọi chữ hiển thị qua `useTranslations`/`getTranslations`; thêm key vào **cả** `vi` và `en` trong namespace của lane mình (bảng namespace ở `docs/ai/WORKFLOW.md` §7.3).
- Dữ liệu lấy qua hàm trong `apps/web/src/server/**` (do Codex viết, là "contract"). Contract chưa có → dựng UI bằng mock trong `apps/web/src/server/<area>/mock.ts` theo kiểu dữ liệu đã thống nhất; **không tự viết truy vấn DB hay migration**.
- Mỗi task UI kèm: test component (Vitest + Testing Library) cho logic quan trọng, cập nhật E2E Playwright cho luồng chính, ảnh chụp màn hình (vi và en, sáng và tối) trong PR.
