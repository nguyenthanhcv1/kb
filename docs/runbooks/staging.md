# Runbook — Staging trên Coolify (`kb-ops-1`) sau Cloudflare

> Task **T0.8** (`human: true`). Agent đã chuẩn bị file cấu hình, script, workflow; **người** làm các bước trên Hostinger, Coolify, Cloudflare, Google Cloud, GitHub theo đúng thứ tự dưới đây.
> Quyết định kiến trúc: [`docs/adr/0001-staging-deploy-coolify-compose.md`](../adr/0001-staging-deploy-coolify-compose.md). Kế hoạch gốc: `docs/PLAN.md` §7.0–§7.7, §7.15.
> Không bao giờ dán secret vào issue, PR, chat hay commit. Mọi secret lưu trong **password manager của team** + Coolify (locked) + GitHub Environment.

## 0. Tổng quan

```
Trình duyệt / GitHub Actions
        │ HTTPS (Cloudflare proxy, SSL Full strict, WAF)
        ▼
kb-ops-1 (Hostinger KVM 2) — firewall: 80/443 chỉ từ Cloudflare, SSH/Coolify chỉ từ IP quản trị
  Traefik (Coolify proxy, default cert = Cloudflare Origin CA *.thanhgo.com)
   ├─ kb-staging.thanhgo.com          → kb-web:3000
   ├─ kb-staging-collab.thanhgo.com   → kb-collab:3001   (chỉ "/" WebSocket + "/health"; /internal/* → 404)
   ├─ kb-staging-api.thanhgo.com      → Supabase Kong:8000
   └─ kb-coolify.thanhgo.com          → dashboard Coolify (sau Cloudflare Access)
  mạng Docker "coolify": kb-web ──http://kb-collab:3001/internal/*──▶ kb-collab ──▶ supabase-db-<uuid>:5432 (không public)
```

| Hostname (proxied, mây cam)     | Dịch vụ                 | Ghi chú                                              |
| ------------------------------- | ----------------------- | ---------------------------------------------------- |
| `kb-staging.thanhgo.com`        | `kb-web`                | `APP_URL`, `SITE_URL` của GoTrue                     |
| `kb-staging-collab.thanhgo.com` | `kb-collab`             | `COLLAB_PUBLIC_URL=wss://…`                          |
| `kb-staging-api.thanhgo.com`    | Supabase (Kong)         | `SUPABASE_URL`, callback Google OAuth                |
| `kb-coolify.thanhgo.com`        | Coolify dashboard + API | Cloudflare Access (người: Google; CI: service token) |
| `kb-pr-<n>.thanhgo.com`         | preview (sau này)       | T0.10 / `preview-dns.yml`, không làm ở đây           |

Deploy: merge vào `main` → `Build images` đẩy `ghcr.io/nguyenthanhcv1/kb-{web,collab,migrate}:sha-<sha>` → `Deploy` đặt `KB_IMAGE_TAG` trên resource Coolify `kb-staging` và deploy → trong compose: `kb-migrate` → `kb-collab` → `kb-web` → smoke test.

File trong repo:

| File                                                         | Dùng ở bước                       |
| ------------------------------------------------------------ | --------------------------------- |
| `infra/coolify/staging/docker-compose.yml`                   | 9 — resource Coolify `kb-staging` |
| `infra/coolify/staging/env.example`                          | 9 — danh sách biến của resource   |
| `infra/coolify/proxy/dynamic/origin-ca.yml`                  | 4 — default cert của Traefik      |
| `infra/scripts/firewall-cloudflare.sh`, `cloudflare-ips.sh`  | 5 — firewall trong máy            |
| `.github/workflows/deploy.yml`, `scripts/deploy/coolify.mjs` | 11–12 — deploy tự động            |

## 1. Chuẩn bị

- [ ] Quyền: Hostinger (hPanel), Cloudflare (zone `thanhgo.com`, Zero Trust), Google Cloud project `kb-auth` (tài khoản `nguyenthanh.cv@gmail.com`, PLAN §7.15), GitHub repo `nguyenthanhcv1/kb` (admin).
- [ ] Một mục trong password manager tên **"kb staging"** để ghi mọi secret sinh ra dưới đây.
- [ ] Biết IP công khai của máy quản trị: `curl -4 https://ifconfig.me` (ghi lại, gọi là `ADMIN_IP`). IP nhà mạng hay đổi → dùng thêm dải của VPN công ty nếu có.

