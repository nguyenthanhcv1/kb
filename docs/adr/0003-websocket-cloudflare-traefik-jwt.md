# ADR 0003 — WebSocket collab qua Cloudflare + Traefik: keepalive bằng awareness, `readTimeout=0`, reconnect; verify JWT Supabase trong collab

- Trạng thái: **(b) Đề xuất — chờ xác minh trên staging** (soak ≥ 30 phút qua Cloudflare); cơ chế keepalive/reconnect **đã xác minh local**. **(c) Chấp nhận — đã xác minh local**
- Ngày: 2026-09-27
- Liên quan: `docs/PLAN.md` §7.7, §7.10, rủi ro R5 · T0.10 điểm (b), (c) · `apps/collab/src/auth.ts`, `apps/collab/src/server.ts`, `apps/collab/src/env.ts` · `infra/coolify/staging/docker-compose.yml` · `docs/runbooks/staging.md` bước 4.3 · công cụ `apps/collab/scripts/ws-soak.ts` · `docs/runbooks/spike-t0.10.md` §b, §c

## Bối cảnh

Đường đi của WebSocket editor: trình duyệt → Cloudflare (proxied) → Traefik (proxy Coolify, entrypoint `https`) → `kb-collab:3001` (Hocuspocus `4.7.0`). R5: kết nối bị cắt khi rảnh, token hết hạn giữa phiên. PLAN ghi "ping 30 s, `readTimeout=0`, reconnect backoff, `sendToken` khi refresh; test ≥ 30 phút ở T0.10". Điểm (c): collab phải xác minh access token Supabase mà không gọi GoTrue mỗi lần.

## Đã xác minh / tìm hiểu

### (b1) Hocuspocus 4.7.0 — đọc mã nguồn trong `node_modules` và chạy thử local

- **Server không gửi ping.** Mỗi kết nối có `setInterval(check, timeout)` với `timeout` mặc định **60 s** (`kb-collab` không đổi); nếu sau khi xác thực mà **không nhận được message nào từ client** trong > 60 s thì server đóng với mã **4408 "Connection Timeout"**.
- **Client (`@hocuspocus/provider`) cũng không ping**, nhưng có **awareness** (y-protocols) bật mặc định: trạng thái awareness cục bộ được gia hạn **~15 s/lần** và gửi lên server; server phát lại cho các client khác. Đó là keepalive thực tế (hai chiều, < 60 s của server, < ~100 s của Cloudflare). Provider tự đóng và nối lại nếu **30 s** không nhận message nào (`messageReconnectTimeout`).
- **Reconnect**: backoff mũ `delay 1 s × factor 2`, `maxDelay 30 s`, jitter, `maxAttempts 0` (vô hạn). Khi nối lại, provider gửi lại token → `onAuthenticate` chạy lại đầy đủ (JWT, quyền, origin, `schemaVersion`).
- Chạy local (collab thật + Supabase local, token GoTrue thật, trang thật) bằng `ws-soak.ts`:
  - awareness bật (mặc định như editor), **32 phút** và 5 phút: **0 lần ngắt** (kết quả chi tiết ở "Kết quả local").
  - `--no-awareness` (client im lặng): server đóng **4408 Connection Timeout** ở phút thứ 2, provider nối lại sau ~1 s và xác thực lại thành công → chứng minh keepalive là **bắt buộc** và reconnect hoạt động.

### (b2) Cloudflare và Traefik — theo tài liệu (chưa xác minh được từ môi trường agent)

- Cloudflare (developers.cloudflare.com/network/websockets): _"Cloudflare will close a WebSocket connection when no data is transmitted in either direction for a period of time"_ (thực tế ~100 s) và _"When Cloudflare releases new code … we may restart servers, which terminates WebSockets connections"_ → cần keepalive (đã có: 15 s) **và** reconnect (đã có); thỉnh thoảng bị ngắt do Cloudflare là bình thường, không phải lỗi cấu hình.
- Traefik v3 (doc entrypoints): `respondingTimeouts.readTimeout` mặc định **60 s** ("maximum duration for reading the entire request"), `writeTimeout 0`, `idleTimeout 180 s` (chỉ cho keep-alive giữa các request). Đã có báo cáo WebSocket bị cắt ~60 s sau khi Traefik đổi mặc định `readTimeout` → giữ `--entrypoints.https.transport.respondingTimeouts.readTimeout=0` như runbook staging bước 4.3. Router collab không có middleware compress/buffering (ADR 0001).

