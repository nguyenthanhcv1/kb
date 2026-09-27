# ADR 0002 — Chặn đăng ký bằng hook `before_user_created` của GoTrue; Google OAuth client External của project cá nhân

- Trạng thái: **(a) Chấp nhận — đã xác minh local** trên GoTrue `v2.197.0`; **(e) Đề xuất — chờ xác minh** bằng một tài khoản công ty trên staging
- Ngày: 2026-09-27
- Liên quan: `docs/PLAN.md` §3.2, §7.6, §7.15, rủi ro R4, R16, R17 · T0.10 điểm (a), (e) · `supabase/migrations/20260925235533_auth_hooks.sql` · `supabase/config.toml` (`[auth.hook.before_user_created]`) · `apps/web/src/app/auth/callback/route.ts` · `docs/runbooks/staging.md` bước 6–7 · `docs/runbooks/spike-t0.10.md` §a, §e

## Bối cảnh

PLAN §3.2 quyết định ai được tạo tài khoản ở **Postgres**, bằng hook GoTrue `before_user_created` (hàm `app.before_user_created_hook`, T1.2a): email/domain trong `access_allowlist` hoặc có lời mời còn hạn → cho tạo; còn lại → `AUTH_NOT_ALLOWED`. Rủi ro R4: hook này mới có trong GoTrue, bản self-host (template Supabase của Coolify) có thể chưa hỗ trợ. Dự phòng trong PLAN: trigger `before insert on auth.users` raise exception.

Điểm (e): đăng nhập Google dùng **một OAuth client External** trong project Google Cloud cá nhân (`kb-auth`, tài khoản `nguyenthanh.cv@gmail.com`), không cần admin Workspace. Rủi ro R17: Workspace của công ty có thể chặn ứng dụng OAuth bên thứ ba chưa được cấu hình.

## Đã xác minh

### (a) Hook trên GoTrue — xác minh local (2026-09-27)

Môi trường: Supabase CLI `2.118.0` (bản CI dùng), image `public.ecr.aws/supabase/gotrue:v2.197.0`, Postgres `15.8.1.085`, toàn bộ migration trong repo, `config.toml` như trên `main`. Đăng ký bằng email/mật khẩu (chỉ bật ở local) để đi qua cùng đường tạo user với OAuth:

| Trường hợp                                                | Kết quả                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Email lạ (`stranger@evil.example`)                        | HTTP **403** `{"code":403,"error_code":"unknown","msg":"AUTH_NOT_ALLOWED"}`, không có dòng `auth.users` |
| Domain trong `access_allowlist` (`alice@company.example`) | HTTP 200; `profiles.is_guest = false`                                                                   |
| Có lời mời còn hạn (`guest@partner.example`)              | HTTP 200; `profiles.is_guest = true`                                                                    |
| Lời mời đã hết hạn                                        | HTTP 403 `AUTH_NOT_ALLOWED`                                                                             |

Log GoTrue ghi mỗi lần gọi hook (`"action":"run_hook"`, `"hook":"pg-functions://postgres/app/before_user_created_hook"`, `"msg":"Hook ran successfully"` / `"Hook errored out"`, `"error":"403: AUTH_NOT_ALLOWED"`), thời gian ~35–60 ms. Lệnh lặp lại: `docs/runbooks/spike-t0.10.md` §a.

### (a') Luồng Google OAuth — đọc mã nguồn GoTrue `v2.197.0`

`internal/api/external.go`: với OAuth, hook chạy trong **`/auth/v1/callback` của GoTrue** (`triggerBeforeUserCreatedExternal`, trước `createAccountFromExternalIdentity`), tức là **trước** khi có mã PKCE. Khi hook từ chối, `redirectErrors` chuyển hướng trình duyệt về `redirect_to` (`/auth/callback?next=…` của `kb-web`) với query `error=access_denied&error_code=unknown&error_description=AUTH_NOT_ALLOWED` (HTTP 403 → `access_denied` theo `oauthErrorMap`) (và lặp lại trong fragment), **không có `code`**.

→ Route `apps/web/src/app/auth/callback/route.ts` hiện chỉ xử lý lỗi của `exchangeCodeForSession`; thiếu `code` thì luôn trả `AUTH_CALLBACK_FAILED`. Người bị từ chối qua Google sẽ thấy lỗi chung thay vì trang `/access-denied`. Cần sửa ở PR riêng (xem Hệ quả) — test local bằng email/mật khẩu ở trên không đi qua nhánh này.

## Quyết định

