# Runbook — Spike T0.10: xác minh rủi ro hạ tầng (a)–(f)

> Task **T0.10** (`human: true`). Agent đã xác minh những gì làm được ở local và viết ADR; **người** chạy các bước trên staging/Google/Cloudflare/Coolify/Gmail dưới đây rồi ghi kết quả vào mục "Kết quả trên staging" của ADR tương ứng (đổi trạng thái thành **Chấp nhận** hoặc ghi phương án dự phòng đã chọn), trong một PR `docs: record T0.10 staging results [T0.10]`.
> Điều kiện: staging theo `docs/runbooks/staging.md` đã chạy (T0.8). Không dán token/mật khẩu vào PR/issue/chat.

| Điểm | ADR                                                     | Local (agent)                     | Người cần làm |
| ---- | ------------------------------------------------------- | --------------------------------- | ------------- |
| a    | [0002](../adr/0002-auth-hook-google-oauth.md)           | Đã xác minh (GoTrue v2.197.0)     | §a            |
| b    | [0003](../adr/0003-websocket-cloudflare-traefik-jwt.md) | Keepalive/reconnect đã xác minh   | §b (soak 35′) |
| c    | [0003](../adr/0003-websocket-cloudflare-traefik-jwt.md) | Đã xác minh (ES256 local)         | §c            |
| d    | [0004](../adr/0004-preview-deployments-dns.md)          | Chỉ kiểm tra cấu hình trong repo  | §d            |
| e    | [0002](../adr/0002-auth-hook-google-oauth.md)           | Không thể (cần tài khoản công ty) | §e            |
| f    | [0005](../adr/0005-smtp-gmail-app-password.md)          | Không thể (cổng 587 bị chặn)      | §f            |

## a. Hook `before_user_created`

### Local (lặp lại kết quả của agent, ~3 phút)

```bash
export SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=dummy SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=dummy
npx supabase@2.118.0 start -x studio,imgproxy,storage-api,realtime,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit
ANON=$(npx supabase@2.118.0 status -o json | jq -r .ANON_KEY)
A=http://127.0.0.1:54321/auth/v1; DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres
curl -s $A/health -H "apikey: $ANON"                       # "version":"v2.197.0"
# 1) email lạ → 403 AUTH_NOT_ALLOWED
curl -s $A/signup -H "apikey: $ANON" -H 'content-type: application/json' \
  -d '{"email":"stranger@evil.example","password":"Passw0rd!x"}'
# 2) domain trong allowlist → 200, profiles.is_guest = false
psql $DB -c "insert into public.access_allowlist(kind,value) values ('domain','company.example')"
curl -s -o /dev/null -w '%{http_code}\n' $A/signup -H "apikey: $ANON" -H 'content-type: application/json' \
  -d '{"email":"alice@company.example","password":"Passw0rd!x"}'
psql $DB -c "select email, is_guest from public.profiles"
docker logs supabase_auth_kb 2>&1 | grep run_hook | tail -3   # "Hook ran successfully" / "Hook errored out"
```

### Staging

1. [ ] Phiên bản GoTrue: `docker inspect --format '{{.Config.Image}}' $(docker ps -qf name=supabase-auth)` → phải **≥ `v2.197.0`** (ADR 0002 quyết định 2). Thấp hơn → sửa tag image `supabase-auth` trong compose của service Supabase, redeploy.
2. [ ] Biến `GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED=true`, `…_URI=pg-functions://postgres/app/before_user_created_hook` đã đặt (staging runbook 6.3) và service đã redeploy sau migrate.
3. [ ] Trình duyệt ẩn danh, đăng nhập Google trên `https://kb-staging.thanhgo.com` bằng một Gmail **không** có trong allowlist.
       Kỳ vọng: không có dòng mới trong `auth.users` (`docker exec -i $DB psql -U postgres -c "select email from auth.users order by created_at desc limit 3"`), `docker logs <supabase-auth> 2>&1 | grep run_hook` có `Hook errored out … 403: AUTH_NOT_ALLOWED`. URL trình duyệt dừng ở `/login?error=AUTH_CALLBACK_FAILED` (lỗi đã biết, ADR 0002 Hệ quả — ghi lại query string GoTrue trả về `/auth/callback?…error_description=AUTH_NOT_ALLOWED` nhìn thấy trong DevTools › Network).
