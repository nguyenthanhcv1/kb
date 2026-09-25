# AGENTS.md — Quy tắc chung cho mọi AI agent và người làm việc trên repo `kb`

> Đây là **nguồn quy tắc duy nhất** cho Claude Code, ChatGPT Codex và người. `CLAUDE.md` import file này.
> Kế hoạch: [`docs/PLAN.md`](docs/PLAN.md) · Quy trình nhiều agent chạy song song: [`docs/ai/WORKFLOW.md`](docs/ai/WORKFLOW.md) · Danh sách task và lane: [`docs/ai/tasks.yaml`](docs/ai/tasks.yaml).
> Muốn đổi quy tắc → sửa file này trong một PR riêng, do người (không phải agent) duyệt.

## 0. Làm việc song song nhiều agent — ĐỌC TRƯỚC KHI LÀM BẤT CỨ ĐIỀU GÌ

Có 4 agent chạy song song: `claude-1`, `claude-2` (Claude Code) và `codex-1`, `codex-2` (ChatGPT Codex). Người dùng cho biết bạn là agent nào ở tin nhắn đầu phiên ("Bạn là `codex-1`"). **Nếu chưa được cho biết, hãy hỏi — không tự chọn.**

1. **Chỉ làm task thuộc lane của mình** trong `docs/ai/tasks.yaml` (trừ luật "mượn task" ở `docs/ai/WORKFLOW.md` §6).
2. **Chỉ sửa file trong vùng sở hữu của lane** (`lanes.<agent>.owns` trong `tasks.yaml`). Cần thay đổi ở vùng khác → ghi vào mục "Yêu cầu cho lane khác" trong PR, không tự sửa.
3. **Mọi thứ thuộc UI chỉ Claude Code làm** (`claude-1`, `claude-2`). **Codex không bao giờ** tạo/sửa: trang, layout, component React, hook UI, CSS/Tailwind/theme, node view và menu của editor, email template, chuỗi dịch hiển thị trên giao diện (trừ `errors.json`, `audit.json`), tài liệu người dùng. Định nghĩa đầy đủ: `docs/ai/WORKFLOW.md` §3.
4. **Một task = một nhánh = một PR nhỏ**. Nhánh: `<agent>/<task-id>-<slug>` (vd `codex-1/T1.1-core-schema`). Tiêu đề PR: Conventional Commit + mã task, vd `feat(db): core schema and RLS [T1.1]`. Thân PR theo `.github/pull_request_template.md` (có dòng `Agent:` và `Task:`).
5. **Luôn bắt đầu từ `main` mới nhất** và merge `main` vào nhánh trước khi mở PR. Không force-push nhánh của agent khác, không sửa PR của agent khác.
6. **Task chỉ được bắt đầu khi mọi `deps` đã merge vào `main`** (kiểm tra: `git log origin/main --oneline | grep '\[T1.1\]'`).
7. File "nóng" (lockfile, migration, file dịch, types sinh tự động…) có luật riêng: `docs/ai/WORKFLOW.md` §7. Không bao giờ sửa tay `CHANGELOG.md`, `packages/db/src/types.gen.ts`, `pnpm-lock.yaml`.
8. Kết thúc task: ghi **Handoff** trong PR (đã làm gì, API/contract mới, việc còn lại cho task sau).

## Dự án

Knowledge base nội bộ self-host: editor dạng block (TipTap), table block đầy đủ, tìm kiếm tiếng Việt (gõ không dấu vẫn ra), phân quyền theo Space, lịch sử phiên bản. V2: real-time, comment. V3: hỏi đáp AI (RAG).

**Stack:** pnpm + Turborepo monorepo · `apps/web` Next.js App Router (`output: "standalone"`) + TypeScript + Tailwind + shadcn/ui · `apps/collab` Hocuspocus (Yjs) · Supabase self-host (Postgres + `unaccent`, `pg_trgm`, `pgvector`; Auth Google OAuth; Storage; Realtime) · deploy bằng Docker trên **Coolify**, phía trước là Cloudflare.

## Nguyên tắc BẮT BUỘC

