# ADR 0004 — Preview theo PR: Application Coolify riêng cho `kb-web`, DNS `kb-pr-<n>` bằng workflow Cloudflare API

- Trạng thái: **Đề xuất — chờ xác minh trên staging** (không có quyền Coolify/Cloudflare từ môi trường agent; kết luận dựa trên tài liệu, cấu hình trong repo và ADR 0001)
- Ngày: 2026-09-27
- Liên quan: `docs/PLAN.md` §7.3, §7.4 (`kb-web-preview`), §7.12, §7.13 (`preview-dns.yml`), rủi ro R12 · T0.10 điểm (d) · ADR 0001 · `infra/coolify/staging/docker-compose.yml` · `docs/runbooks/spike-t0.10.md` §d

## Bối cảnh

PLAN §7.12: mỗi PR có `https://kb-pr-<n>.thanhgo.com` (chỉ `kb-web`), dùng chung Supabase staging và `kb-staging-collab`; Coolify Preview Deployments + GitHub App; DNS tạo/xoá bằng `preview-dns.yml` (tránh wildcard DNS). Tối đa 2 preview cùng lúc trên `kb-ops-1` (8 GB).

Sau ADR 0001 (staging là **một resource Docker Compose** dùng image GHCR), cần chốt preview chạy thế nào mà không phá mô hình đó, và những gì đã sẵn sàng/chưa.

## Đã kiểm tra trong repo (local)

| Điều kiện cho preview                            | Trạng thái                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| TLS cho `kb-pr-<n>.thanhgo.com`                  | Có: Origin CA `*.thanhgo.com` là default cert của Traefik (ADR 0001); Universal SSL của Cloudflare phủ subdomain một cấp  |
| Collab chấp nhận origin preview                  | Có: `ALLOWED_ORIGINS` mặc định `https://kb-staging.thanhgo.com,https://kb-pr-*.thanhgo.com` (`*` = `[a-z0-9-]+`, có test) |
| GoTrue redirect về preview                       | Có trong runbook: `GOTRUE_URI_ALLOW_LIST=…,https://kb-pr-*.thanhgo.com/**` (glob của GoTrue: `*` không vượt qua `.`)      |
| Google OAuth                                     | Không cần thêm redirect URI: Google luôn quay về callback GoTrue staging (ADR 0002)                                       |
| Image không phụ thuộc môi trường                 | Có: không có `NEXT_PUBLIC_*` theo môi trường (PLAN §11.9) → cùng image cho staging/preview                                |
| `APP_ENV=preview`                                | Có trong schema env (`@kb/shared/env`, bắt buộc biến như staging)                                                         |
| Build image theo PR                              | **Chưa**: `build-images.yml` chỉ build ở `main`/release                                                                   |
| `preview-dns.yml`, secret `CLOUDFLARE_API_TOKEN` | **Chưa có**                                                                                                               |

## Quyết định

1. **Preview là Application Coolify riêng `kb-web-preview`** (không dùng resource compose `kb-staging` — Preview Deployments của Coolify cho build pack Docker Compose tạo lại **cả** migrate/collab/web cho mỗi PR, tốn RAM và chạy migration của PR lên DB staging). Nguồn: GitHub App của Coolify, repo `kb`, nhánh `main`, build pack **Dockerfile** (`apps/web/Dockerfile`, context `/`), bật **Preview Deployments**, URL template `https://kb-pr-{{pr_id}}.thanhgo.com`, Watch Paths `apps/web/**`, `packages/**`, `pnpm-lock.yaml`.
   - Build ở server là **đánh đổi đã biết**: `next build` cần ~2–3 GB RAM → đặt giới hạn build song song = 1 (Coolify › Server › Concurrent builds) và RAM container preview 512 MB (PLAN §7.4).