4. [ ] Đăng nhập bằng `nguyenthanh.cv@gmail.com` (bootstrap) → vào được, là super admin.
5. [ ] Nếu bước 1–3 thất bại (không có `run_hook` trong log): áp phương án dự phòng trong ADR 0002 và ghi lại.

## b. WebSocket ≥ 30 phút qua Cloudflare + Traefik

Công cụ: `apps/collab/scripts/ws-soak.ts` — mở **một** kết nối Hocuspocus thật (awareness bật như editor), không làm gì trong N phút, log JSON mỗi lần connect/disconnect, heartbeat mỗi 60 s (`messagesReceived` phải tăng ~4/phút — đó là keepalive awareness). Exit `0` = đạt, `1` = bị ngắt, `2` = tham số/xác thực sai.

### Local (đã chạy bởi agent — xem ADR 0003 "Kết quả local")

```bash
# Supabase local như §a, rồi (JWT local là ES256 → dùng JWKS, xem §c):
cd apps/collab
APP_ENV=local PORT=3901 DATABASE_URL=postgresql://kb_collab:kb_collab_local@127.0.0.1:54322/postgres \
  SUPABASE_JWKS_URL=http://127.0.0.1:54321/auth/v1/.well-known/jwks.json ALLOWED_ORIGINS=http://127.0.0.1:3000 \
  pnpm exec tsx src/index.ts &
# token: access_token của /auth/v1/signup hoặc /auth/v1/token?grant_type=password; trang: insert vào public.pages (trigger tạo page_documents)
KB_SOAK_TOKEN=<jwt> pnpm soak -- --url ws://127.0.0.1:3901 --page <uuid> --origin http://127.0.0.1:3000 --minutes 5
KB_SOAK_TOKEN=<jwt> pnpm soak -- --url ws://127.0.0.1:3901 --page <uuid> --origin http://127.0.0.1:3000 --minutes 3 --no-awareness
# ↑ kỳ vọng exit 1: server đóng 4408 "Connection Timeout" ~phút thứ 2, client nối lại sau ~1 s
```

### Staging (tiêu chí hoàn thành T0.10)

1. [ ] Kiểm tra Traefik có `readTimeout=0`: `docker inspect coolify-proxy --format '{{json .Args}}' | tr ',' '\n' | grep -i readTimeout` → `…respondingTimeouts.readTimeout=0`.
2. [ ] Tạo trang thử (một lần) — trên server, với email của mình:
   ```bash
   DB=$(docker ps --format '{{.Names}}' | grep '^supabase-db')
   docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -v email="'<email của bạn>'" <<'SQL'
   select id as uid from auth.users where email = :email \gset
   insert into public.spaces (slug, name, created_by) values ('spike-t0-10', 'Spike T0.10', :'uid') on conflict (slug) do nothing;
   select id as sid from public.spaces where slug = 'spike-t0-10' \gset
   insert into public.space_members (space_id, user_id, role) values (:'sid', :'uid', 'admin') on conflict do nothing;
   insert into public.pages (space_id, position, title, created_by) values (:'sid', 'a0', 'WS soak', :'uid') returning id;
   SQL
   ```
   Ghi lại `id` (UUID trang).
3. [ ] Lấy access token: đăng nhập `https://kb-staging.thanhgo.com` → DevTools › Application › Cookies › `sb-kb-staging-api-auth-token` (nếu tách thành `.0`, `.1` thì nối lại theo thứ tự) → copy giá trị (dạng `base64-…`; script tự giải mã). Token sống 1 h → bắt đầu soak ngay.
4. [ ] Từ **máy quản trị** (qua Internet, tức là qua Cloudflare), trong repo đã `pnpm install`:
   ```bash
   read -rs KB_SOAK_TOKEN && export KB_SOAK_TOKEN     # dán cookie/token, Enter (không vào history)
   pnpm --filter @kb/collab soak -- --url wss://kb-staging-collab.thanhgo.com --page <uuid> \
     --origin https://kb-staging.thanhgo.com --minutes 35 | tee ws-soak-staging.log
   echo "exit=$?"
   ```
   Để máy không ngủ trong 35 phút (macOS: `caffeinate -i pnpm …`). **Đạt**: exit 0, dòng cuối `"passed":true,"disconnects":0`.