### (c) JWT Supabase trong collab — xác minh local

`createAccessTokenVerifier` (jose): nếu có `SUPABASE_JWKS_URL` → JWKS, chỉ nhận `RS256`/`ES256`; nếu không → secret `SUPABASE_JWT_SECRET`, chỉ `HS256`. Bắt buộc `sub` (UUID), `exp`, `role = authenticated` (anon/service_role bị từ chối).

Kết quả với token thật của GoTrue `v2.197.0` (Supabase CLI `2.118.0`):

| Kiểm tra                                                                              | Kết quả                                                                                   |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Header access token local                                                             | `{"alg":"ES256","kid":"…"}` — **CLI mới ký bằng khoá bất đối xứng**                       |
| `/auth/v1/.well-known/jwks.json` local                                                | 1 khoá EC P-256 (`ES256`)                                                                 |
| Verifier với `SUPABASE_JWT_SECRET` (secret local)                                     | **Từ chối** (`UNAUTHORIZED`)                                                              |
| Verifier với `SUPABASE_JWKS_URL=http://127.0.0.1:54321/auth/v1/.well-known/jwks.json` | Chấp nhận, trả đúng `userId`                                                              |
| Claims                                                                                | `iss, sub, aud, exp, iat, email, role=authenticated, aal, amr, session_id, …`; TTL 3600 s |

Anon/service key local vẫn là HS256 (legacy), nhưng **token người dùng** là ES256. Template Supabase của Coolify đặt `GOTRUE_JWT_SECRET` (= `SERVICE_PASSWORD_JWT`) và không có khoá bất đối xứng → staging dự kiến ký **HS256** (cần xác nhận bằng header token staging, runbook §c).

## Quyết định

1. **Keepalive = awareness của Hocuspocus** (15 s), không thêm ping riêng. Web client (T3.5) **không được** tắt awareness (`awareness: null`); nếu một màn hình cần tắt, phải đặt `forceSyncInterval` < 60 s để vẫn có traffic. Server giữ `timeout` mặc định 60 s.
2. **Traefik**: `readTimeout=0` trên entrypoint `https` (staging và production). Không đặt số lớn (vd 3600 s) vì sẽ cắt phiên sửa dài.
3. **Reconnect**: dùng mặc định của provider (1 s → 30 s, jitter, vô hạn). Client (T3.5) truyền `token` là **hàm** trả access token hiện tại (lấy từ Supabase client) để lần nối lại sau khi token đã refresh không bị `UNAUTHORIZED`, và gọi `provider.sendToken()` khi `onAuthStateChange` báo `TOKEN_REFRESHED` (server kiểm tra ở `onTokenSync`). Hiển thị trạng thái kết nối (R5).
4. **JWT trong collab**: giữ hai chế độ, chọn theo cách GoTrue của môi trường đó ký:
   - staging/production (Coolify, HS256): `SUPABASE_JWT_SECRET` = `SERVICE_PASSWORD_JWT` (như compose staging).
   - local (CLI ≥ 2.1xx, ES256): **`SUPABASE_JWKS_URL=http://127.0.0.1:54321/auth/v1/.well-known/jwks.json`** — secret local không dùng được cho token người dùng.
   - Khi bật khoá bất đối xứng trên staging/prod (JWT signing keys), chuyển sang `SUPABASE_JWKS_URL=https://<api>/auth/v1/.well-known/jwks.json` (đi qua Kong, nội bộ: `http://supabase-kong-<uuid>:8000/auth/v1/.well-known/jwks.json`) và bỏ secret. `jose` cache JWKS và tự tải lại khi gặp `kid` mới.
5. **Tiêu chí T0.10 (b)**: `ws-soak.ts` chạy **35 phút** tới `wss://kb-staging-collab.thanhgo.com` với `--max-disconnects 0` phải exit 0. Nếu có đúng một lần ngắt mã `1001`/`1006` do Cloudflare restart mà reconnect thành công, chạy lại một lần; hai lần liên tiếp có ngắt → điều tra theo bảng dự phòng.

## Phương án dự phòng

