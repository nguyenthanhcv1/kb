# AGENTS.md — Quy tắc chung cho mọi AI agent và người làm việc trên repo `kb`

> Đây là **nguồn quy tắc duy nhất** cho Claude Code, ChatGPT Codex và người. `CLAUDE.md` import file này.
> Kế hoạch gốc: [`docs/PLAN.md`](docs/PLAN.md) · Quy trình nhiều agent: [`docs/ai/WORKFLOW.md`](docs/ai/WORKFLOW.md) · Roadmap task MVP (không bắt buộc cho việc thường ngày): [`docs/ai/tasks.yaml`](docs/ai/tasks.yaml) · Phát hành: [`docs/runbooks/release.md`](docs/runbooks/release.md).
> Muốn đổi quy tắc → sửa file này trong một PR riêng, do người (không phải agent) duyệt.

## 0. Cách nhận việc — ĐỌC TRƯỚC KHI LÀM BẤT CỨ ĐIỀU GÌ

KB **đã chạy thật trên production** (`kb.thanhgo.com`; merge vào `main` = deploy — ADR 0007). Từ giờ việc chủ yếu đến dưới dạng **yêu cầu trực tiếp** của người (sửa lỗi, chỉnh giao diện, tính năng mới…), không còn là danh sách task định sẵn. Có hai loại việc, **cùng một chuẩn chất lượng** (§ "Nguyên tắc BẮT BUỘC", "Definition of Done"):

| | Việc theo yêu cầu (**mặc định**) | Task trong `docs/ai/tasks.yaml` (roadmap cũ) |
|---|---|---|
| Khi nào | Người nói trực tiếp việc cần làm (kể cả kèm ảnh, mô tả lỗi) | Người bảo "lấy task kế tiếp" / nêu mã `Txx` |
| Cần thêm task vào `tasks.yaml`? | **Không.** Không bao giờ phải dừng lại để hỏi "đã có task chưa" | Đã có sẵn trong file |
| Dòng `Task:` trong PR | `Task: none` | `Task: Txx` |
| Tiêu đề PR | `fix(web): …` — **không** có `[Txx]` | `feat(db): … [Txx]` |
| Nhánh | tên môi trường ép, hoặc `<agent>/<slug>` | `<agent>/<id>-<slug>` |

Quy tắc chung:

1. **Một yêu cầu = một nhánh = một PR nhỏ.** Yêu cầu lớn, nhiều phần độc lập → tách nhiều PR. Chỉ sửa những gì yêu cầu cần; việc phát hiện thêm ghi vào Handoff, không tự làm.
2. **Luôn bắt đầu từ `main` mới nhất** và merge `main` vào nhánh trước khi mở PR. Không force-push nhánh của agent khác, không sửa PR của agent khác.
3. **Tránh trùng việc**: trước khi làm, xem PR đang mở (`pnpm ai:status` hoặc GitHub). Có PR cùng khu vực/file → làm tiếp trên PR đó nếu là của mình, hoặc báo người; mở **draft PR** sớm để agent khác thấy.
4. **Kiểm tra theo rủi ro**: production không có staging → CI xanh + tự chạy lại luồng bị ảnh hưởng. Thay đổi DB: migration forward-only, expand → contract, test pgTAP. Thay đổi giao diện: ảnh chụp vi/en × sáng/tối.
5. **PR có `feat`/`fix` → xuất hiện ở trang "Có gì mới"**: tiêu đề là câu tiếng Anh người dùng đọc hiểu (§2), **và PR kèm ghi chú tiếng Việt** `changelog/vi/unreleased/<tên-ngắn>.md` ([`changelog/vi/README.md`](changelog/vi/README.md); CI `agent-scope` đỏ nếu thiếu). Việc nội bộ dùng `chore`/`refactor`/`docs`/`ci`/`test` để không lọt vào changelog.
6. **Phát hành**: người nói "phát hành"/"cập nhật Có gì mới" → làm theo [`docs/runbooks/release.md`](docs/runbooks/release.md) (Release PR tự gộp ghi chú tiếng Việt từ `changelog/vi/unreleased/`; agent chỉ bổ sung khi thiếu; người merge). Không sửa tay `CHANGELOG.md`, version, `.release-please-manifest.json`.
7. File "nóng" (lockfile, migration, file dịch, types sinh tự động…) có luật riêng: `docs/ai/WORKFLOW.md` §5. Không bao giờ sửa tay `CHANGELOG.md`, `packages/db/src/types.gen.ts`, `pnpm-lock.yaml`.
8. Việc `ui: true` / có giao diện phải theo **Chuẩn UI** (dưới đây).
9. Kết thúc: ghi **Handoff** trong PR (đã làm gì, hành vi/API mới, việc còn lại).

