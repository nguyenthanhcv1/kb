# ADR 0001 — Staging trên Coolify: một resource Docker Compose, migrate trong compose, TLS Origin CA

- Trạng thái: **Đề xuất** (T0.8) — chốt khi người điều phối merge PR T0.8 và deploy staging đầu tiên thành công
- Ngày: 2026-09-26
- Cập nhật 2026-10-06: môi trường này là **production duy nhất** (`kb.thanhgo.com`), không còn staging riêng — ADR 0007. Mô hình compose giữ nguyên.
- Liên quan: `docs/PLAN.md` §6.5, §7.3, §7.4, §7.5, §7.6 · `docs/runbooks/staging.md` · `infra/coolify/**` · `.github/workflows/deploy.yml`

## Bối cảnh

PLAN §7.4–§7.5 phác thảo: `kb-web`, `kb-collab` là hai Application "Docker Image" riêng trong Coolify; GitHub Actions đổi `docker_registry_image_tag` từng app qua API rồi deploy; migration chạy bằng **SSH qua Cloudflare Tunnel** vào host (`docker run --rm kb-migrate`). PLAN cũng ghi "spike T0.8 xác nhận" chi tiết API.

Khi chuẩn bị T0.8, có ba vấn đề với phác thảo đó:

1. **Rule Traefik chặn `/internal/*`** (yêu cầu của T3.7): với Application, Coolify tự sinh label Traefik từ ô "Domains"; muốn rule tuỳ biến phải sửa tay label trong UI → không nằm trong git, không review được, dễ mất khi ai đó sửa domain.
2. **Migration qua SSH**: runner GitHub có IP thay đổi, trong khi SSH chỉ mở cho IP quản trị (§7.0) → phải dựng Cloudflare Tunnel + Access cho SSH, thêm `DEPLOY_SSH_KEY`, `CF_TUNNEL_*`. Nhiều bước người làm, thêm một đường vào máy chủ.
3. **Thứ tự migrate → collab → web** phải do workflow điều phối qua nhiều lời gọi API.

## Quyết định

1. **Một resource Coolify kiểu "Docker Compose"** (build pack Docker Compose, nguồn = repo `kb` qua GitHub App, nhánh `main`, file `infra/coolify/staging/docker-compose.yml`) chứa `kb-migrate`, `kb-collab`, `kb-web`. Image lấy từ GHCR (`build-images.yml`), **không build trên server**. Tag image là biến `KB_IMAGE_TAG` của resource.
2. **Thứ tự bằng `depends_on`**: `kb-migrate` (one-shot, `service_completed_successfully`) → `kb-collab` (`service_healthy`) → `kb-web`. Migration chạy **trong mạng Docker nội bộ**, không cần SSH từ GitHub.
3. **Routing bằng label Traefik trong file compose** (ô Domains trong Coolify để trống): router public của `kb-collab` chỉ khớp `Path(/)` (WebSocket) và `Path(/health)`; mọi đường dẫn khác, gồm `/internal/*`, nhận 404 của Traefik. `kb-web` gọi `http://kb-collab:3001` qua alias mạng `coolify`. Không gắn middleware nén/buffer cho collab.
4. **TLS**: chứng chỉ **Cloudflare Origin CA** wildcard `*.thanhgo.com` làm _default certificate_ của Traefik (`infra/coolify/proxy/dynamic/origin-ca.yml`), Cloudflare SSL **Full (strict)**, router chỉ `tls=true` (không ACME). Traefik tin `X-Forwarded-For` chỉ từ dải IP Cloudflare (`forwardedHeaders.trustedIPs`), entrypoint `https` đặt `readTimeout=0` cho WebSocket (PLAN §7.7).
5. **Deploy từ GitHub**: `deploy.yml` (sau `Build images` trên `main`, hoặc chạy tay với một ref) → `PATCH /api/v1/applications/{uuid}/envs` đặt `KB_IMAGE_TAG=sha-<full sha>` → `GET /api/v1/deploy?uuid=…` → poll `GET /api/v1/deployments/{id}` → smoke test `/health` của collab và `/api/health` của web phải trả đúng `sha`, và `POST /internal/…` từ Internet phải 404.
6. **Dashboard Coolify** phục vụ qua `https://kb-coolify.thanhgo.com` (hostname mới, subdomain 1 cấp) sau **Cloudflare Access**: người quản trị đăng nhập Google; GitHub Actions dùng **service token** (`CF_ACCESS_CLIENT_ID/SECRET`) + token API Coolify. Cổng 8000/6001/6002 chỉ mở cho IP quản trị (hoặc đóng hẳn khi đã có domain).
7. **Firewall hai lớp** trong máy + firewall Hostinger bên ngoài: `infra/scripts/firewall-cloudflare.sh` đặt rule trong chuỗi `DOCKER-USER` (vì cổng Docker publish **bỏ qua ufw**), so khớp cổng đích gốc (conntrack) với ipset dải Cloudflare/IP quản trị, chặn mọi kết nối mới khác từ Internet (kể cả cổng lỡ publish như 5432); ufw cho SSH.

## Hệ quả

- Tốt: mọi cấu hình định tuyến/thứ tự/biến nằm trong git và được review; không có đường SSH từ CI vào máy; secret GitHub ít hơn (`COOLIFY_APP_UUID` thay cho `COOLIFY_APP_UUID_WEB/COLLAB`; không cần `DEPLOY_SSH_KEY`, `CF_TUNNEL_*` cho staging).
- Đánh đổi: `docker compose up` **tạo lại container** thay vì rolling update → staging gián đoạn vài giây mỗi lần deploy (chấp nhận được). Nếu `kb-migrate` lỗi, compose dừng trước khi tạo lại `kb-collab`/`kb-web` (container cũ vẫn chạy — cần xác nhận ở lần lỗi đầu tiên).
- Đánh đổi: resource Coolify đọc file compose ở HEAD của `main` lúc deploy, còn image theo `KB_IMAGE_TAG`. Deploy lại một commit cũ dùng compose mới nhất + image cũ — chấp nhận vì biến môi trường mới luôn có mặc định hoặc là `${VAR:?}` bắt buộc.
- Rủi ro: tên trường API Coolify đổi giữa các bản beta. `scripts/deploy/coolify.mjs` gom mọi lời gọi vào một chỗ, có test; runbook có lệnh `curl` để kiểm tra trước lần deploy đầu.
- Rủi ro: Coolify có thể đổi tên service khi bật "Connect to predefined network" — vì vậy resource `kb-staging` **không** bật tuỳ chọn đó mà khai báo mạng `coolify` trong file, kèm alias `kb-collab`; chỉ service Supabase bật tuỳ chọn này (host DB là `supabase-db-<uuid>`).
- Production (T7.3) quyết định riêng: dùng lại mô hình này (chấp nhận gián đoạn ngắn, có backup trước migrate) hoặc tách Application để có rolling update cho `kb-web`.

## Việc cần người điều phối

PLAN (thuộc người) nên cập nhật theo ADR này: §7.4 (resource Docker Compose thay cho hai Application ở staging), §7.5 (migrate trong compose thay cho SSH), §7.6 danh sách secret GitHub (`COOLIFY_APP_UUID`, `CF_ACCESS_CLIENT_ID/SECRET`), §7.3 thêm hostname `kb-coolify`, và URI hook là `pg-functions://postgres/app/before_user_created_hook` (theo migration `auth_hooks`, không phải `public/hook_before_user_created`).
