# Kế hoạch triển khai `kb` — Knowledge base nội bộ

> Trạng thái: **Bản nháp v3** (đã cập nhật theo trả lời vòng 3) · Ngày: 2026-09-25 · Phạm vi: MVP chi tiết, V2/V3 tổng quan
> Nguyên tắc bắt buộc (song ngữ, changelog, SemVer, RLS): xem [`CLAUDE.md`](../CLAUDE.md).

## 0. Tóm tắt các quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Quy mô thiết kế | < 200 người dùng, < 20.000 trang → 1 server Coolify, tìm kiếm bằng Postgres FTS + `pg_trgm`, 1 instance `kb-collab` |
| Lưu nội dung | **Yjs binary là nguồn sự thật** (`bytea`) + dẫn xuất TipTap JSON / plain text phục vụ render, search, version |
| `kb-collab` | **Có ngay từ MVP.** Editor luôn kết nối Hocuspocus; V2 chỉ bật UI presence/cursor |
| Đăng nhập | Google SSO. **Super admin khai báo danh sách cho phép** trong trang Quản trị: theo **domain** (cả công ty) *hoặc* theo **từng email** (team nhỏ) — lưu DB, đổi được lúc chạy. Cộng thêm mời khách vào từng Space. Super admin đầu tiên: `nguyenthanh.cv@gmail.com` |
| Phân quyền MVP | Theo Space (Xem / Sửa / Quản trị); **Space mới mặc định `restricted` (chỉ thành viên)**; schema và hàm helper sẵn sàng cho quyền theo trang ở V2 |
| Khách mời | Tối đa Xem/Sửa trong Space được mời; không bao giờ là Quản trị; không thấy Space "nội bộ"; không tạo Space |
| Release | **release-please**. Các milestone phát hành `0.x`; **MVP ra mắt production là `1.0.0`** |
| Changelog | `CHANGELOG.md` do release-please sinh (en) + ghi chú tiếng Việt viết tay `changelog/vi/<version>.md`, CI chèn vào `CHANGELOG.md` |
| Môi trường | local · staging · production · preview theo PR (chỉ `kb-web`, dùng chung Supabase staging) |
| Mạng | Cloudflare proxy (SSL Full strict) |
| Domain gốc | `thanhgo.com` (xem §7.3 — **chỉ dùng subdomain 1 cấp**) |
| Server | **Hostinger VPS, 2 máy tách biệt**: production `KVM 2` (2 vCPU / 8 GB / 100 GB NVMe) và staging + preview + Coolify `KVM 2`; nâng `KVM 4` khi cần. Không bắt buộc lưu dữ liệu trong nước → đặt ở data center gần VN nhất — §7.0 |
| Lưu trữ backup (S3) | **Cloudflare R2** (S3-compatible, không phí egress, cùng tài khoản Cloudflare). Supabase Storage *không* dùng làm đích backup vì nằm cùng server — §7.8 |
| Email (SMTP) | Supabase không cung cấp SMTP. **Gmail SMTP bằng App Password của một tài khoản Workspace** (không cần admin công ty); nâng lên **Resend** với domain `thanhgo.com` khi cần — §7.14 |
| TipTap | **Chỉ dùng phần mã nguồn mở (MIT)**; tính năng thiếu thì tự viết. CI chặn package trả phí — §2.1 |
| AI (V3) | **Được phép** gửi nội dung tới API bên ngoài: Claude API (Anthropic) cho sinh câu trả lời, Voyage AI cho embedding; có cờ tắt AI theo Space — §10.2 |
| Nhân lực | 1 dev fulltime (+AI) → ước lượng ~64 ngày công (1 dev) — hoặc ~6–7 tuần lịch với 4 agent song song (docs/ai/WORKFLOW.md) cho MVP (~3 tháng lịch) |

---

## 1. Kiến trúc tổng thể

### 1.1 Sơ đồ thành phần

```
                          ┌──────────────────────── Cloudflare (DNS, proxy, WAF, SSL edge) ────────────────────────┐
 Trình duyệt ─── HTTPS ──▶│ kb.thanhgo.com        kb-collab.thanhgo.com (WSS)        kb-api.thanhgo.com           │
                          └──────────┬─────────────────────────┬──────────────────────────────┬───────────────────────┘
                                     │ Full (strict), Origin CA cert *.thanhgo.com             │
                          ┌──────────▼─────────────────────────▼──────────────────────────────▼───────────────────────┐
                          │                         Coolify host — Traefik (reverse proxy)                           │
                          │                                                                                          │
                          │  ┌────────────────┐   HTTP nội bộ    ┌──────────────────┐                                │
                          │  │ kb-web         │ ───────────────▶ │ kb-collab        │                                │
                          │  │ Next.js SSR +  │ (internal API:   │ Hocuspocus + Yjs │                                │
                          │  │ Route Handlers │  restore/mẫu/    │ auth · persist · │                                │
                          │  │ Server Actions │  import)         │ snapshot         │                                │
                          │  └───────┬────────┘                  └────────┬─────────┘                                │
                          │          │ supabase-js (JWT người dùng)       │ postgres (role kb_collab)               │
                          │          ▼                                    ▼                                          │
                          │  ┌───────────────────────── Supabase self-host ─────────────────────────────────────┐    │
                          │  │ Kong ─▶ GoTrue (Auth, Google OAuth) · PostgREST · Storage API · Realtime        │    │
                          │  │                    │                                                            │    │
                          │  │                    ▼                                                            │    │
                          │  │        Postgres 15+ (unaccent, pg_trgm, pgvector, pgTAP) — RLS mọi bảng         │    │
                          │  └────────────────────────────────────────────────────────────────────────────────┘    │
                          │  ┌────────────────┐  ┌────────────────────┐  ┌─────────────────┐                        │
                          │  │ kb-backup      │  │ Redis (V2+, tuỳ    │  │ Uptime Kuma /   │                        │
                          │  │ pg_dump → S3   │  │ chọn khi scale)    │  │ monitoring      │                        │
                          │  └────────────────┘  └────────────────────┘  └─────────────────┘                        │
                          └──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Luồng dữ liệu chính

**Đăng nhập**
1. Người dùng bấm "Đăng nhập với Google" → `kb-web` gọi `supabase.auth.signInWithOAuth({ provider: 'google' })`.
2. GoTrue (tại `kb-api.thanhgo.com/auth/v1`) redirect sang Google → callback về GoTrue.
3. **Hook `before_user_created`** (hàm Postgres) kiểm tra theo thứ tự: (a) email nằm trong `bootstrap_admin_emails` → cho tạo, là người nội bộ + super admin; (b) email khớp **danh sách cho phép** `access_allowlist` (một dòng `domain` khớp phần sau `@`, hoặc một dòng `email` khớp chính xác) → người nội bộ; (c) có lời mời còn hạn trong `invitations` → khách; (d) còn lại → từ chối với mã lỗi `AUTH_NOT_ALLOWED`. Middleware kiểm tra lại ở **mỗi phiên**: nếu admin gỡ domain/email khỏi danh sách, người đó bị đăng xuất (trừ khi vẫn còn membership dạng khách).
4. Trigger `on auth.users insert` tạo `profiles` (locale mặc định `vi`, `is_guest = true` chỉ khi vào bằng lời mời mà không khớp allowlist), gắn membership từ lời mời. Nếu sau này admin thêm email/domain của khách vào allowlist → `is_guest` tự chuyển `false`.
5. `kb-web` nhận session qua `@supabase/ssr` (cookie httpOnly trên `kb.thanhgo.com`); middleware refresh token.

**Mở và sửa trang**
1. Server Component đọc `pages` + `page_documents.content_json` bằng JWT người dùng (RLS lọc) → render read-only ngay (first paint nhanh, không chờ WS).
2. Client khởi tạo `HocuspocusProvider` tới `wss://kb-collab.thanhgo.com`, document name = `page:<uuid>`, `token` = access token Supabase.
3. `kb-collab` `onAuthenticate`: verify JWT (JWT secret của Supabase) → gọi `app.authorize_document(page_id, user_id)` → `viewer` ⇒ `connection.readOnly = true`; `editor/admin` ⇒ ghi; không quyền ⇒ từ chối (`FORBIDDEN`). Kiểm tra `EDITOR_SCHEMA_VERSION` của client khớp server, lệch ⇒ từ chối với `CLIENT_OUTDATED` (client hiện thông báo tải lại).
4. `onLoadDocument` (extension Database `fetch`): đọc `page_documents.ydoc`.
5. Người dùng gõ → Yjs update → server áp vào Y.Doc trong bộ nhớ → phát cho các client khác (V2) → `store` được debounce (2 s, tối đa 10 s).
6. `store`: trong 1 transaction — khoá dòng, merge state, ghi `ydoc`, dẫn xuất `content_json` / `content_text` / `headings_text` / `table_text` bằng `packages/editor`, cập nhật `pages.last_edited_at/by`; trigger cập nhật `page_search`.
7. Snapshot phiên bản tự động theo chính sách (§3.6) ghi vào `page_versions`.

**Tìm kiếm**: client → Route Handler `/api/search` → RPC `search_pages()` (`SECURITY INVOKER`, RLS lọc theo quyền) → kết quả + snippet có highlight.

**Khôi phục phiên bản / áp dụng mẫu / import**: `kb-web` kiểm tra quyền → gọi internal API của `kb-collab` (`POST /internal/documents/:id/replace`, mạng nội bộ + secret) → collab dùng `openDirectConnection()` thay nội dung trong transaction Yjs → mọi client đang mở thấy ngay, persist theo đường thông thường. **Không có đường ghi thứ hai.**

---

## 2. Cấu trúc thư mục (monorepo pnpm + Turborepo)

```
kb/
├── apps/
│   ├── web/                          # Next.js App Router (standalone)
│   │   ├── src/app/
│   │   │   ├── (auth)/login/         # trang đăng nhập, lỗi auth
│   │   │   ├── (app)/                # layout có sidebar, cần đăng nhập
│   │   │   │   ├── page.tsx          # trang chủ: Space gần đây
│   │   │   │   ├── s/[spaceSlug]/    # Space
│   │   │   │   │   ├── page.tsx
│   │   │   │   │   ├── settings/     # thành viên, quyền, audit log
│   │   │   │   │   ├── trash/
│   │   │   │   │   └── p/[pageRef]/  # pageRef = <slug>-<shortId>
│   │   │   │   │       ├── page.tsx
│   │   │   │   │       └── history/  # lịch sử phiên bản
│   │   │   │   ├── search/
│   │   │   │   ├── settings/         # hồ sơ, ngôn ngữ, giới thiệu (version)
│   │   │   │   ├── whats-new/        # "Có gì mới / What's new"
│   │   │   │   └── admin/            # super admin: domain, người dùng
│   │   │   ├── invite/[token]/
│   │   │   ├── auth/callback/route.ts
│   │   │   └── api/
│   │   │       ├── health/route.ts   # liveness + version
│   │   │       ├── health/ready/route.ts
│   │   │       ├── search/route.ts
│   │   │       └── pages/[id]/export.csv/route.ts (tuỳ chọn, export phía server)
│   │   ├── src/components/           # ui/ (shadcn), editor/, tree/, search/, layout/
│   │   ├── src/lib/                  # supabase clients, collab client, env, errors
│   │   ├── src/i18n/request.ts       # next-intl getRequestConfig (locale + timeZone)
│   │   ├── src/generated/changelog.json   # sinh lúc build, không commit
│   │   ├── e2e/                      # Playwright
│   │   ├── Dockerfile
│   │   └── next.config.ts
│   └── collab/                       # Hocuspocus server
│       ├── src/
│       │   ├── index.ts              # bootstrap, graceful shutdown
│       │   ├── auth.ts               # verify JWT + authorize_document
│       │   ├── persistence.ts        # fetch/store + dẫn xuất
│       │   ├── snapshots.ts          # chính sách page_versions
│       │   ├── internal-api.ts       # replace content (restore/template/import)
│       │   ├── health.ts
│       │   └── env.ts
│       ├── test/
│       └── Dockerfile
├── packages/
│   ├── editor/                       # DÙNG CHUNG client + server
│   │   ├── src/extensions/           # danh sách extension TipTap, table, callout, uniqueId…
│   │   ├── src/schema-version.ts     # EDITOR_SCHEMA_VERSION
│   │   ├── src/extract/              # ydoc/json → text, headings, table text, blocks
│   │   ├── src/table/                # paste Excel/Sheets, export CSV, drag hàng/cột
│   │   └── test/fixtures/clipboard/  # HTML clipboard mẫu từ Excel, Google Sheets, LibreOffice
│   ├── i18n/
│   │   ├── messages/vi/*.json        # common, auth, editor, table, tree, search, errors, settings, email, whatsNew…
│   │   ├── messages/en/*.json
│   │   ├── src/index.ts              # load messages, types
│   │   ├── src/format.ts             # normalizeVi(), helpers
│   │   └── scripts/check.ts          # pnpm i18n:check
│   ├── db/
│   │   ├── src/types.gen.ts          # supabase gen types (commit, CI kiểm tra drift)
│   │   └── src/client.ts             # factory: browser/server/service clients
│   ├── shared/                       # error codes, zod schemas, env schema, constants
│   ├── emails/                       # React Email templates (dùng messages i18n)
│   └── config/                       # eslint, tsconfig, tailwind preset, prettier
├── supabase/
│   ├── config.toml                   # Supabase CLI (local), Google OAuth local, hook
│   ├── migrations/                   # YYYYMMDDHHMMSS_<tên>.sql (forward-only)
│   ├── seed.sql                      # dữ liệu dev
│   └── tests/                        # pgTAP: rls_*.test.sql, search_*.test.sql
├── infra/
│   ├── docker-compose.yml            # web + collab (+ redis) trỏ vào Supabase local
│   ├── coolify/                      # ghi chú cấu hình từng app, env mẫu (không secret)
│   ├── backup/                       # Dockerfile + script pg_dump → S3, restore
│   └── migrate/Dockerfile            # image kb-migrate (supabase CLI + migrations)
├── changelog/vi/                     # <version>.md — ghi chú phát hành tiếng Việt
├── docs/
│   ├── PLAN.md
│   ├── ai/                           # WORKFLOW.md (quy trình nhiều agent), tasks.yaml (lane + task)
│   ├── adr/                          # Architecture Decision Records
│   ├── runbooks/                     # backup-restore, rotate-secrets, incident…
│   └── user-guide/{vi,en}/
├── scripts/                          # build-changelog.ts, inject-vi-changelog.ts, seed-perf.ts
├── .github/
│   ├── workflows/                    # ci, e2e, release-please, release-vi-notes, build-images, deploy, preview-dns
│   ├── pull_request_template.md
│   └── CODEOWNERS
├── CHANGELOG.md                      # release-please (en) + khối tiếng Việt được chèn
├── AGENTS.md                         # quy tắc chung cho mọi agent (Codex đọc trực tiếp)
├── CLAUDE.md                         # import AGENTS.md + hướng dẫn riêng Claude (UI)
├── release-please-config.json
├── .release-please-manifest.json
├── .env.example
├── turbo.json · pnpm-workspace.yaml · package.json
```

**Lý do tách `packages/editor`:** client editor, `kb-collab` (dẫn xuất JSON/text), bộ trích xuất search và (V3) chunker RAG phải dùng **cùng một schema ProseMirror**. Lệch schema giữa client và server là nguyên nhân phổ biến nhất gây mất nội dung với Yjs.

### 2.1 Chính sách chỉ dùng mã nguồn mở cho editor