## 2. VPS Hostinger `kb-ops-1`

1. [ ] hPanel › VPS › mua **KVM 2** (2 vCPU / 8 GB / 100 GB), data center gần VN nhất (Singapore/Malaysia), OS template **Coolify** (Ubuntu). Hostname `kb-ops-1`.
2. [ ] Thêm SSH public key của quản trị khi tạo VPS; đặt mật khẩu root mạnh (lưu password manager) — chỉ dùng cho browser terminal của hPanel khi bị khoá SSH.
3. [ ] SSH vào (`ssh root@<IP>`) rồi:
   ```bash
   apt-get update && apt-get -y upgrade
   apt-get install -y ufw ipset iptables curl git unattended-upgrades
   dpkg-reconfigure -plow unattended-upgrades        # bật cập nhật bảo mật tự động
   timedatectl set-timezone UTC && timedatectl        # "System clock synchronized: yes" (HMAC collab cần lệch < 60 s)
   sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl reload ssh
   docker version && docker compose version          # template Coolify đã cài Docker
   ```
4. [ ] **Firewall Hostinger** (hPanel › VPS › Settings › Firewall) — lớp ngoài cùng, không phụ thuộc Docker. Tạo nhóm rule `kb-ops-1`:
   - Accept TCP 22 từ `ADMIN_IP`.
   - Accept TCP 80 và 443 từ từng dải IPv4 của Cloudflare (`infra/scripts/cloudflare-ips.sh` in danh sách; ~15 dải). Nếu hPanel giới hạn số rule, gộp "any port" cho từng dải Cloudflare.
   - Accept TCP 8000, 6001, 6002 từ `ADMIN_IP` (dashboard Coolify tới khi có domain ở bước 3.4).
   - Drop tất cả còn lại. Gắn nhóm vào VPS.
   - Kiểm tra từ máy quản trị: SSH vẫn vào được.

## 3. Coolify

1. [ ] Mở `http://<IP>:8000` (chỉ từ `ADMIN_IP`), tạo tài khoản admin (email team, mật khẩu mạnh, **bật 2FA** trong Profile).
2. [ ] Settings › Configuration: tắt **Registration** (không cho tự đăng ký). Settings › Advanced: bật **API Access**; để trống "Allowed IPs" (runner GitHub đổi IP — lớp bảo vệ là Cloudflare Access + token).
3. [ ] Servers › `localhost` phải "Reachable"; Proxy = **Traefik**.
4. [ ] (Sau bước 4) Settings › Configuration › **Instance's Domain** = `https://kb-coolify.thanhgo.com` → Save. Từ đây dùng domain; khi chắc chắn dashboard qua domain chạy ổn, chạy lại bước 5 với `--coolify-ports none` và xoá rule 8000/6001/6002 trên firewall Hostinger.
5. [ ] Keys & Tokens › **API tokens** › tạo `github-deploy-staging`, quyền **write** + **deploy** (không cần root/read:sensitive) → lưu password manager (`COOLIFY_API_TOKEN`).
6. [ ] Sources › **GitHub App** › "+ Add" → tạo GitHub App (luồng tự động của Coolify) trên tài khoản `nguyenthanhcv1`, chỉ cấp quyền repo **`kb`**. Dùng để Coolify đọc file compose (và preview ở T0.10).
7. [ ] Truy cập GHCR (image private theo repo): tạo GitHub **personal access token (classic)** chỉ scope `read:packages` (tên `kb-ghcr-pull-kb-ops-1`, hạn 1 năm, ghi ngày hết hạn vào lịch) rồi trên server:
   ```bash
   echo '<PAT>' | docker login ghcr.io -u nguyenthanhcv1 --password-stdin   # lưu vào /root/.docker/config.json, Coolify dùng lại
   docker pull ghcr.io/nguyenthanhcv1/kb-migrate:main                        # kiểm tra
   ```

## 4. Cloudflare

