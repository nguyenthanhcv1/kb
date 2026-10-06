# Runbook — Bảo mật: header, rate limit, Studio, dependency, xoay secret

> Task **T7.2**. Agent đã làm phần code (header/CSP, rate limit trong DB, workflow `Security`); **người** làm các bước có đánh dấu `[ ]` trên Cloudflare, Coolify, GitHub.
> Liên quan: [`staging.md`](staging.md) (bảng secret §8), [`backup-restore.md`](backup-restore.md), `docs/PLAN.md` §7.
> Không bao giờ dán secret vào issue, PR, chat hay commit. Mọi secret nằm trong **password manager của team** + Coolify (locked) + GitHub Environment.

## 1. HTTP header

| Header                                                                                                                       | Nơi đặt                                                       | Giá trị                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP | `apps/web/next.config.ts` → mọi response (trang, API, static) | `apps/web/src/lib/security-headers.ts` (`STATIC_SECURITY_HEADERS`)               |
| `Content-Security-Policy`                                                                                                    | `apps/web/src/middleware.ts` → mọi trang                      | `contentSecurityPolicy()` — dựng lúc chạy từ `SUPABASE_URL`, `COLLAB_PUBLIC_URL` |

CSP cho phép: chính app (`'self'`), Supabase (HTTPS + WSS cho Realtime, ảnh Storage), collab (`COLLAB_PUBLIC_URL`), form đăng nhập chuyển qua Supabase Auth → `accounts.google.com`. Cấm: nhúng trong iframe (`frame-ancestors 'none'`), plugin (`object-src 'none'`), đổi `<base>`. Còn `'unsafe-inline'` cho script/style (payload RSC của Next, script chống nháy của next-themes, style inline của TipTap/Radix) — muốn bỏ phải chuyển sang nonce (ghi nhận, chưa làm). `upgrade-insecure-requests` chỉ bật khi `APP_ENV` là preview/staging/production.

Thêm một dịch vụ bên ngoài mà trình duyệt gọi trực tiếp (vd CDN ảnh) → thêm origin trong `contentSecurityPolicy()` + test, không nới `default-src`.

Kiểm tra sau mỗi lần đổi header (và trước release):

1. [ ] <https://securityheaders.com/?q=https://kb-staging.thanhgo.com&followRedirects=on> → **A** trở lên (A+ cần bỏ `'unsafe-inline'`).
2. [ ] Mở app, DevTools › Console: không có lỗi `Refused to … Content Security Policy` khi đăng nhập, mở trang, sửa cùng lúc (WebSocket collab), tải ảnh.
3. Cloudflare: **không** bật "Automatic HTTPS Rewrites"/"Rocket Loader" (Rocket Loader chèn script lạ, bị CSP chặn). SSL/TLS › Edge Certificates: "Always Use HTTPS" bật, "Minimum TLS" 1.2.

## 2. Rate limit

Bộ đếm nằm trong Postgres (`app.rate_limit_hits`, cửa sổ cố định theo người dùng), không trong bộ nhớ kb-web — đúng khi có nhiều instance/restart, và chặn ở tầng bảng dù ghi qua đường nào. Vượt ngưỡng → lỗi `RATE_LIMITED` (SQLSTATE `P0001`, `HINT` = số giây đến khi mở lại) → client hiển thị `errors.RATE_LIMITED`.

| Bucket            | Ngưỡng           | Áp dụng                                                            |
| ----------------- | ---------------- | ------------------------------------------------------------------ |
| `invitation.send` | 30 / giờ / người | trigger trên `invitations`: tạo lời mời và gửi lại (đổi token)     |
| `search`          | do T5.2 đặt      | RPC tìm kiếm gọi `app.consume_rate_limit('search', <n>, <cửa sổ>)` |

- Thêm giới hạn mới: gọi `perform app.consume_rate_limit('<bucket>', <n>, interval '<cửa sổ>')` trong hàm/trigger `SECURITY DEFINER` của thao tác đó, kèm test pgTAP (`supabase/tests/rate_limits.test.sql`).
- Bộ đếm tự dọn: mỗi lần tính, các cửa sổ đã hết hạn của cùng người + bucket bị xoá (không cần job định kỳ).
- Mở khoá tay cho một người (hiếm): `delete from app.rate_limit_hits where subject = '<user id>' and bucket = '<bucket>';` (role `postgres`).
- Lớp ngoài: Supabase Auth có rate limit riêng cho đăng nhập (`supabase/config.toml` `[auth.rate_limit]`); Cloudflare chặn DDoS/bot.
- [ ] Cloudflare › Security › WAF › Rate limiting rules (gói Free có 1 rule): `kb-staging.thanhgo.com` và (sau T7.3) domain prod, đường dẫn bắt đầu `/auth/` hoặc `/login`, **100 request / 10 giây / IP** → Block 10 giây. IP thật của người dùng: Traefik chỉ nhận kết nối từ dải Cloudflare (`infra/scripts/firewall-cloudflare.sh`), header `CF-Connecting-IP` tin được.