### Khi làm task trong `tasks.yaml` (chỉ khi người yêu cầu)

`tasks.yaml` là roadmap MVP đã đóng băng + chỗ ghi các hạng mục lớn muốn theo dõi dài hạn — **không bắt buộc cho việc thường ngày**. Khi người bảo làm task: `pnpm ai:next` (task ready đầu tiên chưa ai nhận; không làm task `manual: true`), nhận task bằng nhánh + draft PR có `[Txx]`, chỉ bắt đầu khi mọi `deps` đã merge (CI `agent-scope` kiểm tra), contract-first cho task `b` (`docs/ai/WORKFLOW.md` §6). Thêm/sửa/xoá dòng trong `tasks.yaml` chỉ do người (hoặc PR riêng `Agent: human`) — agent không thêm task để "hợp thức hoá" việc mình làm.

Tên agent (`claude`, `codex`, `claude-2`…) người dùng cho biết ở đầu phiên hoặc agent tự đặt theo công cụ — chỉ để truy vết trong PR/nhánh.

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
- `CHANGELOG.md` do **release-please** sinh (tiếng Anh, theo Keep a Changelog). Ghi chú tiếng Việt viết tay **trong chính PR `feat`/`fix`** ở `changelog/vi/unreleased/<tên-ngắn>.md`; trên Release PR, CI gộp chúng thành `changelog/vi/<version>.md` và chèn vào `CHANGELOG.md` để file luôn song ngữ, **fail nếu không có ghi chú nào**. Bản tổng quan (vd `1.0.0`) thì viết tay cả `changelog/vi/<version>.md`.
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

## Chuẩn UI (mọi thay đổi có giao diện)
- Dùng component shadcn/ui có sẵn trong `apps/web/src/components/ui`. Cần component mới → `pnpm dlx shadcn add <name>`. Sửa component có sẵn thì giữ tương thích ngược với các màn hình đang dùng.
- Màu, spacing, radius qua design token (CSS variables của theme) — không màu hex rời rạc; hỗ trợ **sáng/tối**.
- Responsive: dùng được ở màn hình 360 px (đọc) và ≥ 1024 px (sửa); sidebar thu gọn trên mobile.
- A11y: điều khiển được bằng bàn phím, focus ring rõ, `aria-*` qua i18n, tương phản ≥ WCAG AA.
- **Không chuỗi cứng**: mọi chữ hiển thị qua `useTranslations`/`getTranslations`; thêm key vào **cả** `vi` và `en`.
- Dữ liệu lấy qua hàm trong `apps/web/src/server/**` (contract). Contract chưa có → dựng UI bằng mock `apps/web/src/server/<area>/mock.ts` theo kiểu dữ liệu đã thống nhất (`docs/ai/WORKFLOW.md` §6).
- Mỗi thay đổi UI kèm: test component (Vitest + Testing Library) cho logic quan trọng, cập nhật E2E Playwright cho luồng chính, ảnh chụp màn hình (vi và en, sáng và tối) trong PR.

## Contract server cho UI
- Khi viết contract (`apps/web/src/server/<area>/index.ts`): export hàm có kiểu rõ ràng + schema zod cho input/output + mã lỗi từ `packages/shared/src/errors.ts`; ghi ví dụ dữ liệu trong JSDoc để task giao diện dựng mock.

## Definition of Done cho mỗi PR
- [ ] PR chỉ chứa **một việc** (một yêu cầu hoặc một task), chỉ sửa những gì việc cần (file "nóng" theo đúng luật §5 của WORKFLOW)
- [ ] Tiêu đề PR đúng Conventional Commits (có `[Txx]` chỉ khi làm task trong `tasks.yaml`); thân PR có `Agent:`, `Task:` (`Txx` hoặc `none`), Handoff
- [ ] PR `feat`/`fix` có ghi chú tiếng Việt `changelog/vi/unreleased/<tên-ngắn>.md`
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