Không dùng TipTap Pro / TipTap Cloud / registry `@tiptap-pro`. Từ TipTap v3 nhiều extension trước đây trả phí đã chuyển sang MIT (UniqueID, Drag Handle, File Handler, Details, Table of Contents…) — **mỗi package phải được kiểm tra license lúc cài**; nếu không phải MIT/Apache/BSD thì tự viết.

| Nhu cầu | Nguồn | Ghi chú |
|---|---|---|
| Lõi editor, StarterKit, Link, Image, Placeholder, TaskList, CodeBlockLowlight | `@tiptap/*` (MIT) | |
| Bảng: thêm/xoá hàng-cột, header, resize cột, gộp/tách ô | `@tiptap/extension-table` (MIT, dựa trên `prosemirror-tables`) | |
| Màu nền ô | **Tự viết** — thêm attribute `backgroundColor` cho `TableCell`/`TableHeader` | ~0,5 ngày, trong T4.2 |
| Kéo thả hàng/cột | **Tự viết** — plugin ProseMirror (TipTap không có) | T4.3 |
| Paste Excel/Sheets, xuất CSV | **Tự viết** | T4.4, T4.5 |
| Block ID ổn định | `@tiptap/extension-unique-id` nếu MIT, ngược lại **tự viết** (~0,5 ngày: plugin `appendTransaction` gán `data-id` uuid) | T3.1 |
| Drag handle block | `@tiptap/extension-drag-handle` nếu MIT, ngược lại tự viết | T3.2 |
| Slash menu, bubble menu | `@tiptap/suggestion` + `BubbleMenu` (MIT) + UI shadcn tự làm | T3.2 |
| Collaboration, cursor (V2) | `@tiptap/extension-collaboration`, `…-collaboration-caret`, Hocuspocus (MIT) | |
| Lịch sử phiên bản | **Tự viết** (`page_versions`) — thay cho "Collaboration History" trả phí | M6 |
| Comment (V2), AI (V3), import DOCX/Notion (V3) | **Tự viết** — thay cho các extension trả phí tương ứng; import `.docx` dùng `mammoth` (BSD) | |

CI: job `licenses` (trong `ci.yml`) chạy `license-checker`/`pnpm licenses list` với allowlist (MIT, Apache-2.0, BSD-2/3, ISC, MPL-2.0 cho thư viện dùng qua import) và fail nếu có package từ `@tiptap-pro` hoặc license ngoài danh sách.

---

## 3. Schema DB chi tiết

### 3.1 Quy ước chung
- Khoá chính `uuid default gen_random_uuid()`; thời gian `timestamptz default now()`; cột `updated_at` cập nhật bằng trigger `app.touch_updated_at()`.
- Schema `public`: bảng được PostgREST expose. Schema `app`: hàm helper/trigger (không expose). Schema `private`: dữ liệu không cho client đọc (vd `ydoc` nếu cần tách — xem 3.5).
- Enum:
  - `space_role`: `viewer`, `editor`, `admin`
  - `space_visibility`: `restricted` (**mặc định** — chỉ thành viên), `internal` (mọi người nội bộ = viewer ngầm định; admin Space chủ động bật)
  - `version_reason`: `auto`, `manual`, `pre_restore`, `restore`, `template`, `import`
- Soft delete bằng `deleted_at` (thùng rác 30 ngày, job dọn định kỳ).

### 3.2 Bảng

#### `profiles`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK, FK → `auth.users(id)` on delete cascade | |
| `email` | citext unique not null | |
| `full_name` | text | từ Google |
| `avatar_url` | text | |
| `locale` | text not null default `'vi'` check in (`vi`,`en`) | lưu lựa chọn ngôn ngữ |
| `time_zone` | text not null default `'Asia/Ho_Chi_Minh'` | |
| `is_guest` | boolean not null default false | vào bằng lời mời, không khớp allowlist |
| `is_super_admin` | boolean not null default false | chỉ đổi được bởi super admin/service |
| `deactivated_at` | timestamptz | khoá tài khoản |
| `created_at`, `updated_at` | timestamptz | |

#### `app_settings` (1 dòng)
`id smallint PK check (id = 1)`, `bootstrap_admin_emails citext[] not null default '{}'`, `default_space_visibility space_visibility not null default 'restricted'`, `ai_enabled boolean not null default false` (V3, bật toàn hệ thống), `updated_at`, `updated_by`.

#### `access_allowlist` — ai được đăng nhập với tư cách người nội bộ
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `kind` | text not null check in (`domain`, `email`) | |
| `value` | citext not null | `ahamove.com` hoặc `an.nguyen@ahamove.com`; check regex theo `kind` |
| `note` | text | vd "Team Vận hành" |
| `created_by`, `created_at` | | |
Unique (`kind`, `value`). RLS: chỉ `app.is_super_admin()` được select/insert/delete; hook đọc qua hàm `SECURITY DEFINER`.

- **Hai cách dùng, cùng một cơ chế:**
  - *Team nhỏ*: thêm từng email (`kind = 'email'`). Không ảnh hưởng người khác trong công ty, không cần quyền admin Google Workspace.
  - *Cả công ty*: thêm một dòng `domain`. UI cảnh báo khi thêm domain email công cộng (`gmail.com`, `yahoo.com`, `outlook.com`…) — email Gmail cá nhân chỉ nên thêm theo từng email.
- **Trang `/admin/access`** (chỉ super admin): thêm/xoá email hoặc domain, nhập hàng loạt (dán danh sách email), xem số người dùng bị ảnh hưởng trước khi xoá; mọi thay đổi ghi audit `access.add` / `access.remove`.
- **Bootstrap**: env `BOOTSTRAP_SUPER_ADMIN_EMAILS=nguyenthanh.cv@gmail.com` được seed script ghi vào `bootstrap_admin_emails` ở lần deploy đầu; người này đăng nhập lần đầu được đặt `is_super_admin = true`, `is_guest = false` (kể cả khi là Gmail cá nhân). Khuyến nghị: sau khi chạy ổn, cấp super admin cho thêm ít nhất 1 tài khoản công ty để không phụ thuộc một tài khoản.

#### `spaces`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `slug` | citext unique not null, check `^[a-z0-9-]{2,50}$` | URL |
| `name` | text not null | nội dung người dùng, không dịch |
| `description` | text | |
| `icon` | text | emoji hoặc key icon |
| `visibility` | space_visibility not null default `'restricted'` | lấy từ `app_settings.default_space_visibility` khi tạo |
| `ai_enabled` | boolean not null default true | **dành cho V3**: admin Space có thể loại Space nhạy cảm (nhân sự, tài chính) khỏi AI/embedding |
| `created_by` | uuid FK profiles | |
| `archived_at` | timestamptz | |
| `created_at`, `updated_at` | | |

#### `space_members`
PK (`space_id`, `user_id`) · `role space_role not null` · `added_by uuid` · `created_at`, `updated_at`.
Index: `(user_id)`. Trigger: chặn `role = 'admin'` khi `profiles.is_guest`; chặn xoá/hạ quyền admin cuối cùng của Space.

#### `invitations`
`id`, `email citext not null`, `space_id` FK, `role space_role check (role <> 'admin')`, `token_hash text unique not null` (sha256, token gốc chỉ nằm trong email), `invited_by`, `expires_at` (mặc định +14 ngày), `accepted_at`, `accepted_by`, `revoked_at`, `created_at`.
Index: `(lower(email)) where accepted_at is null and revoked_at is null`.

#### `pages`
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | uuid PK | |
| `space_id` | uuid not null FK spaces | |
| `parent_id` | uuid FK pages on delete restrict | null = gốc của Space |
| `position` | text not null collate "C" | fractional index (thư viện `fractional-indexing`) — kéo thả chỉ sửa 1 dòng |
| `title` | text not null default `''` | |
| `slug` | text not null | sinh từ title (bỏ dấu), chỉ để URL đẹp; tra cứu bằng short id |
| `short_id` | text unique not null | 8 ký tự base62, dùng trong URL |
| `icon`, `cover_url` | text | |
| `owner_id` | uuid FK profiles | người chịu trách nhiệm nội dung (V3 cảnh báo tài liệu cũ) |
| `inherit_permissions` | boolean not null default true | **dành cho V2** quyền theo trang; MVP luôn true |
| `is_template` | boolean not null default false | **dành cho V2** mẫu trang |
| `template_locale` | text check in (`vi`,`en`) | V2 |
| `created_by`, `last_edited_by` | uuid | |
| `created_at`, `updated_at`, `last_edited_at` | timestamptz | `last_edited_at` = sửa nội dung |
| `deleted_at`, `deleted_by` | | thùng rác |

Index: `(space_id, parent_id, position) where deleted_at is null`, `(parent_id)`, `(space_id, last_edited_at desc)`, `(space_id) where deleted_at is not null`.
Trigger: `parent_id` phải cùng `space_id`; chặn vòng lặp (recursive check); xoá mềm cha → xoá mềm con (cùng `deleted_at` để khôi phục cả nhánh).

#### `page_documents` (1–1 với `pages`)
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `page_id` | uuid PK FK pages on delete cascade | |
| `ydoc` | bytea not null | `Y.encodeStateAsUpdate(doc)` — **nguồn sự thật** |
| `schema_version` | int not null | `EDITOR_SCHEMA_VERSION` lúc ghi |
| `content_json` | jsonb not null | TipTap JSON dẫn xuất |
| `content_text` | text not null | plain text (NFC) |
| `headings_text` | text not null | |
| `table_text` | text not null | xem §4.5 |
| `word_count` | int | |
| `updated_at` | timestamptz | |

Client **không bao giờ** được `select ydoc` (cột được revoke từ `authenticated` bằng column privilege; client đọc `content_json`).

#### `page_versions`
`id uuid PK`, `page_id` FK on delete cascade, `version_no int not null` (unique cùng `page_id`, cấp bằng `max+1` trong transaction có lock), `title text`, `ydoc_update bytea not null`, `content_json jsonb not null`, `content_text text`, `schema_version int`, `reason version_reason`, `label text null` (tên do người dùng đặt cho bản manual), `restored_from_version_id uuid null`, `created_by uuid`, `created_at`.
Index: `(page_id, created_at desc)`. Chính sách giữ: tất cả bản `manual`/`restore`/`pre_restore`; bản `auto` giữ toàn bộ 30 ngày gần nhất, sau đó thưa dần 1 bản/ngày (job hằng đêm).

#### `page_search` (dẫn xuất, 1–1 với `pages`)
`page_id PK`, `space_id`, `is_deleted boolean`, `title text`, `title_norm text` (bỏ dấu, lowercase), `tsv tsvector` (cấu hình `vi_unaccent`, có trọng số), `tsv_exact tsvector` (cấu hình `simple`, giữ dấu), `last_edited_at`.
Index: GIN(`tsv`), GIN(`tsv_exact`), GIN(`title_norm gin_trgm_ops`), `(space_id)`.
Được cập nhật bởi trigger trên `pages` (title, deleted_at, space_id) và `page_documents` (text).

#### `attachments`
`id`, `space_id`, `page_id` FK, `storage_path text unique` (`<space_id>/<page_id>/<uuid>-<tên>`), `file_name`, `mime_type`, `size_bytes`, `width`, `height`, `uploaded_by`, `created_at`, `deleted_at`.
Storage bucket `attachments` (private), giới hạn 25 MB/tệp, whitelist MIME.

#### `audit_logs` (insert-only)
| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | bigint identity PK | |
| `occurred_at` | timestamptz default now() | |
| `actor_id` | uuid | `coalesce(auth.uid(), current_setting('app.actor_id', true)::uuid)` |
| `action` | text not null | mã: `page.create`, `page.update_title`, `page.update_content`, `page.move`, `page.delete`, `page.restore_from_trash`, `page.purge`, `version.restore`, `space.create`, `space.update`, `space.archive`, `member.add`, `member.role_change`, `member.remove`, `invitation.create`, `invitation.revoke`, `access.add`, `access.remove`, `settings.update` |
| `entity_type` | text | `page`, `space`, `member`, `invitation`… |
| `entity_id` | uuid | |
| `space_id` | uuid | để lọc theo Space |
| `metadata` | jsonb | before/after rút gọn (vd `{from_role, to_role}`, `{from_parent, to_parent}`) |
| `request_id` | text | trace |

Index: `(space_id, occurred_at desc)`, `(entity_id, occurred_at desc)`, `(actor_id, occurred_at desc)`.
Ghi bằng **trigger `SECURITY DEFINER`** (`app.audit_*`) trên `pages`, `spaces`, `space_members`, `invitations`, `app_settings`, `access_allowlist`, `page_versions` (reason = `restore`). Riêng `page.update_content` do `kb-collab` ghi, gộp tối đa 1 bản ghi / người / trang / 10 phút. Không có policy UPDATE/DELETE → bất biến với mọi role trừ superuser. Giữ 2 năm (đề xuất, xem §12.2).

### 3.3 Quan hệ
```
auth.users 1─1 profiles 1─* space_members *─1 spaces 1─* pages ─┐ (parent_id tự tham chiếu)
                                                                 ├─1 page_documents
                                                                 ├─1 page_search
                                                                 ├─* page_versions
                                                                 └─* attachments
spaces 1─* invitations ; audit_logs (tham chiếu mềm, không FK — giữ lịch sử khi thực thể bị xoá)
```

### 3.4 Hàm helper phân quyền (schema `app`)

```sql
-- Vai trò hiệu lực của người dùng hiện tại trong 1 Space. Điểm DUY NHẤT chứa logic quyền.
create function app.space_role(p_space_id uuid) returns public.space_role
language sql stable security definer set search_path = '' as $$
  select case
    when p.is_super_admin then 'admin'::public.space_role
    when m.role is not null then m.role
    when s.visibility = 'internal' and not p.is_guest then 'viewer'::public.space_role
    else null
  end
  from public.profiles p
  join public.spaces s on s.id = p_space_id and s.archived_at is null
  left join public.space_members m on m.space_id = s.id and m.user_id = p.id
  where p.id = (select auth.uid()) and p.deactivated_at is null
$$;

create function app.can_view_space(uuid) returns boolean ... -- space_role(...) is not null
create function app.can_edit_space(uuid) returns boolean ... -- space_role(...) in ('editor','admin')
create function app.is_space_admin(uuid) returns boolean ...  -- space_role(...) = 'admin'
create function app.is_super_admin() returns boolean ...
create function app.is_internal_user() returns boolean ...    -- not is_guest

-- Cho kb-collab (chỉ grant cho role kb_collab): vai trò trên trang của 1 user cụ thể.
create function app.authorize_document(p_page_id uuid, p_user_id uuid) returns public.space_role ...
```

**Chuẩn bị cho V2 (quyền theo trang):** mọi policy trên `pages`, `page_documents`, `page_versions`, `page_search`, `attachments` gọi `app.page_role(page_id)` — ở MVP hàm này chỉ trả `app.space_role(space_id)`. V2 thêm bảng `page_permissions` và sửa **một hàm** (tìm tổ tiên gần nhất có `inherit_permissions = false`), không phải viết lại policy.

### 3.5 RLS policy (tất cả bảng đều `enable row level security`)