## 3. Dependency

- Workflow **Security** (`.github/workflows/security.yml`): `pnpm audit --audit-level high` khi PR đổi dependency, khi merge `main` và mỗi thứ Hai. Không nằm trong check bắt buộc `ci` (một advisory mới không chặn PR không liên quan).
- Workflow tuần đỏ → người điều phối tạo task sửa (thêm vào `docs/ai/tasks.yaml`): nâng version (`pnpm up --filter <pkg> <dep>`), hoặc `pnpm.overrides` trong `package.json` gốc khi dependency bắc cầu chưa có bản vá; ghi lý do trong PR. Mức low/moderate: xem xét khi nâng cấp định kỳ.
- Chỉ khi advisory **chưa có bản vá nào** (cả nâng version lẫn override đều không gỡ được) **và** chỉ nằm trong dependency dev: thêm GHSA vào `auditConfig.ignoreGhsas` trong `pnpm-workspace.yaml`, kèm comment ghi đường dẫn dependency. Mỗi lần nâng cấp định kỳ thì gỡ thử từng mục. Đang bỏ qua:
  - `GHSA-vfj7-8cjw-p6xm` — `braces` ≤3.0.3 (DoS khi gặp pattern lồng sâu). Phiên bản 3.0.3 mới nhất vẫn bị ảnh hưởng. Đường dẫn: `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob@3.3.1` → `micromatch` → `braces`. Gói chỉ chạy lúc lint, pattern lấy từ config trong repo, không có trong image runtime. Gỡ mục này khi `braces` có bản vá hoặc `@next/eslint-plugin-next` bỏ `fast-glob`.
- License vẫn do job `licenses` trong `ci` kiểm tra (AGENTS.md §5).

## 4. Supabase Studio sau Cloudflare Access (`kb-studio`)

Hiện Studio không có domain (chỉ qua SSH tunnel, `staging.md` bước 5). Khi cần truy cập qua trình duyệt:

1. [ ] Cloudflare › DNS: `kb-studio` (A, proxied) → IP `kb-ops-1` (cùng kiểu các bản ghi khác).
2. [ ] Zero Trust › Access › Applications › Add › Self-hosted: tên `kb-studio`, domain `kb-studio.thanhgo.com`, session 8 giờ. Policy **Allow**: Include › Emails = danh sách quản trị (Google login, như `kb-coolify`). **Không** tạo policy Service Auth (không máy nào cần Studio).
3. [ ] Coolify › Supabase (kb-staging) › service `supabase-studio` › Domain `https://kb-studio.thanhgo.com:3000` → Redeploy. Studio vẫn có basic auth (`SERVICE_USER_ADMIN`/`SERVICE_PASSWORD_ADMIN`) phía sau Access.
4. [ ] Kiểm tra: cửa sổ ẩn danh mở `https://kb-studio.thanhgo.com` → màn hình đăng nhập Access (không thấy Studio); `curl -sI https://kb-studio.thanhgo.com` → `302` về `*.cloudflareaccess.com`.
5. Production (T7.3) làm tương tự với `kb-prod-studio`, policy riêng.

## 5. Rà soát secret (checklist trước release)

- [ ] `git log -p | grep -iE 'secret|password|token|BEGIN .*PRIVATE'` chỉ ra placeholder; GitHub › Settings › Code security: **Secret scanning** + **Push protection** bật.
- [ ] Không có `NEXT_PUBLIC_*` chứa secret (web đọc env lúc chạy, `apps/web/src/lib/env.ts`); `SUPABASE_SERVICE_ROLE_KEY` chỉ được đọc ở server (`apps/web/src/lib/env.ts`, `lib/supabase/env.ts`) và chỉ dùng qua `lib/supabase/admin.ts` — không file `"use client"` nào import chúng.
- [ ] Coolify: mọi biến secret đánh dấu **Is Literal** + **locked**; không bật "Show in build logs".
- [ ] GitHub: secret deploy nằm trong Environment (`staging`, `production` có reviewer), không phải repo secret.
- [ ] Postgres: `kb_collab` `NOBYPASSRLS`, chỉ nối từ mạng Docker nội bộ; cổng 5432 không public (`ss -tlnp` trên server).
- [ ] Log (Coolify, collab `LOG_LEVEL=info`) không in token/JWT/cookie.
- [ ] Kết nối MCP (`/api/mcp`): `SUPABASE_JWT_SECRET` chỉ đọc ở server (`apps/web/src/server/mcp/user-client.ts`); DB chỉ lưu sha256 của token (`mcp_tokens`). Lộ token của một người → người đó (hoặc super admin bằng SQL `update mcp_connections set revoked_at = now() where user_id = …`) thu hồi; mọi kết nối/thu hồi có trong audit log (`mcp.connect`, `mcp.revoke`).