### 1. Song ngữ Việt – Anh (vi mặc định, en)
- **Không hard-code chuỗi hiển thị** trong code (JSX, toast, lỗi, email, placeholder, `aria-label`, `title`, `alt`…). Mọi chuỗi đi qua `next-intl` (`useTranslations` / `getTranslations`) với key trong `packages/i18n/messages/{vi,en}/<namespace>.json`.
- Thêm key → thêm **đồng thời** vào `vi` và `en`, cùng tham số ICU. Chạy `pnpm i18n:check` trước khi commit. CI fail nếu `vi`/`en` lệch nhau hoặc còn chuỗi literal trong JSX.
- Quy ước key: `<namespace>.<khu vực>.<tên>` camelCase, ví dụ `editor.table.mergeCells`, `errors.PAGE_NOT_FOUND`. Không ghép chuỗi bằng `+`; dùng ICU (`{count, plural, …}`).
- Server/API/collab trả **mã lỗi** (`PAGE_NOT_FOUND`), client dịch qua `errors.<CODE>`. Không trả câu chữ từ server.
- Ngày giờ, số: dùng formatter của `next-intl` theo locale người dùng; múi giờ mặc định `Asia/Ho_Chi_Minh`. DB lưu `timestamptz` (UTC).
- Ngôn ngữ người dùng lưu ở `profiles.locale`. Email, mẫu trang, tài liệu hướng dẫn (`docs/user-guide/{vi,en}`) đều phải có đủ hai ngôn ngữ.
- Giá trị enum lưu trong DB là **mã** (`viewer`, `page.create`), dịch khi hiển thị.

### 2. Changelog cho mọi thay đổi
- Commit theo **Conventional Commits** (`feat(editor): …`, `fix(search): …`). PR được squash-merge; **tiêu đề PR** chính là commit message và phải hợp lệ (CI kiểm tra).
- Scope hợp lệ: `web`, `collab`, `db`, `editor`, `table`, `search`, `auth`, `i18n`, `infra`, `ci`, `release`, `docs`, `deps`.
- `CHANGELOG.md` do **release-please** sinh (tiếng Anh, theo Keep a Changelog). Ghi chú tiếng Việt viết tay ở `changelog/vi/<version>.md` trong Release PR; CI chèn vào `CHANGELOG.md` để file luôn song ngữ và **fail nếu thiếu**.
- Tiêu đề commit `feat`/`fix` phải là câu tiếng Anh người dùng đọc hiểu được (nó xuất hiện trong trang "What's new").
- Thao tác quan trọng phải ghi **audit log** trong DB (`audit_logs`): tạo/sửa/xoá/di chuyển trang, đổi quyền/thành viên Space, khôi phục phiên bản. Ghi bằng trigger ở DB, không phụ thuộc code ứng dụng.

### 3. Số hiệu phiên bản
- **Semantic Versioning**, bắt đầu `0.1.0`. Không sửa version bằng tay — release-please bump version, tạo tag `vX.Y.Z` và GitHub Release khi merge Release PR.
- Các milestone MVP là `0.x`; **MVP ra mắt chính thức là `1.0.0`** (`Release-As: 1.0.0`). Sau 1.0, giai đoạn V2/V3 vẫn là `1.x` — chỉ tăng MAJOR khi có thay đổi phá vỡ thật.
- Version hiển thị trong app (footer + Settings › Giới thiệu) và trong `/api/health`, `/health` của collab.

### 4. Row Level Security cho MỌI bảng
- Mọi bảng trong schema `public` (và bảng mới ở bất kỳ schema nào PostgREST truy cập được) phải `ENABLE ROW LEVEL SECURITY` **trong cùng migration tạo bảng**, kèm policy tường minh. CI có test kiểm tra không còn bảng nào tắt RLS.
- Quyền được quyết định qua các hàm helper trong schema `app` (`app.space_role()`, `app.can_view_space()`, `app.can_edit_space()`, `app.is_space_admin()`) — không lặp logic quyền trong policy hay trong code.
- Dùng `(select auth.uid())` trong policy. Hàm helper `SECURITY DEFINER`, `STABLE`, `set search_path = ''`.
- Mỗi policy mới phải có test pgTAP trong `supabase/tests/` (ma trận vai trò × thao tác, gồm khách mời).
- `service_role` chỉ dùng ở server cho việc thật sự cần (mời khách, job hệ thống). Nội dung trang chỉ được ghi qua `kb-collab` (role DB `kb_collab`, quyền tối thiểu).