| Bảng | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | bản thân; hoặc người dùng nội bộ xem hồ sơ nội bộ khác (để chọn thành viên); khách chỉ thấy người cùng Space | trigger (không client) | bản thân: chỉ `full_name`, `locale`, `time_zone`, `avatar_url` (column grant); super admin: `is_super_admin`, `deactivated_at` | không |
| `app_settings` | người dùng đã đăng nhập (trừ cột `bootstrap_admin_emails`: chỉ super admin) | không | `app.is_super_admin()` | không |
| `access_allowlist` | `app.is_super_admin()` | `app.is_super_admin()` | `app.is_super_admin()` | `app.is_super_admin()` (không cho xoá dòng khớp email của chính mình) |
| `spaces` | `app.can_view_space(id)` | `app.is_internal_user()` và `created_by = auth.uid()` (trigger thêm người tạo làm admin) | `app.is_space_admin(id)` | không (dùng archive) |
| `space_members` | `app.can_view_space(space_id)` | `app.is_space_admin(space_id)` | `app.is_space_admin(space_id)` | `app.is_space_admin(space_id)` hoặc `user_id = auth.uid()` (tự rời) |
| `invitations` | `app.is_space_admin(space_id)` | `app.is_space_admin(space_id)` | admin (revoke) | không |
| `pages` | `deleted_at is null and app.page_role(id) is not null`; trang trong thùng rác: `app.can_edit_space(space_id)` | `app.can_edit_space(space_id)` và `created_by = auth.uid()` | USING `app.can_edit_space(space_id)` WITH CHECK `app.can_edit_space(space_id)` (chuyển Space cần quyền sửa ở cả hai) | `app.is_space_admin(space_id)` (xoá vĩnh viễn) |
| `page_documents` | `app.page_role(page_id) is not null` (cột `ydoc` bị revoke) | chỉ role `kb_collab` | chỉ role `kb_collab` | cascade |
| `page_versions` | `app.page_role(page_id) is not null` | chỉ `kb_collab` | không | không |
| `page_search` | `not is_deleted and app.can_view_space(space_id)` | trigger | trigger | trigger |
| `attachments` | `app.page_role(page_id) is not null` | `app.can_edit_space(space_id)` | editor | editor (soft) |
| `storage.objects` (bucket `attachments`) | `app.can_view_space((storage.foldername(name))[1]::uuid)` | `app.can_edit_space(...)` | không | editor |
| `audit_logs` | `app.is_space_admin(space_id)` hoặc `app.is_super_admin()` | trigger / `kb_collab` | **không ai** | **không ai** |

- Role `anon`: không có policy nào → không đọc được gì (V3 public page sẽ có policy riêng qua bảng `public_shares`).
- Role Postgres `kb_collab` (LOGIN, `NOBYPASSRLS`): grant `select, update(ydoc, schema_version, content_*, …)` trên `page_documents`, `insert` trên `page_versions`, `audit_logs`, `select` trên `pages`, `update(last_edited_at, last_edited_by)` trên `pages`, execute `app.authorize_document`. Policy `to kb_collab using (true)` trên đúng những bảng này. Như vậy RLS vẫn bật, collab chỉ chạm được đúng phần cần.
- Trang mới: server action tạo `pages` + gọi collab internal API khởi tạo `page_documents` rỗng (hoặc trigger insert dòng rỗng với `ydoc` = update rỗng — chọn trigger để không phụ thuộc collab lúc tạo).
- Test CI (`supabase/tests/000_rls_enabled.test.sql`): truy vấn `pg_tables` — mọi bảng trong `public` phải `rowsecurity = true`.

### 3.6 Chính sách snapshot phiên bản (thực thi trong `kb-collab`)
- `auto`: khi có thay đổi và (a) ≥ 10 phút kể từ bản `auto` gần nhất, hoặc (b) client cuối cùng rời trang.
- `manual`: nút "Lưu phiên bản", có thể đặt tên (cột `label`).
- `pre_restore` + `restore`: khi khôi phục (§6 task T6.3).

### 3.7 Migration strategy
- Công cụ: **Supabase CLI** (`supabase migration new`, `supabase db reset`, `supabase db push`). Mỗi migration là SQL thuần, **forward-only**, không sửa migration đã merge.
- Mỗi migration tạo bảng phải có: RLS + policy + grant + trigger audit (nếu áp dụng) + test pgTAP trong cùng PR.
- Thay đổi phá vỡ: **expand → migrate data → contract**, contract ở release sau (app cũ vẫn chạy được trong lúc rolling deploy/preview dùng chung staging DB).
- `supabase db diff` chỉ để tham khảo/review, không dùng sinh migration tự động.
- `pnpm db:types` sinh `packages/db/src/types.gen.ts`; CI chạy lại và fail nếu có diff.
- Áp dụng: CI local (DB tạm) → staging (khi merge `main`) → production (khi release, sau khi backup trước migration). Chạy bằng image `kb-migrate` trong mạng Docker nội bộ (§7.5).
- Dữ liệu nội dung (Yjs) thay đổi schema editor → migration ở tầng ứng dụng: `kb-collab` nâng cấp tài liệu khi load nếu `schema_version` cũ (hàm migrate trong `packages/editor/src/migrations`), + script batch chạy nền.

---

## 4. Chiến lược tìm kiếm tiếng Việt

### 4.1 Mục tiêu
- Gõ "quy trinh nghi phep" ra "Quy trình nghỉ phép"; gõ có dấu thì bản đúng dấu được xếp cao hơn.
- Tìm được nội dung trong bảng, heading, tiêu đề; kết quả tôn trọng quyền (RLS).
- p95 < 300 ms với 20.000 trang.

### 4.2 Chuẩn hoá
1. **Unicode NFC**: tiếng Việt có thể đến ở dạng tổ hợp (NFD — macOS, một số bộ gõ, copy từ PDF). Chuẩn hoá `normalize(text, NFC)` ở cả lúc index (Postgres ≥ 13) và lúc query; client editor cũng chuẩn hoá khi paste.
2. **Bỏ dấu**: `unaccent` không phải hàm `IMMUTABLE` → tạo wrapper:
   ```sql
   create function app.vn_unaccent(text) returns text
   language sql immutable parallel safe strict set search_path = '' as $$
     select lower(extensions.unaccent('extensions.unaccent'::regdictionary,
                   translate(normalize($1, NFC), 'đĐ', 'dD')))
   $$;
   ```
   (`translate` cho `đ/Đ` để chắc chắn, dù `unaccent.rules` đã có.)
3. **Text search configuration**:
   ```sql
   create text search configuration public.vi_unaccent (copy = simple);
   alter text search configuration public.vi_unaccent
     alter mapping for hword, hword_part, word with extensions.unaccent, simple;
   ```
   Dùng `simple` (không stemming, không stopword) vì tiếng Việt đơn âm tiết, stemming tiếng Anh gây sai. Tiếng Anh trong nội dung vẫn tìm được theo từ nguyên dạng (chấp nhận ở MVP).
4. **Phía JS** (`packages/i18n/src/format.ts` → `normalizeVi()`): `NFD` → xoá `̀-ͯ` → `đ→d` → lowercase; dùng cho quick switcher phía client, sinh slug, highlight.

### 4.3 Index
```sql
tsv = setweight(to_tsvector('vi_unaccent', title), 'A')
   || setweight(to_tsvector('vi_unaccent', headings_text), 'B')
   || setweight(to_tsvector('vi_unaccent', content_text), 'C')
   || setweight(to_tsvector('vi_unaccent', table_text), 'C');
tsv_exact = (tương tự với cấu hình 'simple', giữ dấu, chỉ title + headings + content)
title_norm = app.vn_unaccent(title)   -- GIN gin_trgm_ops cho quick switcher & lỗi gõ
```
Giới hạn kích thước: `to_tsvector` tối đa 1 MB/giá trị → cắt `content_text` ở 500 KB cho index (trang cực dài hiếm).

### 4.4 Truy vấn và xếp hạng (RPC `search_pages(q text, space_ids uuid[] default null, limit int default 20, offset int default 0)`, `SECURITY INVOKER`)
1. Parse: `websearch_to_tsquery('vi_unaccent', q)` (hỗ trợ `"cụm từ"`, `-loại trừ`, `or`); từ cuối thêm prefix `:*` để tìm khi đang gõ.
2. Lọc: `tsv @@ q_unaccent OR title_norm % app.vn_unaccent(q)` (trigram cho lỗi gõ ở tiêu đề).
3. Điểm:
   ```
   score = ts_rank_cd(tsv, q_unaccent, 32)                    -- nền, không dấu, có trọng số A/B/C
         + 0.5 * ts_rank_cd(tsv_exact, q_exact, 32)           -- thưởng đúng dấu (chỉ khi người dùng gõ có dấu)
         + 0.4 * (tsv @@ phraseto_tsquery('vi_unaccent', q))  -- thưởng đúng cụm (từ ghép "cơ sở dữ liệu")
         + 0.3 * similarity(title_norm, app.vn_unaccent(q))   -- khớp tiêu đề
         + 0.05 * exp(-age_days / 180)                        -- ưu tiên nhẹ trang mới sửa
   ```
   Hệ số tinh chỉnh ở T5.4 bằng bộ golden query.
4. Snippet: `ts_headline('vi_unaccent', content_text, q_unaccent, 'MaxFragments=2, MinWords=5, MaxWords=20, StartSel=<mark>, StopSel=</mark>')` — vì cấu hình có dictionary `unaccent`, `ts_headline` highlight đúng từ **gốc có dấu** dù người dùng gõ không dấu. Chỉ tính headline cho top N sau khi xếp hạng (CTE) để tiết kiệm CPU. Client render `<mark>` qua sanitizer, không `dangerouslySetInnerHTML` thô.
5. Kết quả trả thêm `match_in` (`title`/`heading`/`table`/`body`) để UI hiển thị "Khớp trong bảng".
6. Quick switcher (Ctrl/⌘+K): chỉ tiêu đề — `title_norm % q` + `ilike q%` prefix, sắp theo similarity + recency; < 50 ms.

### 4.5 Index nội dung bảng
- Bộ trích xuất (`packages/editor/src/extract/table.ts`) duyệt node `table`: mỗi hàng → các ô nối bằng ` | `, hàng nối bằng xuống dòng; ô gộp chỉ lấy giá trị ô gốc; hàng/cột tiêu đề đặt đầu với tiền tố để ngữ cảnh (`Tiêu đề: …`) không cần — giữ thuần văn bản.
- Lưu vào `table_text` (tách khỏi `content_text`) để: (a) biết `match_in = table`, (b) chỉnh trọng số riêng, (c) V3 chunk bảng theo hàng kèm header cho RAG.
- Ô chứa số/mã (vd `NV-00123`): tokenizer `simple` giữ nguyên `nv-00123` dạng hword → tìm được cả `NV-00123` và `00123`.

### 4.6 Phương án dự phòng
Nếu chất lượng chưa đạt (từ ghép, đồng nghĩa): thêm từ điển đồng nghĩa (`thesaurus`) cho từ viết tắt nội bộ (vd "NP" ↔ "nghỉ phép"), hoặc V3 dùng hybrid search với embedding (pgvector) — không cần engine search riêng ở quy mô này.

---

## 5. Chiến lược i18n

### 5.1 Thư viện và cấu hình
- `next-intl`, **không dùng locale trong URL** (app nội bộ, URL chia sẻ được giữa người dùng khác ngôn ngữ). Locale xác định theo: `profiles.locale` → cookie `NEXT_LOCALE` (cho trang đăng nhập) → `Accept-Language` → `vi`.
- `src/i18n/request.ts` trả `{ locale, messages, timeZone: profile.time_zone ?? 'Asia/Ho_Chi_Minh', now, formats }`. Formats dùng chung: `dateShort`, `dateTime`, `relative`, `number`, `bytes`.
- V3 public page: locale qua `?lang=` hoặc `Accept-Language`, vẫn không prefix.
- Type-safety: khai báo `AppConfig.Messages` = kiểu của `messages/vi` → dùng key sai/thiếu là lỗi TypeScript.

### 5.2 Cấu trúc file dịch
```
packages/i18n/messages/
  vi/ common.json auth.json nav.json space.json tree.json editor.json table.json
      search.json history.json settings.json admin.json errors.json email.json whatsNew.json audit.json
  en/ (cùng danh sách file, cùng cấu trúc key)
```
Mỗi file = 1 namespace. Load theo namespace cần cho route (giảm payload client).

### 5.3 Quy ước key
- `namespace.khuVực.tên` camelCase: `table.menu.mergeCells`, `tree.actions.moveTo`, `settings.language.label`.
- Lỗi: `errors.<ERROR_CODE>` với mã SCREAMING_SNAKE định nghĩa tập trung ở `packages/shared/src/errors.ts` (TS enum → script kiểm tra mọi mã đều có key dịch).
- Audit action: `audit.actions.page_create` (map từ `page.create`).
- Không dùng câu tiếng Anh làm key. Không ghép chuỗi; dùng ICU: `"{count, plural, =0 {Không có kết quả} other {# kết quả}}"` và `rich text` (`<link>…</link>`) cho chuỗi có thẻ.

### 5.4 Kiểm tra tự động (CI fail nếu vi phạm)
`pnpm i18n:check` (`packages/i18n/scripts/check.ts`):
1. Tập key `vi` == tập key `en` (báo key thiếu/thừa theo từng file).
2. Tham số ICU trùng khớp (parse bằng `@formatjs/icu-messageformat-parser`): `{name}` ở vi thì en cũng có.
3. Không có giá trị rỗng / còn `TODO`.
4. Mọi `ErrorCode` có key `errors.*`; mọi audit action có key.
5. (cảnh báo) key không được dùng — quét `t('…')` bằng AST.

ESLint: `eslint-plugin-i18next/no-literal-string` (mode `jsx-text-only` + thuộc tính `placeholder`, `title`, `aria-label`, `alt`) cho `apps/web` và `packages/editor`; ngoại lệ đặt bằng comment có lý do.

Mẫu trang (V2), email, tài liệu `docs/user-guide/{vi,en}`: script kiểm tra mỗi file `vi` có bản `en` tương ứng.

### 5.5 Quy trình thêm key
1. Thêm key vào `vi/<ns>.json` và `en/<ns>.json` trong cùng commit (dev viết cả hai; AI hỗ trợ dịch, người review).
2. Dùng `t('ns.key')` trong code → TypeScript kiểm tra.
3. `pnpm i18n:check` (cũng chạy trong pre-commit bằng lefthook).
4. Reviewer kiểm tra văn phong (xưng hô trung tính "bạn", thuật ngữ thống nhất theo `docs/glossary.md`: Space = "Không gian", Page = "Trang", Version = "Phiên bản"…).

### 5.6 Các nguồn chuỗi khác
- **Editor TipTap**: slash menu, bubble menu, table menu, placeholder — nhận hàm `t` qua React context, không chuỗi cứng trong extension.
- **Email** (mời khách, V2 thông báo): React Email dùng cùng messages; người nhận chưa có tài khoản → gửi email song ngữ (vi trước, en sau).
- **Supabase Auth**: chỉ dùng Google OAuth nên hầu như không có email từ GoTrue; trang lỗi auth của app dịch theo mã lỗi.
- **Lỗi từ DB/RLS**: API map `42501`/không có dòng → `FORBIDDEN`/`NOT_FOUND`.

---

## 6. Versioning, changelog và release

### 6.1 Tại sao chọn release-please (thay vì changesets)
- Repo là **một sản phẩm deploy** (web + collab cùng một version), không publish npm package → không cần sức mạnh multi-package của changesets.
- Đã bắt buộc Conventional Commits → release-please tự suy ra bump và nội dung changelog, không cần file changeset thủ công ở mỗi PR (ít việc cho 1 dev).
- Release PR là "cổng" rõ ràng: nhìn thấy trước version, changelog; merge = tag + GitHub Release → trigger deploy production.
- Phần song ngữ được xử lý bằng bước bổ sung (6.3), không cần changesets.