## 6. Xoay secret

Nguyên tắc: tạo giá trị mới → cập nhật **mọi nơi** dùng nó (bảng `staging.md` §8) → redeploy → kiểm tra → thu hồi giá trị cũ → ghi ngày xoay vào password manager. Xoay ngay khi nghi lộ (máy mất, người rời nhóm, secret dán nhầm); định kỳ: theo cột "Chu kỳ".

| Secret                                            | Chu kỳ                   | Cách xoay                                                                                                                                                                                                                                                                                                                                                                                                       | Ảnh hưởng                                                                 |
| ------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `COLLAB_INTERNAL_SECRET`                          | 12 tháng                 | `openssl rand -hex 32` → Coolify › kb-staging (một biến dùng chung web + collab) → Redeploy cả resource                                                                                                                                                                                                                                                                                                         | Vài giây lỗi API nội bộ trong lúc hai container khởi động lại             |
| Mật khẩu `kb_collab`                              | 12 tháng                 | `openssl rand -hex 24` → `alter role kb_collab password '<mới>';` (psql role `postgres`, qua SSH) → sửa `COLLAB_DATABASE_URL` → Redeploy                                                                                                                                                                                                                                                                        | Collab mất kết nối DB tới khi redeploy xong (client tự nối lại)           |
| JWT secret Supabase (`SERVICE_PASSWORD_JWT`)      | khi lộ                   | Sinh JWT secret mới (≥ 32 ký tự) → sinh lại **anon key** và **service role key** ký bằng secret mới (<https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys>) → Coolify › Supabase: `SERVICE_PASSWORD_JWT`, `SERVICE_SUPABASEANON_KEY`, `SERVICE_SUPABASESERVICE_KEY` → kb-staging: `SUPABASE_JWT_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` → Redeploy Supabase rồi kb-staging | **Mọi người bị đăng xuất**; báo trước. Làm ngoài giờ.                     |
| Service role key                                  | khi lộ                   | Chỉ xoay được cùng JWT secret (dòng trên)                                                                                                                                                                                                                                                                                                                                                                       | như trên                                                                  |
| Mật khẩu `postgres` (`SERVICE_PASSWORD_POSTGRES`) | khi lộ                   | `alter role postgres password '<mới>';` → Coolify › Supabase `SERVICE_PASSWORD_POSTGRES` → kb-staging `MIGRATE_DATABASE_URL` → kb-backup `DATABASE_URL` → Redeploy                                                                                                                                                                                                                                              | Supabase service nối lại DB; kiểm tra backup đêm đó (`backup-restore.md`) |
| Google OAuth client secret                        | 12 tháng                 | Google Cloud › Clients › `kb-staging` › **Add secret** → Coolify › Supabase `GOOGLE_CLIENT_SECRET` → Redeploy → đăng nhập thử → **Disable/Delete** secret cũ                                                                                                                                                                                                                                                    | Không (hai secret song song trong lúc chuyển)                             |
| SMTP (Gmail App Password)                         | 12 tháng                 | Google Account › App passwords › tạo mới → `SMTP_PASSWORD` → Redeploy → gửi email thử (Admin › Cài đặt) → xoá app password cũ                                                                                                                                                                                                                                                                                   | Không                                                                     |
| Coolify API token                                 | 6 tháng                  | Coolify › Keys & Tokens › tạo token mới (quyền như cũ) → GitHub Environment `staging` `COOLIFY_API_TOKEN` → chạy lại workflow Deploy → xoá token cũ                                                                                                                                                                                                                                                             | Không                                                                     |
| Cloudflare Access service token                   | 12 tháng                 | Zero Trust › Service Tokens › **Refresh** (hoặc tạo mới + thêm vào policy) → `CF_ACCESS_CLIENT_ID/SECRET` trên GitHub → chạy Deploy → xoá token cũ                                                                                                                                                                                                                                                              | Không                                                                     |
| Khoá `age` backup, token R2                       | theo `backup-restore.md` | `backup-restore.md` (khoá cũ **giữ lại** để giải mã bản backup cũ)                                                                                                                                                                                                                                                                                                                                              | Không                                                                     |
| PAT `read:packages` trên server                   | 12 tháng                 | GitHub › Developer settings › token mới → `docker login ghcr.io` trên server → xoá token cũ                                                                                                                                                                                                                                                                                                                     | Không                                                                     |

Sau khi xoay: [ ] smoke test (`/api/health`, đăng nhập, mở/sửa trang, gửi lời mời) · [ ] ghi ngày + người xoay vào password manager.