5. [ ] Có ngắt → đối chiếu bảng "Phương án dự phòng" ADR 0003 theo `code`/thời điểm. Một lần ngắt 1001/1006 lẻ (Cloudflare restart) mà reconnect ngay → chạy lại một lần.
6. [ ] (Tuỳ chọn) chứng minh `readTimeout=0` cần thiết: không cần làm trên staging đang dùng.

## c. JWT Supabase trong collab

1. [ ] Header token staging: `echo '<access_token>' | cut -d. -f1 | base64 -d 2>/dev/null; echo` → kỳ vọng `"alg":"HS256"` (Coolify đặt `GOTRUE_JWT_SECRET`). Nếu `ES256`/`RS256` → collab staging phải dùng `SUPABASE_JWKS_URL=http://supabase-kong-<uuid>:8000/auth/v1/.well-known/jwks.json` (tên host Kong trong mạng `coolify` — kiểm tra bằng `docker ps`) thay cho `SUPABASE_JWT_SECRET` (ADR 0003 quyết định 4).
2. [ ] Soak §b.4 xác thực thành công (`"event":"authenticated","scope":"read-write"`) = collab verify được token thật của staging.
3. [ ] Token sai bị từ chối: `KB_SOAK_TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.x pnpm --filter @kb/collab soak -- --url wss://kb-staging-collab.thanhgo.com --page <uuid> --origin https://kb-staging.thanhgo.com --minutes 1` → exit 2, `authenticationFailed`.

## d. Coolify preview + DNS

1. [ ] Coolify › project `kb-staging` › + New › Private Repository (GitHub App) › repo `kb`, nhánh `main`, build pack **Dockerfile**, Dockerfile `/apps/web/Dockerfile`, base directory `/`, port 3000 → tên `kb-web-preview`. **Không** deploy bản chính (domain chính để trống hoặc `kb-pr-main` không có DNS).
2. [ ] Environment Variables: như `kb-web` trong `infra/coolify/staging/env.example`, `APP_ENV=preview`, `COLLAB_PUBLIC_URL=wss://kb-staging-collab.thanhgo.com`, `COLLAB_INTERNAL_URL=http://kb-collab:3001`; Network: bật **Connect to predefined network** (mạng `coolify`). Resource Limits: 512 MB. Server › Concurrent builds = 1.
3. [ ] Advanced › **Preview Deployments** bật, URL template `https://kb-pr-{{pr_id}}.thanhgo.com`. Ghi lại: Coolify có cho đặt `APP_URL` theo từng preview không (biến `COOLIFY_URL`/`COOLIFY_FQDN`) — ADR 0004 quyết định 2.
4. [ ] Cloudflare API token: My Profile › API Tokens › Create › template "Edit zone DNS", zone `thanhgo.com` → lưu password manager. Mở một PR thử (sửa một dòng README), số PR = `N`, rồi tạo DNS **đúng như workflow sẽ làm**:
   ```bash
   ZONE=$(curl -s -H "Authorization: Bearer $CF_TOKEN" "https://api.cloudflare.com/client/v4/zones?name=thanhgo.com" | jq -r '.result[0].id')
   curl -s -X POST -H "Authorization: Bearer $CF_TOKEN" -H 'content-type: application/json' \
     "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \
     -d "{\"type\":\"A\",\"name\":\"kb-pr-$N\",\"content\":\"<IP kb-ops-1>\",\"proxied\":true,\"ttl\":1,\"comment\":\"preview PR #$N\"}" | jq '.success'
   ```
5. [ ] Chờ Coolify build preview (tab Deployments; ghi lại thời gian build và RAM đỉnh: `docker stats` trong lúc build). Coolify comment URL lên PR?
6. [ ] Kiểm tra:
   ```bash
   curl -s https://kb-pr-$N.thanhgo.com/api/health        # "env":"preview"
   echo | openssl s_client -connect <IP kb-ops-1>:443 -servername kb-pr-$N.thanhgo.com 2>/dev/null | openssl x509 -noout -issuer   # CloudFlare Origin (không phải Let's Encrypt)
   ```
   Đăng nhập Google trên preview → quay về `kb-pr-$N` (không phải `kb-staging`). (Khi editor có — T3.5 — mở một trang và xem WS tới collab staging được chấp nhận.)