### 6.2 Cấu hình
`release-please-config.json`:
```json
{
  "packages": { ".": { "release-type": "node", "package-name": "kb",
    "bump-minor-pre-major": true, "bump-patch-for-minor-pre-major": false,
    "include-v-in-tag": true,
    "extra-files": [ "apps/web/package.json", "apps/collab/package.json" ],
    "changelog-sections": [
      { "type": "feat", "section": "Added" },
      { "type": "fix", "section": "Fixed" },
      { "type": "perf", "section": "Changed" },
      { "type": "refactor", "section": "Changed", "hidden": true },
      { "type": "revert", "section": "Removed" },
      { "type": "security", "section": "Security" },
      { "type": "docs", "hidden": true }, { "type": "chore", "hidden": true },
      { "type": "ci", "hidden": true }, { "type": "test", "hidden": true }
    ] } }
}
```
`.release-please-manifest.json`: `{ ".": "0.0.0" }` + commit đầu dùng footer `Release-As: 0.1.0` để release đầu tiên là **0.1.0**. Trước 1.0: `feat` → MINOR, `fix` → PATCH, breaking (`!`) → MINOR.

**Lộ trình số hiệu:** mỗi milestone MVP là một MINOR (`0.1.0` … `0.8.0`); `0.8.x` là bản ứng viên chạy pilot trên production với nhóm nhỏ; khi pilot đạt tiêu chí (T7.6) → commit `chore(release): 1.0.0` với footer `Release-As: 1.0.0` → **`v1.0.0` = MVP ra mắt chính thức**. Sau 1.0: `feat` → MINOR, `fix` → PATCH, breaking → MAJOR. Giai đoạn sản phẩm V2/V3 **không** đồng nghĩa với MAJOR: tính năng V2 ra dưới dạng `1.x`; chỉ tăng MAJOR khi có thay đổi phá vỡ thật (vd API public, định dạng export). Khi đó bỏ `bump-minor-pre-major` khỏi config (không còn tác dụng).
Mục `Deprecated` của Keep a Changelog: dùng footer `DEPRECATED:` → script hậu xử lý đưa vào section `Deprecated`.

### 6.3 Changelog song ngữ
- `CHANGELOG.md` gồm header Keep a Changelog; mỗi version:
  ```
  ## [0.3.0](…compare…) (2026-11-02)
  ### Added
  * **tree:** drag and drop pages in the sidebar (#42)
  ### Fixed
  …
  ### Tiếng Việt
  <nội dung changelog/vi/0.3.0.md>
  ```
- Quy trình: release-please mở/cập nhật Release PR → dev thêm `changelog/vi/<version>.md` (viết cho người dùng: Thêm / Thay đổi / Sửa lỗi) vào nhánh Release PR → workflow `release-vi-notes.yml` (chạy trên Release PR): fail nếu thiếu file; nếu có, chạy `scripts/inject-vi-changelog.ts` chèn khối `### Tiếng Việt` vào `CHANGELOG.md` và commit lại (idempotent — release-please regenerate PR thì workflow chèn lại).
- Trang **"Có gì mới / What's new"**: lúc build, `scripts/build-changelog.ts` đọc `CHANGELOG.md` (phần en, bỏ section ẩn) + `changelog/vi/*.md` → `apps/web/src/generated/changelog.json` `[{version, date, en: markdown, vi: markdown}]`. Trang render theo locale (fallback: nếu phiên bản cũ thiếu vi → hiển thị en với nhãn). Badge "Mới" trên menu khi `profiles.last_seen_version` < version hiện tại (thêm cột này vào `profiles`).

### 6.4 Hiển thị version
- Build arg `APP_VERSION` (từ `package.json`) + `GIT_SHA` → biến runtime; hiển thị ở footer sidebar (`v0.3.0`), Settings › Giới thiệu (version, sha, thời gian build, version collab lấy từ `/health`), `/api/health`.
- Client cảnh báo "Có phiên bản mới, tải lại" khi `/api/health` trả version khác version đang chạy (poll 10 phút / khi focus tab).

### 6.5 Luồng từ commit đến deploy
```
feature branch ──PR──▶ CI (lint, typecheck, unit, i18n, db test, build, e2e) + preview kb-pr-<n>
      │ squash merge (tiêu đề PR = Conventional Commit)
      ▼
main ──▶ build images ghcr.io/…/kb-{web,collab,migrate}:sha-<7> ──▶ migrate staging ──▶ deploy staging (Coolify API) ──▶ smoke test
      │
      └─▶ release-please cập nhật Release PR "chore(main): release 0.x.y"
                 │ dev thêm changelog/vi/0.x.y.md, CI chèn vào CHANGELOG.md
                 ▼ merge
          tag vX.Y.Z + GitHub Release ──▶ retag images :0.x.y (không build lại — cùng artifact đã test ở staging)
                 ──▶ GitHub Environment "production" (cần duyệt thủ công)
                 ──▶ backup trước migration ──▶ migrate prod ──▶ deploy prod (Coolify API) ──▶ smoke test ──▶ thông báo
```
Hotfix: nhánh từ `main`, `fix:` → merge → Release PR patch → release như trên. Rollback: redeploy image tag trước qua Coolify (migration forward-only + expand/contract bảo đảm app cũ chạy được với schema mới).

---

## 7. Môi trường, hạ tầng và CI/CD

### 7.0 Đề xuất server (Hostinger VPS)

**Tách staging khỏi production: CÓ.** Preview theo PR và staging chạy thử liên tục (Supabase staging ~10 container, nhiều preview cùng lúc); nếu chung máy, một PR lỗi có thể làm chậm/sập production. Thêm một VPS nhỏ rẻ hơn nhiều so với rủi ro.

| Server | Gói Hostinger | Vai trò | Ước tính RAM |
|---|---|---|---|
| `kb-prod-1` | **KVM 2** (2 vCPU, 8 GB RAM, 100 GB NVMe) | Production: Supabase prod, `kb-web`, `kb-collab`, `kb-backup` | Supabase ~3 GB (Postgres 2 GB), web ~0,5 GB, collab ~0,3 GB, Traefik ~0,3 GB → dư ~3,5 GB |
| `kb-ops-1` | **KVM 2** (2 vCPU, 8 GB RAM, 100 GB NVMe) | Coolify + staging (Supabase staging, web, collab) + preview (tối đa 2 cùng lúc) + Uptime Kuma | Coolify ~1 GB, Supabase staging ~2,5 GB, staging apps ~0,8 GB, preview 2 × 0,5 GB |

(Thông số gói lấy theo bảng giá Hostinger hiện tại — kiểm tra lại lúc đặt mua.)

- **Đủ cho team nhỏ đến ~200 người.** Nâng lên **KVM 4** (4 vCPU, 16 GB, 200 GB) ngay trong hPanel khi: CPU > 70 % kéo dài, RAM Postgres thiếu (cache hit < 99 %), hoặc cần > 2 preview cùng lúc. Nâng gói không phải cài lại.
- **Vị trí**: không bắt buộc lưu trong nước → chọn data center Hostinger **gần Việt Nam nhất** đang có (thường là Singapore hoặc Malaysia; kiểm tra danh sách lúc đặt). Độ trễ ~30–50 ms, ổn cho real-time. Hai máy nên cùng vị trí.
- **Hệ điều hành**: Hostinger có template VPS cài sẵn **Coolify** (Ubuntu) — dùng cho `kb-ops-1`. `kb-prod-1` cài Ubuntu 24.04 LTS thường, Coolify tự cài Docker khi thêm làm remote server.
- Coolify trên `kb-ops-1` quản lý `kb-prod-1` như **remote server** qua SSH. Nếu `kb-ops-1` gặp sự cố, production **vẫn chạy** (chỉ tạm không deploy được). Image build ở GitHub Actions (GHCR), không build trên server.
- **Firewall Hostinger** (hPanel › VPS › Firewall) + `ufw`: 80/443 chỉ mở cho dải IP Cloudflare; 22 chỉ cho IP quản trị (hoặc chỉ qua Cloudflare Tunnel); từ `kb-ops-1` sang `kb-prod-1` mở 22 cho Coolify. Không mở cổng Postgres.
- **Backup của Hostinger** (backup tự động hằng tuần + snapshot thủ công) dùng **bổ sung** — backup chính là `pg_dump` lên Cloudflare R2 (§7.8), vì backup của Hostinger nằm cùng nhà cung cấp và khôi phục theo cả máy.
- Ổ đĩa: 100 GB đủ cho DB (< 5 GB với 20k trang + phiên bản) và tệp đính kèm vài năm đầu; khi đầy → chuyển Supabase Storage sang backend R2 (không đổi code app).

### 7.1 Môi trường

| Môi trường | Web | Collab | Supabase | Dữ liệu |
|---|---|---|---|---|
| local | `pnpm dev` (hoặc `docker compose up`) | `pnpm dev` | **Supabase CLI** (`supabase start`) | `seed.sql` + `scripts/seed-perf.ts` (tuỳ chọn 20k trang) |
| CI | build + chạy trong job | như trên | `supabase start` trong GitHub Actions | seed |
| preview (mỗi PR) | `kb-pr-<n>.thanhgo.com` | dùng `kb-staging-collab` | **Supabase staging** (dùng chung) | dữ liệu staging |
| staging | `kb-staging.thanhgo.com` | `kb-staging-collab.thanhgo.com` | `kb-staging-api.thanhgo.com` | seed + dữ liệu thử |
| production | `kb.thanhgo.com` | `kb-collab.thanhgo.com` | `kb-api.thanhgo.com` | thật |

Staging (và preview) chạy trên `kb-ops-1`, production trên `kb-prod-1` (§7.0).

Local Google OAuth: Supabase CLI `config.toml` `[auth.external.google]` với OAuth client riêng cho dev (redirect `http://127.0.0.1:54321/auth/v1/callback`). E2E/CI không dùng Google: bật email+password **chỉ trong local/CI** (`[auth.email] enable_signup = true` trong `config.toml`), tạo người dùng test bằng admin API; production tắt provider email (`GOTRUE_EXTERNAL_EMAIL_ENABLED=false`).

### 7.2 Dockerfile

**`apps/web/Dockerfile`** (phác thảo):
```dockerfile
FROM node:22-alpine AS base
RUN corepack enable
FROM base AS pruner
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo prune @kb/web --docker
FROM base AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
ARG APP_VERSION GIT_SHA
ENV NEXT_TELEMETRY_DISABLED=1 APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA
RUN pnpm turbo run build --filter=@kb/web   # gồm build-changelog.ts
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
```
Lưu ý quan trọng: **không dùng `NEXT_PUBLIC_*` cho giá trị khác nhau giữa môi trường** (chúng bị "đóng băng" lúc build → không thể dùng cùng một image cho staging và prod). Cấu hình public (URL Supabase, anon key, URL collab) được server đọc từ env runtime và truyền xuống client qua `<PublicEnvProvider>` trong root layout.

**`apps/collab/Dockerfile`**: tương tự (turbo prune `@kb/collab`, build bằng `tsup` ra `dist/index.js`), `EXPOSE 3001`, `HEALTHCHECK … /health`, `CMD ["node","dist/index.js"]`, xử lý `SIGTERM`: ngừng nhận kết nối, flush `store` của mọi document, rồi thoát (Coolify cho `stop_grace_period` 30 s).

**`infra/migrate/Dockerfile`**: `supabase/postgres`-compatible image với Supabase CLI + thư mục `supabase/migrations`; entrypoint `supabase db push --db-url "$DATABASE_URL" --include-all`.

**`infra/backup/Dockerfile`**: `postgres:15-alpine` + `rclone` + `age`; script `backup.sh` (§7.8).

### 7.3 Domain, DNS, HTTPS, Cloudflare
- **Chỉ dùng subdomain 1 cấp** dưới `thanhgo.com`: Universal SSL miễn phí của Cloudflare chỉ phủ `thanhgo.com` và `*.thanhgo.com`; tên 2 cấp như `collab.kb.thanhgo.com` cần Advanced Certificate Manager (trả phí). Vì vậy: `kb`, `kb-collab`, `kb-api`, `kb-staging`, `kb-staging-collab`, `kb-staging-api`, `kb-pr-<n>`, `kb-studio` (Studio, sau Cloudflare Access).
- DNS: bản ghi A/CNAME **proxied** (mây cam) trỏ về IP server Coolify. Preview: workflow `preview-dns.yml` tạo `kb-pr-<n>` khi mở PR và xoá khi đóng (Cloudflare API token quyền `Zone.DNS:Edit` chỉ cho zone này) — tránh wildcard `*.thanhgo.com`.
- TLS origin: **Cloudflare Origin CA certificate** wildcard `*.thanhgo.com` (hạn dài) cài làm default certificate của Traefik trong Coolify → SSL mode **Full (strict)**. Không cần Let's Encrypt (tránh vấn đề HTTP-01 sau proxy). Tuỳ chọn bật Authenticated Origin Pulls.
- Firewall server: 80/443 chỉ cho dải IP Cloudflare; SSH chỉ qua Cloudflare Tunnel/IP quản trị; cổng Postgres **không public**.
- Cloudflare: bật "Always Use HTTPS", HSTS (sau khi ổn định), WAF managed rules; tắt Rocket Loader/minify cho HTML (tránh làm hỏng hydration); cache: chỉ cache `/_next/static/*` (immutable), bypass cho còn lại.
- `kb-studio`: Supabase Studio chỉ bật sau **Cloudflare Access** (Zero Trust, Google login, chỉ admin) + basic auth của Kong.

### 7.4 Cấu hình Coolify từng service

**Supabase** (Coolify service template "Supabase"):
- Project `kb-prod` / `kb-staging`. Domain Kong: `kb-api.thanhgo.com`; Studio `kb-studio.thanhgo.com`.
- Image Postgres `supabase/postgres` 15.x (có sẵn `pgvector`, `pg_trgm`, `unaccent`, `pgtap`); migration đầu `create extension if not exists … schema extensions`.
- Volume persistent cho `db-data`, `storage-data`. Storage backend: file trên đĩa (MVP, đơn giản, nhanh); khi dữ liệu tệp lớn → cấu hình Supabase Storage dùng **S3 backend = Cloudflare R2** (bucket riêng `kb-attachments-prod`, không trùng bucket backup).
- Cấu hình GoTrue: Google OAuth, `SITE_URL`, `ADDITIONAL_REDIRECT_URLS`, hook `before_user_created` (pg-function) — **spike T0.10 xác minh version GoTrue self-host hỗ trợ**; dự phòng: trigger `before insert on auth.users` raise exception.
- Realtime: bật; publication `supabase_realtime` chỉ gồm `pages` (cập nhật cây trang).
- Bật "Connect to predefined network" để `kb-collab`, `kb-backup`, `kb-migrate` truy cập `supabase-db` qua tên host nội bộ.
- Tài nguyên: giới hạn RAM Postgres (vd 2–4 GB), `shared_buffers` 25%.

**kb-web** (Application, build pack "Docker Image"):
- Image `ghcr.io/nguyenthanhcv1/kb-web:<tag>` (registry credentials GHCR read-only trong Coolify).
- Domain `https://kb.thanhgo.com`, port 3000.
- Health check: path `/api/health`, interval 15 s, timeout 3 s, retries 3, start period 20 s.
- Rolling update: Coolify chỉ chuyển traffic khi health check pass (zero-downtime).
- Env: §7.6.