1. **Dùng hook `before_user_created` (pg-function)** như T1.2a đã làm; URI `pg-functions://postgres/app/before_user_created_hook`. Không dùng trigger `auth.users` khi hook chạy được.
2. **GoTrue staging/production phải ≥ `v2.197.0`** (bản đã xác minh, cũng là bản của Supabase CLI trong CI). Nếu template Coolify ghim bản cũ hơn, sửa tag image `supabase-auth` trong compose của service Supabase về `v2.197.0` (không tự nâng lên bản mới hơn khi chưa test lại trên local).
3. Hook **chỉ bật sau khi migration tạo hàm** (runbook staging bước 10). Hook chỉ chạy khi _tạo_ user: người đã có tài khoản không bị ảnh hưởng nếu hook lỗi; việc thu hồi quyền của người đã có tài khoản do middleware (`app.has_active_access()`) đảm nhận.
4. **(e) Google OAuth**: một project `kb-auth` (tài khoản cá nhân), consent screen **External**, **In production**, scope chỉ `openid email profile`; mỗi môi trường một Web client, redirect URI là callback của GoTrue (`https://kb-staging-api.thanhgo.com/auth/v1/callback`, `https://kb-api.thanhgo.com/auth/v1/callback`). Preview dùng chung client staging (redirect về GoTrue staging, rồi GoTrue về `kb-pr-<n>` nhờ `GOTRUE_URI_ALLOW_LIST`). Ai được vào do `access_allowlist` quyết định, không do Google.
5. Cấp thêm **Owner thứ hai** (tài khoản công ty) cho project `kb-auth` và super admin thứ hai trong app (R16).

## Phương án dự phòng

- **Hook không chạy trên GoTrue self-host** (log không có `run_hook`, hoặc GoTrue không khởi động với biến `GOTRUE_HOOK_BEFORE_USER_CREATED_*`): (1) nâng image `supabase-auth` lên `v2.197.0`; (2) nếu vẫn không được — migration mới tạo trigger `before insert on auth.users` gọi cùng logic và `raise exception 'AUTH_NOT_ALLOWED'`. Đánh đổi: GoTrue trả **500** `Database error saving new user` (mất mã lỗi) → callback phải coi mọi lỗi tạo user là `AUTH_NOT_ALLOWED` sau khi kiểm tra allowlist phía server; và trigger cũng chặn luôn `auth.admin.createUser` của service_role (cần ngoại lệ cho luồng mời nếu có).
- **Workspace công ty chặn app** (lỗi Google `admin_policy_enforced` / "Access blocked: … has not been configured / is blocked by your admin"): nhờ admin Workspace vào Admin console › Security › Access and data control › **API controls › Manage third-party app access** › thêm OAuth Client ID của KB với trạng thái **Trusted** (hoặc "Limited" đủ cho Sign in with Google) — một thao tác. Trong lúc chờ: người đó dùng Gmail cá nhân, thêm vào allowlist theo `email` hoặc mời như khách.
- **Google yêu cầu xác minh app** (màn hình "Google hasn't verified this app"): chỉ xảy ra khi thêm scope nhạy cảm hoặc logo. Giữ ba scope cơ bản; nếu vẫn bị, để trạng thái Testing và thêm tối đa 100 test user tạm thời.

## Hệ quả

- Việc cần làm sau (không thuộc PR này): **sửa `apps/web/src/app/auth/callback/route.ts`** để khi không có `code` mà có `error_description` thì map qua `mapAuthCallbackError(error_description)` → `AUTH_NOT_ALLOWED` hiển thị đúng `/access-denied`; thêm test cho nhánh này (task T1.2a follow-up hoặc T1.2b).
- `error_code` của lỗi hook là `unknown` (GoTrue không có mã riêng) — client chỉ dựa vào `msg`/`error_description` = `AUTH_NOT_ALLOWED`, như `mapAuthCallbackError` đang làm.
- Hook chạy trong transaction yêu cầu đăng nhập, mỗi lần tạo user ~35–60 ms — không đáng kể.
- Phụ thuộc tài khoản cá nhân cho OAuth (R16) được giảm bằng Owner thứ hai; Client ID/Secret lưu password manager.

## Cách xác minh

- (a) local: `docs/runbooks/spike-t0.10.md` §a (script `curl` + `psql`, ~2 phút). Staging: đăng nhập Google bằng một tài khoản **không** có trong allowlist → phải thấy lỗi `AUTH_NOT_ALLOWED` (sau khi sửa callback: trang `/access-denied`), `docker logs <supabase-auth>` có `run_hook … Hook errored out`, và không có dòng mới trong `auth.users`.
- (e) staging: runbook §e — một tài khoản công ty (domain đã thêm vào `access_allowlist`) đăng nhập được, `profiles.is_guest = false`. Ghi kết quả (thành công / thông báo lỗi Google chính xác) vào mục "Kết quả trên staging" dưới đây và đổi trạng thái (e) thành **Chấp nhận**.

## Kết quả trên staging

_(người điền sau khi chạy runbook: ngày, bản GoTrue `docker inspect`, kết quả từng bước)_