1. [ ] **DNS** (zone `thanhgo.com` › DNS › Records) — bản ghi **A**, **Proxied** (mây cam), trỏ IP của `kb-ops-1`; **không** tạo AAAA:
       `kb-staging`, `kb-staging-collab`, `kb-staging-api`, `kb-coolify`.
2. [ ] **Origin CA**: SSL/TLS › Origin Server › **Create Certificate** › "Generate private key and CSR with Cloudflare", RSA 2048, hostnames `thanhgo.com, *.thanhgo.com`, hạn 15 năm. Lưu **certificate** và **private key** vào password manager (key chỉ hiện một lần), rồi đặt lên server:
   ```bash
   install -d -m 0755 /data/coolify/proxy/certs
   nano /data/coolify/proxy/certs/origin-ca.pem     # dán certificate
   nano /data/coolify/proxy/certs/origin-ca.key     # dán private key
   chmod 0644 /data/coolify/proxy/certs/origin-ca.pem && chmod 0600 /data/coolify/proxy/certs/origin-ca.key
   ```
   Chép `infra/coolify/proxy/dynamic/origin-ca.yml` vào `/data/coolify/proxy/dynamic/origin-ca.yml` (hoặc Coolify › Servers › localhost › Proxy › Dynamic Configurations › Add, tên `origin-ca.yml`).
3. [ ] **Cấu hình Traefik** — Coolify › Servers › localhost › Proxy › Configuration (file docker-compose của proxy), thêm vào danh sách `command:` (giữ nguyên các dòng Coolify có sẵn):
   ```yaml
   - "--entrypoints.https.transport.respondingTimeouts.readTimeout=0"
   - "--entrypoints.http.forwardedHeaders.trustedIPs=<CF_IPS>"
   - "--entrypoints.https.forwardedHeaders.trustedIPs=<CF_IPS>"
   ```
   `<CF_IPS>` = kết quả `infra/scripts/cloudflare-ips.sh --format csv` (một dòng, ngăn cách bằng dấu phẩy). Save → **Restart Proxy**. (Dải Cloudflare hiếm khi đổi; khi đổi, cập nhật lại dòng này — script firewall tự cập nhật phần của nó.)
   Kiểm tra trên server: `echo | openssl s_client -connect 127.0.0.1:443 -servername kb-staging.thanhgo.com 2>/dev/null | openssl x509 -noout -issuer` → issuer chứa `CloudFlare Origin`.
4. [ ] **SSL/TLS** › Overview: mode **Full (strict)**. Edge Certificates: **Always Use HTTPS** bật, **Minimum TLS 1.2**, **Automatic HTTPS Rewrites** bật. HSTS: _chưa_ bật (bật sau khi staging/prod ổn định — PLAN §7.3). Tuỳ chọn: **Authenticated Origin Pulls** (Origin Server) — nếu bật phải thêm client-cert check ở Traefik, để sau.
5. [ ] **Network**: **WebSockets** bật (mặc định bật).
6. [ ] **Speed/Optimization**: **Rocket Loader tắt** (phá hydration Next.js). Không bật minify HTML.
7. [ ] **Caching › Cache Rules**:
   - Rule `kb-bypass`: hostname thuộc {`kb-staging-collab`, `kb-staging-api`, `kb-coolify`}.thanhgo.com **hoặc** (hostname `kb-staging.thanhgo.com` và path không bắt đầu `/_next/static/`) → **Bypass cache**.
   - Rule `kb-next-static`: hostname `kb-staging.thanhgo.com` và path bắt đầu `/_next/static/` → Eligible for cache, Edge TTL "respect origin" (file immutable).
8. [ ] **Security**: WAF Managed Rules (Free managed ruleset) bật. **Bot Fight Mode TẮT** — nó chặn/challenge request từ runner GitHub (smoke test, API Coolify) và không tạo ngoại lệ được ở gói Free.
9. [ ] **Cloudflare Access cho `kb-coolify.thanhgo.com`** (Zero Trust › Access › Applications › Add › Self-hosted):
   - Application domain `kb-coolify.thanhgo.com`, session 24 h.
   - Policy 1 `admins` — Action **Allow**, Include: Emails = email quản trị (login method Google hoặc One-time PIN).
   - Zero Trust › Access › Service Auth › **Service Tokens** › tạo `github-deploy-staging` (hạn 1 năm) → lưu **Client ID** và **Client Secret** (`CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`).
   - Policy 2 `github-deploy` — Action **Service Auth**, Include: Service Token = `github-deploy-staging`.
   - Kiểm tra: mở `https://kb-coolify.thanhgo.com` → màn hình đăng nhập Access → dashboard Coolify (realtime/terminal hoạt động).