7. [ ] Đóng PR → Coolify xoá container preview; xoá DNS:
   ```bash
   ID=$(curl -s -H "Authorization: Bearer $CF_TOKEN" "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records?name=kb-pr-$N.thanhgo.com" | jq -r '.result[0].id')
   curl -s -X DELETE -H "Authorization: Bearer $CF_TOKEN" "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$ID" | jq '.success'
   ```
8. [ ] Ghi kết quả: bước nào hỏng → phương án dự phòng ADR 0004. Sau khi đạt: tạo GitHub Environment `preview` với secret `CLOUDFLARE_API_TOKEN`, variable `PREVIEW_ORIGIN_IP` → agent viết `preview-dns.yml` ở task sau.

## e. Google OAuth bằng tài khoản công ty

1. [ ] Google Cloud Console (`nguyenthanh.cv@gmail.com`) › `kb-auth` › Google Auth Platform › Audience: User type **External**, Publishing status **In production**; Data access: chỉ `openid`, `…/auth/userinfo.email`, `…/auth/userinfo.profile`.
2. [ ] Trong app (super admin): thêm domain công ty vào `access_allowlist` (chưa có UI → SQL: `insert into public.access_allowlist(kind,value) values ('domain','<domain công ty>');`).
3. [ ] Trình duyệt ẩn danh, đăng nhập `https://kb-staging.thanhgo.com` bằng **một tài khoản công ty**. Ghi lại chính xác màn hình Google:
   - Vào được → kiểm tra `select email, is_guest from public.profiles where email = '<email>'` → `is_guest = f`. **Đạt**.
   - "Access blocked: … admin_policy_enforced" / "This app is blocked" → gửi admin Workspace yêu cầu: Admin console › Security › Access and data control › API controls › Manage third-party app access › Add app › OAuth App Name or Client ID = `<Client ID kb-staging>` (và sau này kb-prod) › **Trusted**. Thử lại sau khi admin làm.
4. [ ] Project `kb-auth` › IAM: thêm một tài khoản công ty làm **Owner** (R16).

## f. Gmail App Password

1. [ ] Tài khoản Workspace dùng để gửi: myaccount.google.com › Security › **2-Step Verification** bật → **App passwords** → tạo `kb-smtp-staging` → 16 ký tự (lưu password manager). Không thấy mục App passwords → ghi lại (chính sách công ty chặn) → ADR 0005 dự phòng.
2. [ ] Trên `kb-ops-1`:
   ```bash
   nc -vz -w 5 smtp.gmail.com 587; nc -vz -w 5 smtp.gmail.com 465       # cổng ra có mở không
   cat > /tmp/kb-mail.txt <<EOF
   From: KB <$SMTP_USER>
   To: <người nhận>
   Subject: KB SMTP test T0.10
   Content-Type: text/plain; charset=utf-8

   Xin chào — email thử từ kb-ops-1 qua Gmail SMTP.
   EOF
   read -rs SMTP_PASSWORD
   curl -v --ssl-reqd --url smtp://smtp.gmail.com:587 --user "$SMTP_USER:$SMTP_PASSWORD" \
     --mail-from "$SMTP_USER" --mail-rcpt '<người nhận>' --upload-file /tmp/kb-mail.txt; rm /tmp/kb-mail.txt
   ```
   Kỳ vọng: `250 2.0.0 OK`. Hộp thư người nhận: Inbox (không Spam), "Show original" có `SPF: PASS`, `DKIM: PASS`.
3. [ ] Đặt `SMTP_*` cho resource `kb-staging` trong Coolify (staging runbook §8) — dùng khi T1.5a/T1.7a có "Gửi email thử".

## Ghi kết quả

Mỗi ADR có mục **"Kết quả trên staging"**: ngày, người chạy, đầu ra quan trọng (dòng JSON `soak finished`, header `alg`, bản GoTrue, thông báo lỗi Google nếu có, thời gian build preview). Đổi dòng "Trạng thái" thành **Chấp nhận** (hoặc "Chấp nhận — dùng phương án dự phòng X"). Khi mọi điểm đã có kết quả, T0.10 hoàn thành.