| Triệu chứng khi soak trên staging                           | Nguyên nhân khả dĩ                                            | Xử lý                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Ngắt đều đặn ~60 s                                          | `readTimeout` Traefik chưa là 0 (proxy chưa restart)          | Runbook staging 4.3, **Restart Proxy**; kiểm tra `docker inspect coolify-proxy` có cờ                                                |
| Ngắt ~100 s                                                 | Không có traffic (awareness tắt / bị chặn)                    | Kiểm tra `messagesReceived` trong heartbeat tăng; bật awareness hoặc `forceSyncInterval: 20_000`                                     |
| Mã `4408` từ server                                         | Client không gửi gì > 60 s                                    | Như trên; hoặc tăng `timeout` của `Server` (vd 90 s) — không cần nếu awareness bật                                                   |
| Ngắt ngẫu nhiên, hiếm, mã 1001/1006                         | Cloudflare restart edge                                       | Chấp nhận — reconnect trong ≤ 1–2 s, Yjs đồng bộ lại không mất dữ liệu                                                               |
| Không nối được / 5xx khi upgrade                            | WebSockets tắt ở Cloudflare, cache rule chặn, router sai path | Cloudflare › Network › WebSockets bật; rule `kb-bypass` gồm host collab; URL không có path (`Path(/)`)                               |
| Cloudflare không ổn định với WS                             | —                                                             | Hostname collab **DNS only** (mây xám) + firewall mở 443 cho mọi IP chỉ với host collab (mất WAF), hoặc Cloudflare Tunnel cho collab |
| `authenticationFailed: UNAUTHORIZED` ngay khi nối (staging) | GoTrue staging ký ES256/RS256 mà collab dùng secret           | Đặt `SUPABASE_JWKS_URL` (nội bộ qua Kong) thay cho `SUPABASE_JWT_SECRET`                                                             |

## Hệ quả

- Kết nối đã xác thực **không bị kiểm tra lại khi token hết hạn** (Hocuspocus không tự đóng); người bị gỡ quyền vẫn giữ kết nối tới lần nối lại/`sendToken` kế tiếp. Chấp nhận ở MVP (tối đa ~1 h với TTL mặc định); nếu cần chặt hơn: collab đóng kết nối khi `exp` qua mà không có `onTokenSync` (task sau).
- Mỗi lần reconnect chạy lại `app.authorize_document` → deploy collab (tạo lại container) khiến mọi client nối lại cùng lúc; với < 200 người không đáng kể.
- `.env.example` (mục kb-collab) đang gợi ý lấy secret từ `supabase status` — với CLI hiện tại phải dùng `SUPABASE_JWKS_URL` ở local; sửa comment ở PR tiếp theo chạm file đó (ghi trong Handoff T0.10).
- `readTimeout=0` bỏ giới hạn thời gian đọc request trên entrypoint `https`; chấp nhận vì origin chỉ nhận kết nối từ Cloudflare (firewall ADR 0001), Cloudflare đã chặn slowloris ở biên.

## Cách xác minh

- Local (lặp lại được): `docs/runbooks/spike-t0.10.md` §b-local và §c.
- Staging (người): runbook §b — `KB_SOAK_TOKEN=… pnpm --filter @kb/collab soak -- --url wss://kb-staging-collab.thanhgo.com --page <uuid> --origin https://kb-staging.thanhgo.com --minutes 35` → exit 0; dán dòng `soak finished` vào "Kết quả trên staging" và đổi trạng thái (b) thành **Chấp nhận**.

## Kết quả local (2026-09-27)

Collab (`tsx src/index.ts`, `SUPABASE_JWKS_URL` local, `ALLOWED_ORIGINS=http://127.0.0.1:3000`) + Supabase CLI 2.118.0, token GoTrue thật của một user thành viên Space, kết nối trực tiếp `ws://127.0.0.1:3901` (**không** qua Cloudflare/Traefik):

| Chạy                     | Kết quả (dòng `soak finished`)                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| awareness bật, 32 phút   | `"durationMs":1920002,"connects":1,"disconnects":0,"longestConnectedMs":1919970,"messagesReceived":140,"passed":true` — exit 0 |
| awareness bật, 5 phút    | `"disconnects":0,"messagesReceived":31,"passed":true` — exit 0                                                                 |
| `--no-awareness`, 3 phút | `"disconnects":1,"disconnectLog":[{"atMs":120026,"code":4408,"reason":"Connection Timeout"}]`, nối lại sau 1,0 s — exit 1      |

`messagesReceived` ≈ 4/phút khi awareness bật (một message ~15 s) — đó là traffic giữ kết nối qua Cloudflare.

## Kết quả trên staging

_(người điền: ngày, dòng JSON `soak finished`, header `alg` của access token staging)_