2. **Env preview** (tab Preview Environment Variables của Coolify): như `kb-web` staging, `APP_ENV=preview`, `APP_URL` = URL preview (bắt buộc khi `APP_ENV` là preview — `apps/web/src/lib/env.ts`; hiện chỉ được kiểm tra, callback OAuth dùng origin của request. Coolify có biến tự sinh `COOLIFY_URL`/`COOLIFY_FQDN` cho từng preview — kiểm tra ở runbook §d có dùng được dạng `APP_URL=$COOLIFY_URL` không; nếu không, đặt một giá trị chung `https://kb-pr.thanhgo.com` tới khi code cần URL chính xác), `COLLAB_PUBLIC_URL=wss://kb-staging-collab.thanhgo.com`, `COLLAB_INTERNAL_URL=http://kb-collab:3001` (mạng `coolify`), không đặt `BOOTSTRAP_SUPER_ADMIN_EMAILS`.
3. **DNS bằng workflow `preview-dns.yml`** (làm ở PR riêng sau khi runbook §d xác nhận): `pull_request` `opened|reopened|synchronize` → upsert bản ghi **A proxied** `kb-pr-<n>` trỏ IP `kb-ops-1`; `closed` → xoá. Token Cloudflare **chỉ** quyền `Zone › DNS › Edit` cho zone `thanhgo.com`, lưu ở GitHub Environment `preview`. Repo private, không nhận PR từ fork → `pull_request` đủ (không dùng `pull_request_target`). Không cần đổi firewall (Cloudflare → 443 như staging).
4. **Router**: Coolify tự sinh router Traefik cho domain preview với `tls=true` và **không** cert resolver khi URL `https://` và proxy đã có default cert — cần xác nhận preview trả cert Origin CA (runbook §d). Nếu Coolify gắn `certresolver=letsencrypt`, ACME HTTP-01 sẽ thất bại sau Cloudflare → tắt "Generate SSL" / dùng label tuỳ biến.
5. **Migration trên preview**: như PLAN §7.12 — PR có migration phải expand-only; label `db:staging` mới áp lên staging (workflow sau). Preview không bao giờ tự chạy `kb-migrate`.

## Phương án dự phòng

- **Coolify Preview Deployments không dùng được** (lỗi build, hết RAM, router sai): GitHub Actions build image `kb-web:pr-<n>` lên GHCR (thêm job PR vào `build-images.yml`), rồi workflow gọi API Coolify tạo/cập nhật **một** Application "Docker Image" `kb-web-pr-<n>` (domain `kb-pr-<n>`), xoá khi PR đóng. Không build trên server; tốn thêm công viết workflow (~0,5 ngày).
- **DNS theo PR phiền/thiếu quyền token**: một bản ghi **wildcard proxied** `*.thanhgo.com` → `kb-ops-1` (Cloudflare Free hỗ trợ proxied wildcard). Host không có router nhận 404 của Traefik. Đánh đổi: mọi subdomain chưa khai báo đều trỏ vào máy staging (PLAN muốn tránh) — chấp nhận tạm, gỡ khi có workflow.
- **RAM không đủ cho preview**: tối đa 1 preview, hoặc chỉ tạo preview khi PR có label `preview` (Coolify: "Preview deployments only for labelled PRs" nếu bản đang cài hỗ trợ; nếu không, dự phòng bằng workflow ở trên).

## Hệ quả

- Staging giữ mô hình ADR 0001; preview là resource độc lập, lỗi preview không ảnh hưởng staging (trừ tài nguyên máy — R12).
- Cần thêm: GitHub Environment `preview` + secret `CLOUDFLARE_API_TOKEN`, biến `PREVIEW_ORIGIN_IP` (IP `kb-ops-1`, không phải secret), workflow `preview-dns.yml`, (dự phòng) job build image PR.
- Preview dùng chung dữ liệu staging: người review đăng nhập bằng tài khoản staging; không có dữ liệu riêng cho PR.

## Cách xác minh

`docs/runbooks/spike-t0.10.md` §d: tạo `kb-web-preview`, mở một PR thử (chỉ sửa README), tạo DNS tay bằng `curl` Cloudflare API (đúng lệnh workflow sẽ chạy), kiểm tra `https://kb-pr-<n>.thanhgo.com/api/health` trả `env: "preview"`, đăng nhập Google trên preview, editor nối được `wss://kb-staging-collab…` (origin được chấp nhận), đóng PR → Coolify xoá container, xoá DNS. Ghi kết quả vào mục dưới, đổi trạng thái thành **Chấp nhận** (hoặc ghi phương án dự phòng đã chọn).

## Kết quả trên staging

_(người điền)_