### 5. Chỉ dùng thư viện mã nguồn mở
- **Không dùng TipTap Pro / TipTap Cloud / `@tiptap-pro`** hay bất kỳ extension trả phí nào. Tính năng thiếu (kéo thả hàng/cột, màu nền ô, paste Excel, xuất CSV, lịch sử phiên bản, comment…) thì tự viết trong `packages/editor`.
- Kiểm tra license trước khi thêm dependency; CI (`licenses`) fail nếu license ngoài allowlist (MIT, Apache-2.0, BSD, ISC, MPL-2.0).

## Quyết định kiến trúc không được phá vỡ
- **Nguồn sự thật của nội dung trang là Yjs** (`page_documents.ydoc`). `content_json`, `content_text`, `page_search` là dữ liệu dẫn xuất.
- **Một đường ghi nội dung duy nhất:** mọi thay đổi nội dung (sửa, khôi phục, mẫu, import) đi qua `kb-collab`. `kb-web` không ghi thẳng `page_documents.ydoc`.
- **Schema editor dùng chung:** extension TipTap nằm ở `packages/editor`, được dùng bởi cả client, collab server và bộ trích xuất search. Đổi schema → tăng `EDITOR_SCHEMA_VERSION`.
- Mỗi block có **ID ổn định** (UniqueID) — dùng cho deep link, comment (V2), trích dẫn RAG (V3).
- Ai được đăng nhập do super admin khai báo trong DB (bảng `access_allowlist`, theo email hoặc domain) — không hard-code email/domain trong code (trừ env `BOOTSTRAP_SUPER_ADMIN_EMAILS` cho lần đầu). Space mới mặc định `restricted`.
- Migration DB: Supabase CLI, **forward-only**, thay đổi phá vỡ dùng expand → contract qua ít nhất 1 release.

## Riêng cho Codex (`codex-1`, `codex-2`)
- `codex-1` — **DB & server**: `supabase/**` (migration, RLS, pgTAP, seed), `apps/web/src/server/**`, Route Handler `app/api/**`, auth middleware, SQL tìm kiếm.
- `codex-2` — **Platform & collab**: tooling monorepo, CI/CD, Docker, Coolify, release, backup, `apps/collab/**`, logic không-UI của editor (trích xuất text, parser paste, xuất CSV), hạ tầng test.
- **Không làm UI** (xem §0.3). Nếu task của bạn cần thay đổi UI → hoàn thành phần server/contract, ghi rõ trong Handoff và mục "Yêu cầu cho lane khác" để Claude làm.
- Khi viết contract cho UI (`apps/web/src/server/<area>/index.ts`): export hàm có kiểu rõ ràng + schema zod cho input/output + mã lỗi từ `packages/shared/src/errors.ts`; ghi ví dụ dữ liệu trong JSDoc để Claude dựng mock.

## Definition of Done cho mỗi PR
- [ ] PR chỉ chứa **một task**, chỉ sửa file trong vùng lane (hoặc file "nóng" theo đúng luật §7 của WORKFLOW)
- [ ] Tiêu đề PR đúng Conventional Commits và có `[Txx]`; thân PR có `Agent:`, `Task:`, Handoff
- [ ] Không có chuỗi hiển thị hard-code; `pnpm i18n:check` pass (vi = en)
- [ ] Bảng mới có RLS + policy + test pgTAP; thao tác quan trọng có audit log
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass; E2E liên quan được cập nhật
- [ ] Migration mới chạy được với `supabase db reset`; đã sinh lại types (`pnpm db:types`)
- [ ] Biến môi trường mới có trong `.env.example` và schema env (zod)
- [ ] Tài liệu người dùng (vi + en) được cập nhật nếu hành vi thay đổi

## Lệnh thường dùng (sẽ có sau M0)
```bash
pnpm dev            # chạy web + collab (Supabase local chạy bằng `supabase start`)
pnpm lint | pnpm typecheck | pnpm test | pnpm e2e
pnpm i18n:check     # so khớp key vi/en, tham số ICU
pnpm db:reset       # supabase db reset (migrations + seed)
pnpm db:test        # supabase test db (pgTAP, gồm test RLS)
pnpm db:types       # sinh packages/db/src/types.gen.ts
```