**kb-collab** (Application, Docker Image):
- Image `ghcr.io/nguyenthanhcv1/kb-collab:<tag>`, domain `https://kb-collab.thanhgo.com`, port 3001.
- Health check `/health` (trả `{status, version, connections, documents}`).
- Connect to predefined network (tới `supabase-db`, và `kb-web` gọi internal API qua `http://kb-collab:3001` — cổng internal API **chỉ** lắng nghe trên mạng nội bộ; Traefik label chặn path `/internal/*` từ public).
- Graceful shutdown timeout 30 s. **1 replica** ở MVP.

**kb-web-preview** (Application, build pack "Dockerfile" từ GitHub App, nhánh `main`):
- Bật **Preview Deployments**, URL template `https://kb-pr-{{pr_id}}.thanhgo.com`, chỉ build khi PR có thay đổi ở `apps/web`, `packages/*`.
- Env preview: trỏ Supabase staging + `kb-staging-collab`; `APP_ENV=preview` (banner "Preview #n").
- Tự xoá khi PR đóng (Coolify), DNS xoá bằng workflow.
- Giới hạn tài nguyên (512 MB RAM/preview), tối đa 2 preview chạy cùng lúc trên `kb-ops-1` (PR cũ hơn tự dừng).

**kb-backup** (Scheduled task / service chạy cron) — §7.8.
**Uptime Kuma** (tuỳ chọn, service template): theo dõi `/api/health`, `/health`, `kb-api/auth/v1/health`, alert Slack/Telegram/email.

### 7.5 Trigger deploy từ GitHub Actions
- Coolify API v4: `PATCH /api/v1/applications/{uuid}` đặt `docker_registry_image_tag`, sau đó `GET /api/v1/deploy?uuid={uuid}&force=false` với `Authorization: Bearer $COOLIFY_API_TOKEN` (token riêng mỗi môi trường, quyền deploy). Workflow poll trạng thái deployment rồi chạy smoke test (`curl /api/health` so sánh version).
- Migration: workflow SSH (qua Cloudflare Tunnel `cloudflared access ssh`, key chỉ dùng cho deploy) vào host → `docker run --rm --network <supabase-network> ghcr.io/…/kb-migrate:<tag>`; production chạy `kb-backup` một lần trước khi migrate.
- Thứ tự: migrate → deploy `kb-collab` → deploy `kb-web` (schema mới tương thích ngược theo expand/contract).
- Spike T0.8 xác nhận tên trường API của phiên bản Coolify đang dùng (API Coolify thay đổi giữa các bản beta).

### 7.6 Biến môi trường và secret

| Biến | Service | Secret? | Ghi chú |
|---|---|---|---|
| `APP_ENV` | web, collab | – | `local`/`preview`/`staging`/`production` |
| `APP_URL` | web | – | `https://kb.thanhgo.com` |
| `SUPABASE_URL` | web | – | `https://kb-api.thanhgo.com` (truyền xuống client runtime) |
| `SUPABASE_ANON_KEY` | web | – (public nhưng quản lý như secret) | |
| `SUPABASE_SERVICE_ROLE_KEY` | web | **có** | chỉ dùng ở server: gửi lời mời, job hệ thống |
| `COLLAB_PUBLIC_URL` | web | – | `wss://kb-collab.thanhgo.com` |
| `COLLAB_INTERNAL_URL` | web | – | `http://kb-collab:3001` |
| `COLLAB_INTERNAL_SECRET` | web, collab | **có** | HMAC cho internal API |
| `DEFAULT_LOCALE` / `DEFAULT_TIME_ZONE` | web | – | `vi` / `Asia/Ho_Chi_Minh` |
| `SMTP_HOST/PORT/USER/PASSWORD/FROM`, `SMTP_REPLY_TO` | web, supabase | **có** | §7.14 — giai đoạn 1: `smtp.gmail.com:587`, user = tài khoản Workspace, password = App Password |
| `BOOTSTRAP_SUPER_ADMIN_EMAILS` | web (seed) | – | `nguyenthanh.cv@gmail.com` — chỉ dùng khi DB chưa có super admin |
| `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` | web, worker (V3) | **có** | chỉ thêm ở V3 |
| `SENTRY_DSN` (hoặc GlitchTip) | web, collab | có | tuỳ chọn |
| `DATABASE_URL` | collab | **có** | role `kb_collab`, host `supabase-db` nội bộ |
| `SUPABASE_JWT_SECRET` | collab | **có** | verify access token (hoặc `SUPABASE_JWKS_URL` nếu dùng khoá bất đối xứng) |
| `REDIS_URL` | collab | có | để trống = không bật extension Redis |
| `PORT`, `INTERNAL_PORT` | collab | – | 3001 |
| `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` | supabase | **có** | sinh bởi Coolify template, mỗi môi trường khác nhau |
| `SITE_URL`, `API_EXTERNAL_URL`, `ADDITIONAL_REDIRECT_URLS` | supabase | – | staging thêm `https://kb-pr-*.thanhgo.com/**` |
| `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | supabase | **có** | OAuth client riêng cho staging và prod (§7.15) |
| `GOTRUE_EXTERNAL_EMAIL_ENABLED` | supabase | – | `false` ở staging/prod |
| `GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED/URI` | supabase | – | `pg-functions://postgres/public/hook_before_user_created` |
| `DASHBOARD_USERNAME/PASSWORD` | supabase | **có** | Studio |
| `S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY`, `BACKUP_AGE_RECIPIENT` | backup | **có** | R2: endpoint `https://<account_id>.r2.cloudflarestorage.com`, token R2 chỉ quyền Object Read & Write trên bucket backup |

GitHub (Environments `staging`, `production` — production có required reviewer): `COOLIFY_API_URL`, `COOLIFY_API_TOKEN`, `COOLIFY_APP_UUID_WEB/COLLAB`, `DEPLOY_SSH_KEY`, `CF_TUNNEL_*`, `CLOUDFLARE_API_TOKEN` (DNS preview), `GHCR` dùng `GITHUB_TOKEN`.

Quy tắc: secret chỉ ở Coolify (đánh dấu locked/encrypted) và GitHub Environments; `.env.example` liệt kê đủ key (giá trị giả); mỗi app validate env bằng zod lúc khởi động (`packages/shared/src/env.ts`) — thiếu biến là crash sớm; runbook `docs/runbooks/rotate-secrets.md` (xoay JWT secret = đăng xuất toàn bộ).

### 7.7 WebSocket qua proxy
- **Traefik (Coolify)**: hỗ trợ WebSocket mặc định (Upgrade header). Không gắn middleware buffering/compress cho `kb-collab`. Nếu dùng Caddy thay Traefik: `reverse_proxy` cũng tự xử lý WS; đặt `flush_interval -1`.
- Timeout: Traefik mặc định không cắt kết nối idle đang mở; đảm bảo `respondingTimeouts` không đặt `readTimeout` thấp cho entrypoint (Traefik v3 mặc định `readTimeout=60s` → **đặt `0`** hoặc lớn cho entrypoint `https`, xác minh ở T0.10).
- **Cloudflare**: WebSocket bật mặc định mọi plan; idle timeout ~100 s → Hocuspocus gửi ping định kỳ (`timeout` 30 s) nên kết nối không idle. Cloudflare có thể ngắt WS khi deploy lại edge → client `HocuspocusProvider` tự reconnect với backoff; UI hiển thị trạng thái "Đang kết nối lại…", edit offline vẫn được giữ trong Y.Doc và đồng bộ khi nối lại (tuỳ chọn `y-indexeddb` để giữ qua reload — V2).
- Token hết hạn (1 giờ): client refresh session Supabase và gọi `provider.sendToken()`/reconnect với token mới; server kiểm tra hạn token lúc authenticate và định kỳ (onStateless / timer) ngắt kết nối có token hết hạn.
- Origin check: collab chỉ chấp nhận `Origin` thuộc danh sách (`kb.thanhgo.com`, `kb-staging…`, `kb-pr-*.thanhgo.com` ở staging).

### 7.8 Backup Postgres tự động
- **Hằng đêm (02:00 ICT)** `kb-backup`: `pg_dump -Fc` (DB `postgres`, gồm schema `auth`, `storage`, `public`) → mã hoá `age` → `rclone copy` lên **Cloudflare R2** (`r2:kb-backups/prod/daily/YYYY-MM-DD.dump.age`). Đồng bộ volume storage (tệp đính kèm) bằng `rclone sync` (bản versioned ở bucket).
- **Vì sao R2, không dùng Supabase Storage làm đích backup?** Supabase Storage có API tương thích S3, nhưng nó chạy **trên chính server production** — server hỏng thì mất cả DB lẫn backup. Backup phải nằm ở hạ tầng khác. R2: đã dùng Cloudflare, không phí egress (restore không tốn tiền), 10 GB miễn phí rồi ~0,015 USD/GB/tháng, hỗ trợ lifecycle rule và bucket lock (chống xoá/ghi đè — bảo vệ khi server bị chiếm quyền). Dự phòng: Backblaze B2 hoặc AWS S3.
- Khoá: token R2 của server chỉ có quyền ghi vào bucket backup (không có quyền xoá); bật bucket lock 30 ngày; khoá riêng `age` giữ **ngoài server** (password manager của admin).
- Retention bằng lifecycle rule R2: daily 14 ngày, weekly 8 tuần, monthly 12 tháng. Chi phí ước tính < 2 USD/tháng.
- Staging không backup (có thể dựng lại từ seed), chỉ snapshot VPS.
- Trước mỗi migration production: backup ad-hoc `pre-migrate-<version>`.
- Coolify có tính năng scheduled backup cho database — dùng **bổ sung** nếu hỗ trợ container `supabase-db` trong service; không phụ thuộc hoàn toàn.
- **Kiểm thử khôi phục hằng tháng** (tự động): job tải bản mới nhất, restore vào Postgres tạm, chạy truy vấn kiểm tra (đếm `pages`, `page_documents`, decode ngẫu nhiên 20 `ydoc`), báo kết quả. Runbook `docs/runbooks/backup-restore.md`.
- Mục tiêu (đề xuất): RPO 24 h (MVP) → V2 cân nhắc WAL-G PITR để RPO ~5 phút; RTO 2 h.
- Healthcheck backup: job ping Uptime Kuma (push monitor); không ping trong 26 h → cảnh báo.

### 7.9 Health check
| Endpoint | Kiểm tra | Dùng cho |
|---|---|---|
| `kb-web GET /api/health` | process sống; trả `{status, version, sha, env}` (không gọi DB) | Docker/Coolify health check, smoke test |
| `kb-web GET /api/health/ready` | + gọi Supabase (`/auth/v1/health`, `select 1` qua RPC `app_health`) + collab `/health` | Uptime Kuma |
| `kb-collab GET /health` | process + pool Postgres `select 1`; `{status, version, connections, documents, schemaVersion}` | Coolify health check |
| Supabase Kong `/auth/v1/health`, `/rest/v1/` | | Uptime Kuma |

### 7.10 Lưu trạng thái Yjs vào Postgres (chi tiết)
- Extension `@hocuspocus/extension-database`:
  - `fetch({ documentName })`: `select ydoc, schema_version from page_documents where page_id = $1` → nếu `schema_version` cũ, chạy migrate nội dung trong bộ nhớ.
  - `store({ documentName, state, document, context })`: transaction:
    1. `select ydoc from page_documents where page_id=$1 for update`
    2. `merged = Y.mergeUpdates([dbYdoc, state])` (an toàn khi nhiều instance cùng ghi — không mất update)
    3. dẫn xuất từ `document` (Y.Doc hiện tại): `TiptapTransformer.fromYdoc(document, 'default')` với **extension từ `packages/editor`** → `content_json`; `extractText/Headings/Tables`
    4. `update page_documents set ydoc=merged, content_json=…, content_text=…, …`
    5. `set local app.actor_id = <user cuối cùng sửa>`; `update pages set last_edited_at=now(), last_edited_by=…`
    6. audit `page.update_content` (gộp 10 phút) và snapshot `page_versions` theo §3.6
  - Debounce 2 s, maxDebounce 10 s; `onDisconnect` của client cuối → store ngay + snapshot.
- Không lưu log từng update (append-only) ở MVP: đơn giản, đủ cho quy mô; `ydoc` được giữ gọn nhờ Yjs GC (bật `gc: true`). Lịch sử nằm ở `page_versions`.
- Kích thước: cảnh báo log khi `ydoc` > 5 MB; ảnh không bao giờ nhúng base64 (chặn ở paste handler, upload lên Storage).

### 7.11 Phương án scale `kb-collab`
- MVP: 1 instance đủ cho < 200 người (Hocuspocus xử lý hàng nghìn kết nối/instance).
- Khi cần (V2+, hoặc HA): thêm Redis (Coolify service) + `@hocuspocus/extension-redis` (bật khi có `REDIS_URL`) → các instance đồng bộ update và awareness qua pub/sub; persistence an toàn nhờ `mergeUpdates` + `for update` (7.10). Load balancing: Traefik round-robin giữa các replica (Coolify: nhiều app cùng image + chung router, hoặc Docker Swarm mode của Coolify); **sticky session theo document** (cookie hoặc hash `documentName` trong query) giảm tải Redis nhưng không bắt buộc.
- Graceful drain khi deploy: instance nhận SIGTERM đóng kết nối có mã "reconnect", client tự nối sang instance khác.

### 7.12 Preview deploy theo PR
- Coolify Preview Deployments cho `kb-web-preview` (§7.4) → `https://kb-pr-<n>.thanhgo.com`; Coolify comment URL lên PR (GitHub App).
- Dùng Supabase staging + collab staging. Hạn chế: **PR có migration** → preview không có schema mới. Quy trình: migration phải expand-only; gắn label `db:staging` → workflow áp migration của PR vào staging (chỉ migration chưa có trên main, người review xác nhận); nếu không, preview hiển thị cảnh báo "Migration chưa áp dụng". Test migration thật diễn ra ở CI (DB tạm).
- PR thay đổi `apps/collab`/`packages/editor` (schema): preview chỉ test giao diện; test tích hợp collab chạy ở CI. (Tuỳ chọn V2: preview cho collab với label `preview:collab`.)
- Đăng nhập trên preview: redirect URL wildcard đã whitelist ở GoTrue staging.

### 7.13 GitHub Actions

| Workflow | Trigger | Job |
|---|---|---|
| `ci.yml` | PR, push `main` | `lint` (eslint + prettier + no-literal-string) · `typecheck` (turbo) · `unit` (vitest, coverage) · `i18n` (`pnpm i18n:check`) · `pr-title` (`amannn/action-semantic-pull-request`) · `db` (`supabase start` → `db reset` → `supabase test db` → kiểm tra drift types) · `build` (turbo build web + collab, docker build không push ở PR) · `licenses` (§2.1) |
| `e2e.yml` | PR (sau `ci`), push `main` | `supabase start` + seed, chạy web + collab (build production), Playwright (Chromium; Firefox/WebKit nightly), upload trace/video khi fail |
| `release-please.yml` | push `main` | `googleapis/release-please-action` |
| `release-vi-notes.yml` | PR từ nhánh `release-please--*` | kiểm tra & chèn `changelog/vi/<version>.md` vào `CHANGELOG.md` |
| `build-images.yml` | push `main`, release published | build & push `kb-web`, `kb-collab`, `kb-migrate` lên GHCR (`sha-<7>`; release → retag `X.Y.Z`, `latest`) |
| `deploy.yml` | sau `build-images` (main → staging; release → production với environment approval) | backup (prod) → migrate → deploy collab → deploy web → smoke test → thông báo |
| `preview-dns.yml` | PR opened/closed | tạo/xoá DNS `kb-pr-<n>` |
| `nightly.yml` | cron | E2E đa trình duyệt, `pnpm audit`, perf search với seed 20k |
| Dependabot/Renovate | tuần | cập nhật deps, nhóm theo hệ (tiptap, next, supabase) |