## 5. Firewall trong máy (`infra/scripts/firewall-cloudflare.sh`)

Docker publish cổng (Traefik 80/443, Coolify 8000…) **bỏ qua ufw**, nên script đặt rule trong chuỗi `DOCKER-USER` (ipset dải Cloudflare + IP quản trị) và dùng ufw cho SSH. Mọi kết nối mới từ Internet tới cổng khác bị chặn — kể cả cổng lỡ publish (vd Postgres 5432).

**Giữ một phiên SSH thứ hai mở** trong lúc chạy lần đầu; nếu bị khoá: hPanel › VPS › Browser terminal → `ufw disable; iptables -D DOCKER-USER -j KB-DOCKER`.

```bash
git clone --depth 1 https://github.com/nguyenthanhcv1/kb.git /opt/kb-src   # repo private: dùng PAT read-only hoặc scp thư mục infra/scripts
cd /opt/kb-src/infra/scripts
./firewall-cloudflare.sh --dry-run --admin <ADMIN_IP>/32          # đọc kỹ các lệnh sẽ chạy
./firewall-cloudflare.sh --admin <ADMIN_IP>/32 --install          # áp dụng + service chạy lại lúc boot + cập nhật dải Cloudflare hằng tuần
```

- Nhiều IP quản trị: lặp `--admin`. Khi Coolify đã có domain (bước 3.4): thêm `--coolify-ports none` và chạy lại với `--install`.
- Kiểm tra: `iptables -S KB-DOCKER`, `ipset list kb-cf4 | head`, `ufw status verbose`, `systemctl list-timers kb-firewall.timer`.
- Chạy lại bao nhiêu lần cũng được (idempotent). Đổi IP quản trị = chạy lại với danh sách mới (rule cũ tự bị gỡ).

## 6. Supabase (Coolify service template)

1. [ ] Coolify › Projects › **+ New** `kb-staging` (environment `production` mặc định của Coolify đổi tên thành `staging` cho dễ đọc).
2. [ ] + New resource › **Service** › **Supabase**. Trước khi deploy:
   - Domain của `supabase-kong`: `https://kb-staging-api.thanhgo.com:8000` (cú pháp Coolify `domain:port-container`). `supabase-studio`: **để trống** (Studio chỉ qua SSH tunnel; `kb-studio` sau Cloudflare Access là T7.2).
   - Bật **Connect to predefined network** (để `kb-staging` tới được DB qua mạng `coolify`).
   - Tab Environment Variables: ghi lại (password manager) `SERVICE_PASSWORD_POSTGRES`, `SERVICE_PASSWORD_JWT`, `SERVICE_SUPABASEANON_KEY`, `SERVICE_SUPABASESERVICE_KEY`, `SERVICE_USER_ADMIN`/`SERVICE_PASSWORD_ADMIN` (Studio). Tên có thể khác tuỳ bản Coolify — tìm theo ý nghĩa.
   - **Không** bật "Make it publicly available" cho Postgres.