Branch protection `main`: bắt buộc `ci/*`, `e2e`, 1 review (hoặc tự review khi 1 dev — bật khi có người thứ 2), squash merge only, linear history.

### 7.14 Email (SMTP) — cấu hình ở phạm vi team, không cần admin công ty
Supabase self-host **không có dịch vụ gửi mail**; GoTrue chỉ nhận cấu hình SMTP bên ngoài (và vì dùng Google OAuth nên GoTrue hầu như không gửi mail). Email của app (mời khách; V2: thông báo, @mention, digest) do `kb-web` gửi. Code chỉ đọc `SMTP_*` → đổi nhà cung cấp chỉ là đổi biến môi trường.

Google Workspace SMTP relay (`smtp-relay.gmail.com`) **không** phù hợp cho team nhỏ vì cần super admin của Workspace bật trong Admin console. Thay vào đó:

**Giai đoạn 1 — Gmail SMTP bằng App Password (đề xuất để bắt đầu, ~10 phút, không cần admin, không đổi DNS)**
1. Chọn một tài khoản Workspace của team (tốt nhất là tài khoản dùng chung nếu team có, vd `kb@…`; không có thì dùng tài khoản của người phụ trách).
2. Bật **Xác minh 2 bước** cho tài khoản đó (myaccount.google.com › Bảo mật).
3. Tạo **App Password** (myaccount.google.com › Bảo mật › Mật khẩu ứng dụng) tên "kb-smtp" → được chuỗi 16 ký tự.
4. Đặt trong Coolify (secret): `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587` (STARTTLS), `SMTP_USER=<email tài khoản>`, `SMTP_PASSWORD=<app password>`, `SMTP_FROM="KB <email tài khoản>"`, `SMTP_REPLY_TO=<email người phụ trách>`.
5. Gửi thử từ trang `/admin/settings` › "Gửi email thử".
- Ưu: email gửi từ domain công ty nên SPF/DKIM đã có sẵn (Google lo), không vào spam; miễn phí.
- Giới hạn: ~2.000 email/ngày/tài khoản (thừa cho team nhỏ); email đi ra từ địa chỉ của tài khoản đó; nếu người đó nghỉ/đổi mật khẩu thì phải tạo lại App Password (runbook). Nếu tổ chức tắt App Password (một số chính sách bảo mật chặn) → chuyển giai đoạn 2.

**Giai đoạn 2 — Resend với domain `thanhgo.com` (khi mở rộng hoặc muốn địa chỉ `kb-noreply@thanhgo.com`)**
- Domain `thanhgo.com` do anh/chị quản lý trên Cloudflare → tự thêm bản ghi SPF/DKIM/DMARC mà Resend cung cấp, không liên quan IT công ty. Gói miễn phí ~3.000 email/tháng (100/ngày). Dự phòng: Amazon SES (rẻ khi khối lượng lớn, cần ra khỏi sandbox).

Chung cho mọi phương án: template song ngữ (§5.6); log gửi mail (thành công/thất bại); local/CI dùng **Mailpit** có sẵn trong Supabase CLI để không gửi thật.

### 7.15 Google OAuth — cấu hình ở phạm vi team
Mục tiêu: đăng nhập Google hoạt động cho cả tài khoản công ty lẫn Gmail cá nhân (super admin `nguyenthanh.cv@gmail.com`), **không cần admin Workspace**; ai được vào thì do allowlist của app quyết định (§3.2).

1. Đăng nhập **Google Cloud Console bằng `nguyenthanh.cv@gmail.com`** (tài khoản cá nhân → project không nằm trong tổ chức của công ty, không bị chính sách công ty chặn tạo project). Tạo project `kb-auth` (một project, hai OAuth client: staging và prod).
2. **OAuth consent screen / Google Auth Platform**: User type **External** (loại *Internal* sẽ chặn Gmail cá nhân và chỉ tạo được trong tổ chức Workspace). Tên app "KB", email hỗ trợ, domain `thanhgo.com`. Scope chỉ `openid`, `email`, `profile` (không nhạy cảm).
3. **Publishing status: "In production"**. Với scope không nhạy cảm, không phải qua quy trình xác minh của Google (không có logo thì không cần xác minh thương hiệu). Để ở chế độ *Testing* cũng được nhưng phải thêm tay từng người (tối đa 100) — không cần vì app đã có allowlist riêng.
4. **Credentials › OAuth client ID** (Web application):
   - prod: Authorized redirect URI `https://kb-api.thanhgo.com/auth/v1/callback`
   - staging: `https://kb-staging-api.thanhgo.com/auth/v1/callback`
   - local: client riêng với `http://127.0.0.1:54321/auth/v1/callback`
5. Dán Client ID/Secret vào Coolify (`GOTRUE_EXTERNAL_GOOGLE_*`) của Supabase tương ứng.
6. Trong app: super admin đăng nhập lần đầu → `/admin/access` → thêm email từng thành viên team (hoặc domain công ty khi muốn mở rộng).

Rủi ro cần biết: nếu admin Workspace của công ty bật chính sách chặn "ứng dụng bên thứ ba chưa được cấu hình", nhân viên có thể gặp lỗi khi đăng nhập Google vào app. Cách xử lý: nhờ admin thêm Client ID của KB vào danh sách tin cậy (một thao tác), hoặc tạm dùng lời mời qua email cá nhân. Kiểm tra ngay ở spike T0.10 bằng 1 tài khoản công ty.

---

## 8. Kế hoạch testing

| Tầng | Công cụ | Phạm vi |
|---|---|---|
| Unit | Vitest | `normalizeVi`, slug, fractional index, trích xuất text/table, **paste Excel/Sheets** (fixtures HTML thật), **export CSV** (ô gộp, dấu phẩy, xuống dòng, BOM), parser changelog, i18n check script, map mã lỗi |
| Component | Vitest + Testing Library | menu bảng, tree item, language switcher (không chuỗi cứng: render với `en` và `vi`) |
| DB / RLS | **pgTAP** (`supabase test db`) + helper `tests.authenticate_as(user)` (basejump `supabase-test-helpers`) | Ma trận **vai trò** (super admin, admin, editor, viewer, nội bộ không thành viên, khách thành viên, khách không thành viên, deactivated, anon) × **bảng** × **thao tác** (select/insert/update/delete); Space `internal` vs `restricted`; di chuyển trang giữa Space; khách không thể thành admin; audit log bất biến; mọi bảng bật RLS; `kb_collab` không đọc được bảng ngoài phạm vi |
| Search | pgTAP + script | truy vấn không dấu/có dấu/NFD, cụm từ, prefix, trong bảng; không rò kết quả từ Space không có quyền; golden set 30 truy vấn (MRR ≥ 0,8); perf p95 < 300 ms với 20k trang |
| Integration collab | Vitest + Postgres thật (Supabase CLI) + `@hocuspocus/provider` trong Node | từ chối token sai/hết hạn, viewer read-only (update bị bỏ), persist → reload giữ nguyên, 2 client đồng thời sửa bảng (gộp ô + thêm hàng) hội tụ, internal replace API, snapshot policy, schema version mismatch |
| E2E | **Playwright** | đăng nhập (người dùng test), tạo Space, mời thành viên, cây trang (tạo/kéo thả/xoá/khôi phục), editor cơ bản, **bảng** (thêm/xoá/kéo thả hàng-cột, header, resize, gộp/tách, màu nền, paste từ clipboard giả lập `DataTransfer` với HTML Excel/Sheets, tải CSV), tìm kiếm không dấu, viewer không sửa được, lịch sử + khôi phục, đổi ngôn ngữ được lưu sau đăng xuất/đăng nhập, trang What's new, version ở footer |
| i18n E2E | Playwright | chạy smoke suite ở cả `vi` và `en`; bắt lỗi `MISSING_MESSAGE` của next-intl (onError → fail test) |
| Smoke sau deploy | curl + Playwright nhẹ | `/api/health` đúng version, đăng nhập trang login render |
| Khôi phục backup | job hằng tháng | §7.8 |

Mục tiêu coverage: `packages/editor` ≥ 80 %, logic khác ≥ 60 %; mọi policy RLS có test.

---

## 9. Milestones MVP

> Phân công cho 3 agent chạy song song (claude-1, claude-2, codex-1; lane codex-2 cũ đã chia cho claude-1/claude-2): task trong bảng dưới được tách thành phần server (`a`) và UI (`b`) và gán lane trong [`docs/ai/tasks.yaml`](ai/tasks.yaml); quy trình ở [`docs/ai/WORKFLOW.md`](ai/WORKFLOW.md). UI luôn do Claude Code làm. Nếu chạy song song đủ 3 agent, thời gian lịch ước ~7–8 tuần thay vì ~3 tháng.

Ước lượng cho **1 dev fulltime (+AI)**. Mỗi milestone kết thúc bằng một release (MINOR). "Version" = release đầu tiên chứa task.

### M0 — Nền tảng (→ `v0.1.0`) · ~12 ngày

| ID | Task | File/module | Tiêu chí hoàn thành | Phụ thuộc | Ước lượng | Version |
|---|---|---|---|---|---|---|
| T0.1 | Khởi tạo monorepo: pnpm workspaces, Turborepo, TS base, ESLint/Prettier, Next.js App Router (`output: standalone`) + Tailwind + shadcn/ui, skeleton `apps/collab` | `package.json`, `turbo.json`, `apps/*`, `packages/config` | `pnpm dev` chạy web :3000 + collab :3001; `pnpm lint typecheck build` pass | – | 1 | 0.1.0 |
| T0.2 | Quy ước commit: commitlint + lefthook, PR template (checklist DoD), CODEOWNERS, `CONTRIBUTING.md` | `.lefthook.yml`, `.github/` | commit sai định dạng bị chặn local; PR template có checklist i18n/RLS/changelog | T0.1 | 0,5 | 0.1.0 |
| T0.3 | Nền i18n: `packages/i18n`, next-intl không prefix URL, resolve locale (cookie → header → vi), timeZone mặc định, formatter, `normalizeVi`, ESLint no-literal-string, script `i18n:check` | `packages/i18n`, `apps/web/src/i18n` | Trang mẫu hiển thị vi/en; xoá 1 key en → `pnpm i18n:check` fail; literal JSX → lint fail | T0.1 | 1,5 | 0.1.0 |
| T0.4 | Supabase local: `supabase init`, `config.toml` (Google local, email chỉ local), migration extensions (`unaccent`, `pg_trgm`, `vector`, `pgtap`), schema `app`, `touch_updated_at`, test "mọi bảng bật RLS", `docker-compose.yml` web+collab | `supabase/`, `infra/docker-compose.yml` | `supabase start && pnpm db:reset && pnpm db:test` pass; README hướng dẫn chạy local | T0.1 | 1 | 0.1.0 |
| T0.5 | CI: `ci.yml` (lint, typecheck, unit, i18n, pr-title, db, build) có cache pnpm/turbo | `.github/workflows/ci.yml` | PR mẫu chạy xanh < 10 phút; cố tình lệch key i18n → đỏ; thêm package license không cho phép → đỏ | T0.3, T0.4 | 1 | 0.1.0 |
| T0.6 | Release: release-please config + manifest (`Release-As: 0.1.0`), `release-vi-notes.yml`, `inject-vi-changelog.ts`, `build-changelog.ts`, trang What's new (skeleton), version ở footer + Settings › Giới thiệu + `/api/health` | `release-please-config.json`, `scripts/`, `apps/web/src/app/(app)/whats-new` | Release PR mở tự động; thiếu `changelog/vi/0.1.0.md` → check đỏ; sau merge có tag `v0.1.0`; app hiển thị `v0.1.0` và changelog đúng ngôn ngữ | T0.3, T0.5 | 1,5 | 0.1.0 |
| T0.7 | Dockerfile web/collab/migrate, HEALTHCHECK, `/api/health`, `/health`, env zod, `build-images.yml` push GHCR | `apps/*/Dockerfile`, `infra/migrate`, `packages/shared/src/env.ts` | `docker build` cả 3 image; container healthy; image web < 250 MB; thiếu env bắt buộc → crash kèm tên biến | T0.1 | 1 | 0.1.0 |
| T0.8 | Hạ tầng staging trên Coolify (cài Coolify lên `kb-ops-1`, §7.0): Supabase service, `kb-web`, `kb-collab`, Cloudflare DNS + Origin CA + Full strict, firewall, secrets, `deploy.yml` qua Coolify API + SSH migrate | `infra/coolify/*.md`, `.github/workflows/deploy.yml` | Merge `main` → staging tự deploy, smoke test xanh; `https://kb-staging.thanhgo.com/api/health` trả sha mới; Postgres không truy cập được từ Internet | T0.7 | 2 | 0.1.0 |
| T0.9 | Backup: image `kb-backup`, cron, Cloudflare R2 (bucket lock + lifecycle), mã hoá age, restore runbook, job kiểm thử restore | `infra/backup`, `docs/runbooks/backup-restore.md` | Có file backup trên S3; restore vào DB tạm thành công theo runbook; alert khi quá 26 h không backup | T0.8 | 1 | 0.1.0 |
| T0.11 | Công cụ cho agent chạy song song: `pnpm ai:next --agent <id>` (chọn task theo `docs/ai/tasks.yaml` + git), `pnpm ai:status`, CI `agent-scope` (so file thay đổi với vùng sở hữu của lane trong thân PR; chặn Codex sửa file UI) | `scripts/ai/*.ts`, `.github/workflows/ci.yml` | PR của `codex-1` sửa `components/**` → check đỏ; `ai:next` trả đúng task ready đầu tiên của lane | T0.5 | 0,5 | 0.1.0 |
| T0.10 | Spike xác minh rủi ro: (a) hook `before_user_created` trên GoTrue self-host, (b) Hocuspocus qua Cloudflare + Traefik (timeout, reconnect), (c) verify JWT Supabase trong collab, (d) Coolify preview + DNS workflow, (e) đăng nhập Google bằng tài khoản công ty qua OAuth client External của project cá nhân, (f) gửi mail bằng Gmail App Password | ADR `docs/adr/0001…0004` | Mỗi điểm có ADR kết luận + phương án dự phòng; WS giữ kết nối ≥ 30 phút qua Cloudflare | T0.8 | 1 | 0.1.0 |

### M1 — Đăng nhập, hồ sơ, Space, phân quyền (→ `v0.2.0`) · ~9,5 ngày

| ID | Task | File/module | Tiêu chí hoàn thành | Phụ thuộc | Ước lượng | Version |
|---|---|---|---|---|---|---|
| T1.1 | Schema lõi: `profiles`, `app_settings`, `spaces`, `space_members`, `invitations`, enum, hàm `app.*` (space_role, can_*, page_role stub), RLS + grant, pgTAP ma trận | `supabase/migrations/*_core.sql`, `supabase/tests/rls_core.test.sql` | Toàn bộ ma trận vai trò pass; khách không thể là admin; không xoá được admin cuối | T0.4 | 2 | 0.2.0 |
| T1.2 | Google SSO: `@supabase/ssr` (client/server/middleware), trang login song ngữ, callback, logout, hook chặn domain + nhận lời mời, trigger tạo profile, trang lỗi `AUTH_NOT_ALLOWED` | `apps/web/src/app/(auth)`, `middleware.ts`, migration hook | `nguyenthanh.cv@gmail.com` (bootstrap) đăng nhập được và thành super admin, không bị đánh dấu khách; email/domain trong allowlist đăng nhập được; email lạ bị từ chối với thông báo vi/en; có lời mời → vào được, `is_guest = true` | T1.1, T0.10 | 1,5 | 0.2.0 |
| T1.3 | Cài đặt cá nhân: đổi ngôn ngữ (lưu `profiles.locale` + cookie), múi giờ, avatar/tên | `apps/web/src/app/(app)/settings` | Đổi sang en → toàn bộ UI en, giữ sau đăng xuất/đăng nhập ở máy khác | T1.2 | 0,5 | 0.2.0 |
| T1.4 | UI Space: danh sách (theo quyền), tạo (người nội bộ), cài đặt (tên, slug, icon, visibility), lưu trữ | `apps/web/src/app/(app)/s/[spaceSlug]`, `components/space` | Space mới mặc định `restricted` (chỉ người tạo là admin); viewer không thấy nút sửa; khách không thấy Space internal; slug trùng báo lỗi dịch | T1.1 | 1,5 | 0.2.0 |
| T1.5 | Thành viên: thêm người nội bộ (tìm theo tên/email), đổi vai trò, xoá, tự rời; mời khách qua email (token, hạn 14 ngày, thu hồi), email React Email song ngữ | `settings/members`, `packages/emails`, route `/invite/[token]` | Luồng mời → nhận → vào Space hoạt động E2E; token dùng 1 lần; hết hạn báo lỗi | T1.4, T1.2 | 2 | 0.2.0 |
| T1.6 | Audit log: bảng, trigger `app.audit_*` cho spaces/members/invitations/settings, `app.actor_id`; trang audit (admin Space, super admin) có lọc, nhãn action dịch | migration `*_audit.sql`, `settings/audit` | Đổi vai trò tạo bản ghi `member.role_change` có from/to; UPDATE/DELETE audit bị từ chối với mọi role | T1.1 | 1 | 0.2.0 |
| T1.7 | Quản trị truy cập: bảng `access_allowlist` + RLS + pgTAP; trang `/admin/access` thêm/xoá **email** hoặc **domain** (nhập hàng loạt, validate, cảnh báo domain công cộng, hiển thị số user bị ảnh hưởng); danh sách người dùng (khoá/mở, cấp/gỡ super admin); nút gửi email thử; middleware đăng xuất user không còn trong allowlist | `supabase/migrations/*_access.sql`, `app/(app)/admin/*`, `apps/web/src/server/admin.ts` | Chỉ super admin truy cập được; thêm 1 email → người đó đăng nhập được ngay, người khác cùng domain vẫn bị chặn; thêm domain → cả domain vào được; gỡ → request kế tiếp bị đăng xuất với thông báo dịch; không tự gỡ được chính mình; audit `access.add/remove` | T1.2, T1.6 | 1 | 0.2.0 |

### M2 — Cây trang (→ `v0.3.0`) · ~6 ngày

| ID | Task | File/module | Tiêu chí hoàn thành | Phụ thuộc | Ước lượng | Version |
|---|---|---|---|---|---|---|
| T2.1 | Schema `pages` (+ `page_documents` rỗng qua trigger), fractional index, trigger cùng Space/chống vòng/xoá mềm nhánh, RLS qua `page_role`, audit create/move/delete/restore, pgTAP | migration `*_pages.sql` | Không tạo được vòng; không đặt cha khác Space; editor tạo được, viewer không; audit đầy đủ | T1.1, T1.6 | 1,5 | 0.3.0 |
| T2.2 | Server actions: tạo, đổi tên, di chuyển (cha + vị trí), xoá mềm, khôi phục, xoá vĩnh viễn; mã lỗi chuẩn | `apps/web/src/server/pages/*.ts` | Unit/integration test mỗi action; lỗi trả mã và được dịch | T2.1 | 1 | 0.3.0 |
| T2.3 | Sidebar tree: lazy load theo nhánh, nhớ trạng thái mở, kéo thả sắp xếp/lồng (dnd-kit), menu ngữ cảnh, breadcrumb | `components/tree/*` | Kéo thả 200 trang mượt; thứ tự giữ sau reload; bàn phím điều hướng được (a11y) | T2.2 | 2 | 0.3.0 |
| T2.4 | Route trang `/s/[space]/p/[slug-shortId]`, redirect khi slug đổi, tiêu đề + icon, thùng rác của Space | `app/(app)/s/[spaceSlug]/p/[pageRef]`, `trash` | Link cũ (slug cũ) vẫn vào đúng trang; khôi phục từ thùng rác trả về vị trí cũ | T2.2 | 1 | 0.3.0 |
| T2.5 | Realtime cây trang qua Supabase Realtime (`postgres_changes` trên `pages`, RLS áp dụng) | `components/tree/useTreeRealtime.ts` | Tab B thấy trang mới/di chuyển từ tab A trong < 2 s | T2.3 | 0,5 | 0.3.0 |

### M3 — Editor và lưu trữ Yjs (→ `v0.4.0`) · ~10,5 ngày

| ID | Task | File/module | Tiêu chí hoàn thành | Phụ thuộc | Ước lượng | Version |
|---|---|---|---|---|---|---|
| T3.1 | `packages/editor`: bộ extension TipTap dùng chung (StarterKit, heading, list, task list, code block + lowlight, blockquote, callout, divider, link, image, **UniqueID** cho block), `EDITOR_SCHEMA_VERSION`, cơ chế migrate nội dung | `packages/editor/src/extensions`, `schema-version.ts` | Import được ở cả browser và Node (không phụ thuộc DOM ở server); test snapshot schema | T0.1 | 1,5 | 0.4.0 |
| T3.2 | UI editor: slash menu, bubble menu định dạng, drag handle block, phím tắt, placeholder — mọi chuỗi qua i18n | `apps/web/src/components/editor/*` | Tất cả block tạo được qua `/`; UI đúng ngôn ngữ; lint không có literal | T3.1, T0.3 | 2 | 0.4.0 |
| T3.3 | `page_documents` đầy đủ + role DB `kb_collab` + grant/policy; bộ trích xuất JSON → text/headings/table/word count | migration `*_documents.sql`, `packages/editor/src/extract` | pgTAP: `authenticated` không đọc được `ydoc`; `kb_collab` không đọc được `profiles`; unit test trích xuất | T2.1, T3.1 | 1 | 0.4.0 |
| T3.4 | `kb-collab`: auth (JWT + `authorize_document` + origin + schema version), read-only viewer, Database extension fetch/store (merge, dẫn xuất, audit gộp), logger (pino), graceful shutdown, `/health` | `apps/collab/src/*` | Integration test: token sai bị từ chối; viewer gửi update bị bỏ qua; restart server không mất nội dung; SIGTERM flush dữ liệu | T3.3 | 2 | 0.4.0 |
| T3.5 | Tích hợp client: `HocuspocusProvider`, refresh token, trạng thái kết nối (đã lưu / đang lưu / mất kết nối), SSR read-only từ `content_json`, xử lý `CLIENT_OUTDATED` | `apps/web/src/lib/collab`, `components/editor/CollabEditor.tsx` | First paint không chờ WS; rút mạng → gõ tiếp → nối lại đồng bộ; indicator song ngữ | T3.4, T3.2 | 1,5 | 0.4.0 |
| T3.6 | Ảnh/tệp: bucket `attachments` + RLS storage, bảng `attachments`, upload (kéo thả, paste ảnh), chặn base64, giới hạn size/MIME, signed URL | migration `*_attachments.sql`, `components/editor/upload` | Viewer Space khác không tải được ảnh (403); ảnh paste lưu lên Storage không nhúng vào doc | T3.5 | 1,5 | 0.4.0 |
| T3.7 | Internal API collab `POST /internal/documents/:id/replace` (HMAC, chỉ mạng nội bộ) dùng `openDirectConnection`; client `kb-web` gọi API này | `apps/collab/src/internal-api.ts`, `apps/web/src/server/collab.ts` | Thay nội dung khi có 2 client đang mở → cả hai cập nhật; gọi từ Internet bị chặn | T3.4 | 1 | 0.4.0 |

### M4 — Table block (→ `v0.5.0`) · ~7,5 ngày

| ID | Task | File/module | Tiêu chí hoàn thành | Phụ thuộc | Ước lượng | Version |
|---|---|---|---|---|---|---|
| T4.1 | Bảng cơ bản: `@tiptap/extension-table` (+row/header/cell), chèn bảng qua slash, thêm/xoá hàng-cột, bật/tắt hàng/cột tiêu đề, kéo giãn độ rộng cột (lưu `colwidth`), toolbar/menu bảng i18n | `packages/editor/src/extensions/table`, `components/editor/table-menu` | Mọi thao tác có trong menu + phím tắt; độ rộng giữ sau reload và đồng bộ qua Yjs | T3.2 | 1,5 | 0.5.0 |
| T4.2 | Gộp/tách ô, màu nền ô (thuộc tính `backgroundColor`, bảng màu có token sáng/tối), chọn nhiều ô | `extensions/table/cell-attrs.ts` | Gộp vùng chọn chữ nhật, tách lại đúng; màu giữ khi copy/paste nội bộ | T4.1 | 1 | 0.5.0 |
| T4.3 | Kéo thả hàng và cột: plugin ProseMirror với handle ở mép hàng/cột, preview vị trí, xử lý ô gộp (chặn hoặc di chuyển cả khối), undo 1 bước | `packages/editor/src/table/drag.ts` | Kéo hàng/cột trong bảng 20×10 hoạt động; bảng có ô gộp không bị hỏng cấu trúc (test unit trên doc); hoạt động đồng thời 2 client | T4.2 | 2 | 0.5.0 |
| T4.4 | Paste từ Excel / Google Sheets / LibreOffice: parse HTML clipboard (`<table>`, `colspan/rowspan`, màu nền, bỏ style khác, xử lý `<google-sheets-html-origin>`, Excel `mso-*`), fallback TSV `text/plain`, paste vào bảng có sẵn ghi đè vùng ô từ ô đang chọn (mở rộng bảng nếu thiếu), chuẩn hoá NFC | `packages/editor/src/table/paste.ts`, `test/fixtures/clipboard/*` | Fixtures thật từ Excel (Win/Mac), Google Sheets, LibreOffice pass; 500 hàng paste < 1 s | T4.2 | 2 | 0.5.0 |
| T4.5 | Xuất CSV: menu bảng → tải `.csv` (RFC 4180, UTF-8 BOM để Excel đọc đúng tiếng Việt, ô gộp: giá trị ở ô gốc, ô còn lại rỗng, xuống dòng trong ô được quote), tên file từ tiêu đề trang (bỏ dấu) | `packages/editor/src/table/csv.ts` | Mở bằng Excel hiển thị đúng dấu; round-trip paste CSV → bảng giống nhau | T4.1 | 0,5 | 0.5.0 |
| T4.6 | Bảng + search/collab: trích xuất `table_text`, test hội tụ 2 client (thêm hàng + gộp ô đồng thời) | `extract/table.ts`, `apps/collab/test` | Nội dung ô tìm được (sau M5); test hội tụ pass | T4.3, T3.4 | 0,5 | 0.5.0 |

### M5 — Tìm kiếm tiếng Việt (→ `v0.6.0`) · ~5 ngày

| ID | Task | File/module | Tiêu chí hoàn thành | Phụ thuộc | Ước lượng | Version |
|---|---|---|---|---|---|---|
| T5.1 | `app.vn_unaccent`, cấu hình `vi_unaccent`, bảng `page_search` + trigger, index GIN/trigram, backfill | migration `*_search.sql` | "nghi phep" khớp "nghỉ phép"; chuỗi NFD khớp NFC; RLS trên `page_search` pass pgTAP | T3.3 | 1 | 0.6.0 |
| T5.2 | RPC `search_pages` (websearch + prefix, ranking §4.4, headline top N, `match_in`, lọc Space), Route Handler `/api/search` có rate limit | migration `*_search_rpc.sql`, `app/api/search` | Không trả trang ngoài quyền (test); có dấu đúng được xếp cao hơn; highlight đúng từ có dấu | T5.1 | 1,5 | 0.6.0 |
| T5.3 | UI: quick switcher ⌘/Ctrl+K (tiêu đề), trang kết quả đầy đủ (lọc Space, phân trang, snippet, nhãn "trong bảng"), trạng thái rỗng/lỗi song ngữ | `components/search/*`, `app/(app)/search` | Điều hướng hoàn toàn bằng bàn phím; kết quả < 300 ms (staging) | T5.2 | 1,5 | 0.6.0 |
| T5.4 | Golden set 30 truy vấn thực tế + seed 20k trang, benchmark, tinh chỉnh hệ số, ghi ADR | `scripts/seed-perf.ts`, `supabase/tests/search_quality`, `docs/adr/` | MRR ≥ 0,8; p95 < 300 ms; kết quả benchmark trong ADR | T5.2 | 1 | 0.6.0 |

### M6 — Lịch sử phiên bản và audit (→ `v0.7.0`) · ~4,5 ngày

| ID | Task | File/module | Tiêu chí hoàn thành | Phụ thuộc | Ước lượng | Version |
|---|---|---|---|---|---|---|
| T6.1 | `page_versions` + chính sách snapshot trong collab (auto 10 phút / client cuối rời / manual có nhãn), job dọn theo retention | migration `*_versions.sql`, `apps/collab/src/snapshots.ts` | Sửa 30 phút liên tục tạo ~3 bản auto; nút "Lưu phiên bản" tạo bản manual; retention job có test | T3.4 | 1 | 0.7.0 |
| T6.2 | UI lịch sử: danh sách (người, thời gian theo locale/múi giờ, loại), xem trước read-only, so sánh văn bản đơn giản (diff theo block) | `app/(app)/s/[spaceSlug]/p/[pageRef]/history` | Viewer xem được lịch sử; thời gian hiển thị `Asia/Ho_Chi_Minh` | T6.1 | 1,5 | 0.7.0 |
| T6.3 | Khôi phục: tạo `pre_restore` → thay nội dung qua internal API → bản `restore` (`restored_from_version_id`) → audit `version.restore`; client đang mở nhận nội dung mới + toast | `apps/web/src/server/versions.ts`, collab internal API | Khôi phục khi người khác đang mở: không mất dữ liệu (bản pre_restore có thể khôi phục ngược lại); viewer không khôi phục được | T6.1, T3.7 | 1 | 0.7.0 |
| T6.4 | Hoàn thiện audit UI: thêm action trang/phiên bản, lọc theo người/loại/thời gian, xuất CSV audit (admin) | `settings/audit` | Mọi thao tác trong danh sách §3.2 xuất hiện đúng; nhãn dịch đủ vi/en | T1.6, T6.3 | 1 | 0.7.0 |

### M7 — Hoàn thiện, pilot và ra mắt (→ `v0.8.0` ứng viên → **`v1.0.0` = MVP**) · ~8,5 ngày