3. [ ] Sửa compose của service (Edit Compose File), service `supabase-auth`, thêm/sửa biến môi trường:
   ```yaml
   GOTRUE_SITE_URL: https://kb-staging.thanhgo.com
   GOTRUE_URI_ALLOW_LIST: https://kb-staging.thanhgo.com/**,https://kb-pr-*.thanhgo.com/**
   API_EXTERNAL_URL: https://kb-staging-api.thanhgo.com
   GOTRUE_EXTERNAL_EMAIL_ENABLED: "false"
   GOTRUE_EXTERNAL_GOOGLE_ENABLED: "true"
   GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
   GOTRUE_EXTERNAL_GOOGLE_SECRET: ${GOOGLE_CLIENT_SECRET}
   GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: https://kb-staging-api.thanhgo.com/auth/v1/callback
   GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED: "true"
   GOTRUE_HOOK_BEFORE_USER_CREATED_URI: pg-functions://postgres/app/before_user_created_hook
   ```
   (`GOTRUE_URI_ALLOW_LIST` là tên thật của `ADDITIONAL_REDIRECT_URLS` trong GoTrue; template Coolify có thể đã map sẵn — giữ một nơi duy nhất.) `GOOGLE_CLIENT_ID/SECRET` điền ở bước 7. Hook: **chỉ bật sau lần migrate đầu** (bước 10) vì hàm `app.before_user_created_hook` do migration tạo; GoTrue self-host có hỗ trợ hook này hay không do spike **T0.10** xác nhận — nếu GoTrue báo lỗi hook, tắt 2 dòng hook và ghi vào PR T0.10.
4. [ ] Deploy service. Kiểm tra: `curl -s https://kb-staging-api.thanhgo.com/auth/v1/health -H "apikey: <ANON_KEY>"` → JSON có `"name":"GoTrue"`.
5. [ ] Tên container DB (dùng ở bước 9): `docker ps --format '{{.Names}}' | grep supabase-db` → `supabase-db-<uuid>`.

## 7. Google OAuth client cho staging (PLAN §7.15)

1. [ ] Google Cloud Console (đăng nhập `nguyenthanh.cv@gmail.com`) › project `kb-auth` › Google Auth Platform › Clients › **Create client** › Web application, tên `kb-staging`.
2. [ ] Authorized redirect URI: `https://kb-staging-api.thanhgo.com/auth/v1/callback` (không cần JavaScript origin).
3. [ ] Lưu Client ID/Secret (password manager) → Coolify › Supabase (kb-staging) › Environment Variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (locked) → Redeploy service.

## 8. Secret cần có (tổng hợp)

| Secret / biến                                                                                                                   | Đặt ở đâu                                                                 | Sinh thế nào                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `SERVICE_PASSWORD_POSTGRES`, `SERVICE_PASSWORD_JWT`, `SERVICE_SUPABASEANON_KEY`, `SERVICE_SUPABASESERVICE_KEY`, mật khẩu Studio | Coolify › Supabase (tự sinh)                                              | Template Coolify sinh; chỉ đọc và chép sang dưới                                                                           |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                                                                      | Coolify › Supabase                                                        | Google Cloud (bước 7)                                                                                                      |
| `KB_IMAGE_TAG`                                                                                                                  | Coolify › kb-staging                                                      | `deploy.yml` tự đặt; tạo tay lần đầu (`main`)                                                                              |
| `MIGRATE_DATABASE_URL`                                                                                                          | Coolify › kb-staging (locked)                                             | `postgresql://postgres:<SERVICE_PASSWORD_POSTGRES>@supabase-db-<uuid>:5432/postgres`                                       |
| `COLLAB_DATABASE_URL`                                                                                                           | Coolify › kb-staging (locked)                                             | `postgresql://kb_collab:<mật khẩu kb_collab>@supabase-db-<uuid>:5432/postgres`; mật khẩu: `openssl rand -hex 24` (bước 10) |
| `SUPABASE_JWT_SECRET`                                                                                                           | Coolify › kb-staging (locked)                                             | = `SERVICE_PASSWORD_JWT`                                                                                                   |
| `SUPABASE_ANON_KEY`                                                                                                             | Coolify › kb-staging                                                      | = `SERVICE_SUPABASEANON_KEY`                                                                                               |
| `SUPABASE_SERVICE_ROLE_KEY`                                                                                                     | Coolify › kb-staging (locked)                                             | = `SERVICE_SUPABASESERVICE_KEY`                                                                                            |
| `COLLAB_INTERNAL_SECRET`                                                                                                        | Coolify › kb-staging (locked) — **một biến dùng chung** cho web và collab | `openssl rand -hex 32` (≥ 32 ký tự; đồng hồ hai bên lệch < 60 s)                                                           |
| `SMTP_*` (tuỳ chọn)                                                                                                             | Coolify › kb-staging                                                      | Gmail App Password (PLAN §7.14) — cần khi có T1.5a                                                                         |
| `COOLIFY_API_URL`                                                                                                               | GitHub › Environment `staging` › secret                                   | `https://kb-coolify.thanhgo.com`                                                                                           |
| `COOLIFY_API_TOKEN`                                                                                                             | GitHub › Environment `staging` › secret                                   | Coolify bước 3.5                                                                                                           |
| `COOLIFY_APP_UUID`                                                                                                              | GitHub › Environment `staging` › secret                                   | UUID resource `kb-staging` (bước 9.5)                                                                                      |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`                                                                                | GitHub › Environment `staging` › secret                                   | Cloudflare Access service token (bước 4.9)                                                                                 |
| `STAGING_DEPLOY_ENABLED`                                                                                                        | GitHub › repo › Variables                                                 | `true` khi mọi bước trên xong                                                                                              |
| PAT `read:packages`                                                                                                             | chỉ trên server (`docker login`)                                          | GitHub › Settings › Developer settings (bước 3.7)                                                                          |
| Origin CA cert + key                                                                                                            | chỉ trên server `/data/coolify/proxy/certs/`                              | Cloudflare (bước 4.2)                                                                                                      |

## 9. Resource `kb-staging` (web + collab + migrate)

1. [ ] Project `kb-staging` › + New resource › **Private Repository (with GitHub App)** › chọn GitHub App ở bước 3.6 › repo `kb`, branch `main`.
2. [ ] Build Pack: **Docker Compose**; Base Directory `/`; Docker Compose Location `/infra/coolify/staging/docker-compose.yml` → Continue. Đặt tên resource `kb-staging`.
3. [ ] Ô **Domains** của `kb-web`, `kb-collab`: **để trống** (routing do label trong file). **Không** bật "Connect to predefined network" cho resource này (file đã khai báo mạng `coolify`, bật lên Coolify sẽ đổi tên service).
4. [ ] **Tắt Auto Deploy** (Advanced › "Auto Deploy" off) — nếu để bật, Coolify deploy ngay khi push, trước khi image được build. Deploy chỉ do `deploy.yml`.
5. [ ] Environment Variables: nhập theo `infra/coolify/staging/env.example` + bảng mục 8; secret đánh dấu **Is Literal** và khoá. Ghi lại **UUID** của resource (trong URL trang resource, hoặc `curl -s -H "Authorization: Bearer $TOKEN" -H "CF-Access-Client-Id: …" -H "CF-Access-Client-Secret: …" https://kb-coolify.thanhgo.com/api/v1/applications | jq '.[] | {name, uuid}'`).
6. [ ] Kiểm tra tên trường API Coolify với bản đang cài (PLAN §7.5 — API thay đổi giữa các beta). Từ máy quản trị:
   ```bash
   H=(-H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET")
   curl -s "${H[@]}" https://kb-coolify.thanhgo.com/api/v1/applications/$COOLIFY_APP_UUID/envs | jq '.[] | select(.key=="KB_IMAGE_TAG")'
   curl -s "${H[@]}" -X PATCH -H 'content-type: application/json' \
     -d '{"key":"KB_IMAGE_TAG","value":"main","is_preview":false}' \
     https://kb-coolify.thanhgo.com/api/v1/applications/$COOLIFY_APP_UUID/envs          # → 201
   ```
   Nếu khác (404/422), sửa `scripts/deploy/coolify.mjs` ở PR T0.10 (hoặc PR fix riêng) — đừng sửa trên nhánh người khác.

## 10. Migrate lần đầu + mật khẩu role `kb_collab`

Role `kb_collab` do migration tạo, **không có mật khẩu** cho tới khi đặt ở đây; `kb-collab` không lên được nếu thiếu.

```bash
DB=$(docker ps --format '{{.Names}}' | grep '^supabase-db')
docker run --rm --network coolify -e DATABASE_URL="postgresql://postgres:<SERVICE_PASSWORD_POSTGRES>@$DB:5432/postgres" \
  ghcr.io/nguyenthanhcv1/kb-migrate:main --dry-run        # xem migration sẽ chạy
docker run --rm --network coolify -e DATABASE_URL="postgresql://postgres:<SERVICE_PASSWORD_POSTGRES>@$DB:5432/postgres" \
  ghcr.io/nguyenthanhcv1/kb-migrate:main                  # áp dụng
KB_COLLAB_PASSWORD=$(openssl rand -hex 24); echo "$KB_COLLAB_PASSWORD"   # lưu password manager
docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "alter role kb_collab password '$KB_COLLAB_PASSWORD';"
```