| ID | Task | File/module | Tiêu chí hoàn thành | Phụ thuộc | Ước lượng | Version |
|---|---|---|---|---|---|---|
| T7.1 | Hoàn chỉnh E2E (danh sách §8) chạy cả vi/en, ma trận RLS đầy đủ, `e2e.yml` bắt buộc trên PR | `apps/web/e2e`, `supabase/tests` | E2E xanh ổn định 10 lần liên tiếp (không flaky) | M1–M6 | 2 | 0.8.0 |
| T7.2 | Bảo mật: CSP/headers, rate limit (search, mời), khoá Studio sau Cloudflare Access, `pnpm audit`, review secret, runbook xoay secret | `next.config.ts`, `docs/runbooks` | Checklist bảo mật hoàn tất; securityheaders ≥ A | T0.8 | 1 | 0.8.0 |
| T7.3 | Production: thêm `kb-prod-1` làm remote server trong Coolify, dựng môi trường prod (theo tài liệu staging), OAuth client prod, backup + restore thử trên prod, Uptime Kuma + alert, error tracking | `infra/coolify/production.md` | Release `v0.8.0` deploy qua pipeline có duyệt; restore thử thành công; alert test đến kênh đã chọn | T0.9, T7.2 | 1,5 | 0.8.0 |
| T7.4 | Tài liệu người dùng vi/en (bắt đầu, Space & quyền, editor & bảng, tìm kiếm, lịch sử), Space "Hướng dẫn" seed sẵn, nội dung What's new đầy đủ | `docs/user-guide/{vi,en}` | Script kiểm tra mỗi trang vi có bản en | M1–M6 | 1 | 0.8.0 |
| T7.5 | Pilot `0.8.x` trên production với 1–2 phòng ban, thu phản hồi, sửa lỗi (buffer) | – | Không còn bug mức nghiêm trọng; phản hồi ghi thành issue | T7.3 | 3 | 0.8.x |
| T7.6 | Phát hành **1.0.0**: checklist go-live (backup/restore thử trong 7 ngày qua, alert hoạt động, không bug P0/P1 mở, E2E xanh, tài liệu vi/en đủ, ghi chú phát hành vi/en), commit `Release-As: 1.0.0`, thông báo toàn công ty (song ngữ) | `changelog/vi/1.0.0.md`, `docs/runbooks/go-live.md` | Tag `v1.0.0`, app hiển thị `v1.0.0`, trang What's new có bài giới thiệu MVP | T7.5 | 0 (trong buffer) | **1.0.0** |

**Tổng: ~64 ngày công** (≈ 3 tháng lịch, đã gồm buffer ở T7.5). Đường găng: T0.1 → T0.4 → T1.1 → T2.1 → T3.3 → T3.4 → T4.x → T5.x → T6.x → T7.x.

---

## 10. Lộ trình V2/V3 và các quyết định cần làm sớm ở MVP

### 10.1 V2 (ước lượng ~5–6 tuần, phát hành dạng `1.x`)
- **Real-time nhiều người**: collab đã chạy từ MVP → thêm `@tiptap/extension-collaboration-caret` (cursor, tên, màu), danh sách người đang xem, `y-indexeddb` giữ bản offline; Redis extension nếu chạy >1 instance.
- **Comment & @mention**: bảng `comments` (thread, anchor = `block_id` + Yjs `RelativePosition` lưu trong mark của doc), `mentions`, `notifications` (in-app qua Supabase Realtime + email song ngữ theo `profiles.locale`, digest). RLS theo `page_role`.
- **Mẫu trang**: trang `is_template = true` trong Space hệ thống, có bản vi và en (`template_locale`); áp dụng = internal replace API (bản `template`). Mẫu mặc định: SOP, Meeting note, Postmortem (mỗi mẫu 2 ngôn ngữ).
- **Quyền theo trang** (nếu cần): bảng `page_permissions`, sửa `app.page_role()`.

### 10.2 V3 (phát hành dạng `1.x`)
- **Hỏi đáp AI (RAG có trích dẫn)** — đã được phép dùng API bên ngoài:
  - **Dữ liệu**: bảng `page_chunks(id, page_id, block_id, space_id, chunk_index, content, content_hash, embedding vector(1024), tsv, updated_at)`, chunk theo block (heading + các đoạn con, ~300–800 token); bảng chunk theo nhóm hàng, lặp lại hàng tiêu đề. Index HNSW (`vector_cosine_ops`) + GIN FTS. RLS giống `page_search`.
  - **Cập nhật**: `kb-collab` sau `store` ghi job vào bảng `jobs` (debounce 5 phút/trang); service `kb-worker` (tách riêng, cùng repo `apps/worker`) tính lại chunk thay đổi (so `content_hash`) → gọi embedding API → upsert. Chỉ xử lý Space có `ai_enabled = true` và khi `app_settings.ai_enabled`.
  - **Embedding**: **Voyage AI** (nhà cung cấp embedding Anthropic khuyến nghị, model đa ngữ — chọn model và số chiều khi bắt đầu V3, benchmark trên golden set tiếng Việt; phương án tự host `bge-m3` nếu muốn giảm phụ thuộc).
  - **Retrieval**: chạy bằng **JWT của người hỏi** (RLS) → không bao giờ lấy đoạn ngoài quyền. Hybrid = FTS tiếng Việt §4 + vector, gộp bằng Reciprocal Rank Fusion, lấy top ~20 chunk.
  - **Sinh câu trả lời**: **Claude API** qua SDK chính thức `@anthropic-ai/sdk`, model mặc định `claude-opus-5` (có thể hạ chi phí sau khi đo chất lượng), streaming, adaptive thinking. Các chunk được đưa vào dưới dạng `document` block với **Citations API bật** (`citations: {enabled: true}`) → câu trả lời có trích dẫn gắn đúng đoạn nguồn; UI map mỗi trích dẫn về link `…/p/<ref>#block-<id>`. System prompt cố định (song ngữ theo `profiles.locale`) được **prompt caching**. Xử lý `stop_reason: "refusal"` và bật fallback phía server.
  - **An toàn dữ liệu**: cờ `ai_enabled` theo Space (loại Space nhạy cảm) và toàn hệ thống; không gửi tệp đính kèm, chỉ text; audit `ai.query` (người hỏi, Space, số chunk — không lưu nguyên văn nếu chính sách yêu cầu); giới hạn chi phí theo ngày/người; ghi rõ trong tài liệu người dùng (vi/en) rằng nội dung được gửi tới Anthropic/Voyage; xem xét điều khoản xử lý dữ liệu (DPA) của nhà cung cấp.
- **Cảnh báo tài liệu cũ**: dùng `pages.owner_id`, `last_edited_at` (+ thêm `review_interval_days`, `verified_at`) → job hằng tuần gửi thông báo.
- **Import Notion/Google Docs**: chuyển HTML/Markdown → ProseMirror JSON bằng schema `packages/editor` (server-side với `happy-dom`) → internal replace API (reason `import`), ảnh tải lại lên Storage.
- **Bot Slack/Telegram**: bảng liên kết tài khoản (`external_identities`) để bot hỏi đáp **theo quyền người dùng**; không dùng service role để trả lời.
- **Public trang**: bảng `public_shares(page_id, token, expires_at, include_children)`; policy riêng cho `anon` chỉ qua RPC `get_public_page(token)`; route `/p/public/[token]` có `?lang=`.

### 10.3 Quyết định phải làm ngay ở MVP để không làm lại
1. **Yjs là nguồn sự thật + collab chạy từ đầu** → V2 real-time không cần migrate dữ liệu hay đổi đường lưu.
2. **Một đường ghi nội dung** (collab internal API) → restore, mẫu, import, AI chỉnh sửa (tương lai) đều tái dùng.
3. **`packages/editor` dùng chung + `EDITOR_SCHEMA_VERSION`** → import, RAG chunker, search dùng đúng schema.
4. **Block ID ổn định (UniqueID)** → anchor comment, deep link, trích dẫn RAG.
5. **Logic quyền tập trung ở `app.page_role()`** → quyền theo trang, public share, bot không phải viết lại policy.
6. **Audit bằng trigger + `app.actor_id`** → mọi đường ghi (web, collab, job) đều được ghi.
7. **Tách `table_text`/`headings_text`** → trọng số search và chunk RAG theo loại nội dung.
8. **`profiles.locale` + email/mẫu song ngữ ngay từ đầu** → thông báo V2 không phải bổ sung sau.
9. **Không `NEXT_PUBLIC_*` theo môi trường** → cùng image cho staging/prod, preview.
10. **Cột dự phòng rẻ**: `pages.owner_id`, `inherit_permissions`, `is_template`, `template_locale`, `profiles.last_seen_version` — thêm ngay, tránh migration dữ liệu lớn sau.
11. **Ảnh luôn ở Storage, không base64 trong doc** → Yjs nhỏ, import/export sạch.

---

## 11. Rủi ro và phương án xử lý

| # | Rủi ro | Mức | Phương án |
|---|---|---|---|
| R1 | Lệch schema editor giữa client và server → mất nội dung khi Yjs dẫn xuất | Cao | `packages/editor` dùng chung; kiểm tra `EDITOR_SCHEMA_VERSION` khi kết nối; test round-trip JSON ↔ Yjs; snapshot trước khi migrate nội dung |
| R2 | Kéo thả hàng/cột và paste Excel phức tạp hơn dự kiến (TipTap không có sẵn, **không dùng bản trả phí** → tự viết), ô gộp | Cao | Timebox 2 ngày mỗi phần; tham khảo mã nguồn mở `prosemirror-tables` (`CellSelection`, `TableMap`) và các dự án MIT; fixture thật từ nhiều nguồn; nếu vượt: MVP chặn kéo thả khi bảng có ô gộp, hoàn thiện ở 0.5.x |
| R3 | Sai sót RLS làm lộ dữ liệu giữa phòng ban | Cao | Helper tập trung; pgTAP ma trận bắt buộc; test "mọi bảng bật RLS"; review riêng cho migration có policy; không dùng service role cho đường đọc người dùng |
| R4 | Vận hành Supabase self-host (nhiều container, nâng cấp, GoTrue hook chưa hỗ trợ) | TB | Ghim version image; nâng cấp trên staging trước; spike T0.10; dự phòng trigger `auth.users`; runbook nâng cấp |
| R5 | WebSocket bị ngắt qua Cloudflare/Traefik, token hết hạn giữa phiên | TB | Ping 30 s, `readTimeout=0`, reconnect backoff, `sendToken` khi refresh, UI trạng thái; test ≥ 30 phút ở T0.10 |
| R6 | Chất lượng tìm kiếm tiếng Việt (từ ghép, viết tắt) | TB | Thưởng cụm từ, trigram tiêu đề, golden set, thesaurus viết tắt; V3 hybrid vector |
| R7 | Backup có nhưng không restore được | TB | Kiểm thử restore tự động hằng tháng + alert; backup trước mỗi migration prod |
| R8 | Preview dùng chung DB staging → PR có migration phá staging | TB | Expand-only, label `db:staging` có kiểm soát, test migration ở CI trên DB tạm; staging có thể reset từ seed |
| R9 | Quên ghi chú tiếng Việt / tiếng Việt chất lượng kém | Thấp | Check bắt buộc trên Release PR; PR template nhắc; glossary thuật ngữ |
| R10 | Một dev (bus factor, ước lượng lạc quan) | TB | Buffer 3 ngày; ADR + runbook đầy đủ; milestone có thể cắt phạm vi (T2.5, T6.2 diff, T4.3 ô gộp) |
| R11 | Coolify API/tính năng thay đổi giữa các phiên bản | Thấp | Ghim phiên bản Coolify; bọc lời gọi API trong 1 script; dự phòng webhook deploy của Coolify |
| R12 | Tài nguyên server không đủ (đặc biệt `kb-ops-1` khi nhiều preview) | TB | Giới hạn RAM từng container; preview tối đa 3 đồng thời; build ở GitHub Actions; prod tách server riêng (§7.0) |
| R14 | Admin gỡ nhầm domain/email → khoá nhiều người | TB | UI cảnh báo số người bị ảnh hưởng + xác nhận gõ lại tên domain; không cho gỡ domain của chính super admin đang thao tác; bootstrap email luôn đăng nhập được; audit before/after để khôi phục |
| R16 | Phụ thuộc tài khoản cá nhân (super admin Gmail, project Google Cloud cá nhân, App Password của một người) | TB | Cấp super admin cho ≥ 1 tài khoản công ty; thêm người thứ hai làm Owner của project Google Cloud; runbook thay App Password / chuyển sang Resend; lưu thông tin trong password manager của team |
| R17 | Công ty chặn ứng dụng OAuth bên thứ ba | TB | Kiểm tra ở T0.10; nhờ admin Workspace tin cậy Client ID (1 thao tác) |
| R15 | Rò rỉ nội dung nhạy cảm qua AI (V3) | TB | Retrieval theo RLS của người hỏi; cờ `ai_enabled` theo Space; không gửi tệp; audit; giới hạn chi phí |
| R13 | Yjs doc phình to (paste lớn, lịch sử) | Thấp | GC bật, chặn base64, cảnh báo > 5 MB, snapshot ở bảng riêng |

---

## 12. Câu hỏi mở

### 12.1 Đã quyết định
| Câu hỏi | Quyết định |
|---|---|
| Ai được đăng nhập | Super admin khai báo allowlist theo **email** (team nhỏ) hoặc **domain** (cả công ty) trong trang Quản trị (§3.2) |
| Super admin đầu tiên | `nguyenthanh.cv@gmail.com` (qua `BOOTSTRAP_SUPER_ADMIN_EMAILS`) |
| Version khi ra mắt MVP | **1.0.0** (sau pilot `0.8.x`) |
| Server | Hostinger VPS, 2 máy KVM 2 tách prod / ops-staging; data center gần VN nhất (§7.0) |
| Lưu trữ dữ liệu trong nước | Không bắt buộc |
| Backup (S3) | Cloudflare R2 (§7.8) |
| SMTP | Gmail SMTP + App Password của tài khoản Workspace (không cần admin); sau chuyển Resend trên `thanhgo.com` (§7.14) |
| Google OAuth | Project Google Cloud cá nhân, consent External, "In production", scope cơ bản (§7.15) |
| Space mới mặc định | `restricted` — chỉ thành viên |
| TipTap trả phí | Không — chỉ mã nguồn mở, tự viết phần thiếu (§2.1) |
| AI gửi nội dung ra ngoài | Có — Claude API + Voyage AI, có cờ tắt theo Space (§10.2) |

### 12.2 Còn mở (đều có đề xuất mặc định — plan dùng đề xuất nếu chưa có quyết định)
1. **Ai được tạo Space?** Đề xuất: mọi người nội bộ (không phải khách).
2. **Retention**: phiên bản trang (đề xuất: giữ hết manual, auto 30 ngày rồi thưa dần) và audit log (đề xuất 2 năm).
3. **Mục tiêu RPO/RTO**: đề xuất 24 h / 2 h ở MVP; PITR để V2.
4. **Error tracking**: đề xuất Sentry cloud gói miễn phí (không tốn RAM server); GlitchTip self-host nếu không muốn gửi lỗi ra ngoài.
5. **Đồng bộ Google Groups** → thành viên Space: đề xuất không làm (cần admin Workspace); quản lý thành viên trong app.
6. **Dữ liệu staging**: đề xuất chỉ dữ liệu giả (seed).
7. **Kênh cảnh báo vận hành**: đề xuất Telegram bot (dễ setup, không cần admin) hoặc email.
8. **Review trước khi merge**: đề xuất 1 dev tự merge khi CI xanh; bật bắt buộc review khi có người thứ hai.
9. **V3 AI — ngân sách** hằng tháng cho API và có lưu nguyên văn câu hỏi/trả lời không: quyết định khi bắt đầu V3.