Rồi điền `COLLAB_DATABASE_URL` trong Coolify, bật hook GoTrue (bước 6.3) và redeploy Supabase. (Nếu `postgres` thiếu quyền trên image Supabase đang dùng, chạy migrate với user `supabase_admin` — ghi lại vào runbook.)

## 11. GitHub

1. [ ] Settings › Environments › **New environment** `staging`: Deployment branches = **Selected branches: `main`** (dispatch từ nhánh khác bị chặn); không cần reviewer. Thêm secrets: `COOLIFY_API_URL`, `COOLIFY_API_TOKEN`, `COOLIFY_APP_UUID`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`.
2. [ ] Settings › Secrets and variables › Actions › **Variables**: `STAGING_DEPLOY_ENABLED=true`. (Tuỳ chọn `STAGING_WEB_URL`, `STAGING_COLLAB_URL` nếu đổi hostname.)
3. [ ] Packages: `kb-web`, `kb-collab`, `kb-migrate` (github.com/nguyenthanhcv1?tab=packages) — giữ **private**, "Manage Actions access" cho repo `kb` quyền Read (để `deploy.yml` kiểm tra image bằng `GITHUB_TOKEN`).

## 12. Deploy đầu tiên

1. [ ] Actions › **Deploy** › Run workflow › ref `main`. Theo dõi các bước: resolve → image có trên GHCR → Coolify deploy (`queued → in_progress → finished`) → smoke test collab, web, `/internal` = 404.
2. [ ] Từ đây mỗi merge vào `main` tự deploy sau `Build images`.

## 13. Kiểm tra (tiêu chí hoàn thành T0.8)

Từ máy bất kỳ ngoài server:

```bash
curl -s https://kb-staging.thanhgo.com/api/health            # {"status":"ok","version":"…","sha":"<sha main mới nhất>","env":"staging"}
curl -s https://kb-staging-collab.thanhgo.com/health         # {"status":"ok",…,"database":"ok","sha":"…"}
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://kb-staging-collab.thanhgo.com/internal/documents/x/replace   # 404
curl -s -o /dev/null -w '%{http_code}\n' https://kb-staging-api.thanhgo.com/auth/v1/health   # 401 (thiếu apikey) — Kong trả lời qua Cloudflare
npx --yes wscat -c 'wss://kb-staging-collab.thanhgo.com/?schemaVersion=1'   # "Connected" = WebSocket qua Cloudflare + Traefik OK (auth sẽ bị từ chối — bình thường)
```

Postgres và cổng nội bộ **không** truy cập được từ Internet (chạy từ máy ngoài, không phải `ADMIN_IP` nếu được):

```bash
IP=<IP kb-ops-1>
nc -vz -w 5 $IP 5432       # timeout/refused
nc -vz -w 5 $IP 8000       # timeout (trừ từ ADMIN_IP)
curl -sk -m 5 --resolve kb-staging.thanhgo.com:443:$IP https://kb-staging.thanhgo.com/api/health   # timeout: origin chỉ nhận từ Cloudflare
```

Trên server:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'kb-|supabase'   # kb-web/kb-collab healthy, kb-migrate Exited (0)
iptables -S KB-DOCKER; ufw status verbose
docker logs $(docker ps -qf name=kb-web) 2>&1 | tail                           # không có lỗi env
```

Ghi kết quả (ảnh chụp hoặc output) vào PR T0.8 mục "Việc cho người".

## 14. Rollback

- **Nhanh nhất**: Actions › Deploy › Run workflow › ref = sha của commit tốt trước đó (xem `git log origin/main`). Workflow đặt lại `KB_IMAGE_TAG` và deploy.
- **Không có GitHub**: Coolify › kb-staging › Environment Variables › `KB_IMAGE_TAG=sha-<sha tốt>` › **Redeploy**.
- Migration là **forward-only** (PLAN §3.7): rollback chỉ đổi image; bản cũ phải chạy được với schema mới (expand → contract). Không bao giờ sửa/xoá migration đã chạy. Staging không có backup (PLAN §7.8) — hỏng dữ liệu thì dựng lại DB (xoá volume Supabase, migrate lại); backup/restore là T0.9.
- Tạm dừng deploy tự động: đặt `STAGING_DEPLOY_ENABLED=false`.

## 15. Sự cố thường gặp

| Triệu chứng                                   | Nguyên nhân hay gặp                                                                        | Xử lý                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Cloudflare **526**                            | Traefik không phục vụ Origin CA (file sai đường dẫn/quyền, proxy chưa restart)             | Kiểm tra `docker logs coolify-proxy`, lệnh `openssl s_client` ở bước 4.3                       |
| **525**                                       | SSL mode không phải Full (strict) hoặc TLS handshake lỗi                                   | Xem SSL/TLS › Overview                                                                         |
| **521/522**                                   | Firewall chặn Cloudflare, proxy không chạy                                                 | `ipset list kb-cf4`, rule Hostinger, `docker ps --filter name=coolify-proxy`                   |
| **404** mọi đường dẫn                         | Label không được Traefik đọc: ô Domains có giá trị, thiếu mạng `coolify`, `traefik.enable` | `docker inspect <container> --format '{{json .Config.Labels}}'`; dashboard Traefik (log proxy) |
| WebSocket đóng sau ~60 s                      | Thiếu `readTimeout=0` ở entrypoint https                                                   | Bước 4.3                                                                                       |
| WebSocket đóng ~100 s khi idle                | Idle timeout Cloudflare                                                                    | Hocuspocus ping 30 s — kiểm tra client (T3.5/T0.10)                                            |
| `kb-migrate` Exited (1), web/collab không đổi | Migration lỗi                                                                              | `docker logs <kb-migrate>`; sửa migration bằng PR mới (forward-only)                           |
| `kb-collab` unhealthy, `database: down`       | Sai `COLLAB_DATABASE_URL`, chưa đặt mật khẩu `kb_collab`, sai host `supabase-db-<uuid>`    | Bước 10, `docker network inspect coolify`                                                      |
| Internal API trả 401 `SIGNATURE_*`            | `COLLAB_INTERNAL_SECRET` khác nhau hoặc lệch giờ > 60 s                                    | Một biến chung; `timedatectl`                                                                  |
| Deploy workflow: HTTP 302/403 từ Coolify API  | Thiếu/sai service token Cloudflare Access                                                  | Secrets `CF_ACCESS_*`, policy Service Auth                                                     |
| Deploy workflow: HTTP 401                     | Token Coolify sai/hết hạn hoặc API Access tắt                                              | Bước 3.2, 3.5                                                                                  |
| Deploy workflow: HTTP 404 ở `/envs`           | Biến `KB_IMAGE_TAG` chưa có trên resource hoặc tên trường API khác                         | Bước 9.5, 9.6                                                                                  |
| Smoke test hết giờ, sha cũ                    | Deploy "finished" nhưng container mới unhealthy / chưa thay                                | Logs trên Coolify, `docker ps`                                                                 |
| Đăng nhập Google báo `redirect_uri_mismatch`  | Redirect URI Google ≠ `https://kb-staging-api.thanhgo.com/auth/v1/callback`                | Bước 7                                                                                         |

## 16. Việc để sau (không thuộc T0.8)

- T0.9: backup `pg_dump` → R2 (staging không backup, chỉ snapshot VPS).
- T0.10: spike hook GoTrue, WebSocket ≥ 30 phút qua Cloudflare/Traefik, preview `kb-pr-<n>` + `preview-dns.yml`, OAuth tài khoản công ty, Gmail App Password.
- T7.2: `kb-studio` sau Cloudflare Access, CSP/headers, rate limit (dùng `CF-Connecting-IP`/`X-Forwarded-For` đã được Traefik lọc theo dải Cloudflare), runbook xoay secret.
- T7.3: production `kb-prod-1` (Coolify remote server; firewall chạy lại script với `--admin <IP kb-ops-1>`), environment `production` có duyệt.
