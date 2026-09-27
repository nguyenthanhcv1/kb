# Runbook — Backup & khôi phục Postgres (`kb-backup`)

> Task **T0.9** (`human: true`). Agent đã chuẩn bị image, script, workflow, tài liệu; **người** làm các bước trên Cloudflare R2, máy quản trị (khoá `age`), Coolify, GitHub, Uptime Kuma theo thứ tự dưới đây.
> Kế hoạch gốc: `docs/PLAN.md` §7.8 (backup), §7.6 (biến môi trường), rủi ro R7. Runbook dựng staging: [`staging.md`](staging.md).
> Không bao giờ dán secret (khoá `age`, token R2, URL có mật khẩu) vào issue, PR, chat hay commit. Mọi secret lưu trong **password manager của team**, mục **"kb backup"**.

## 0. Tổng quan

```
kb-prod-1 (Coolify resource "kb-backup", supercronic 02:00 ICT)
  kb-backup ──pg_dump -Fc / pg_dumpall --roles-only──▶ supabase-db-<uuid>:5432 (mạng "coolify")
      │  | age -r <khoá công khai>        (bản rõ không bao giờ ghi ra đĩa)
      ▼
Cloudflare R2  bucket kb-backups (bucket lock + lifecycle theo prefix)
  prod/daily/2026-09-26T190002Z.dump.age        ← pg_dump custom format, mã hoá age
  prod/daily/2026-09-26T190002Z.roles.sql.age   ← role (không mật khẩu), mã hoá age
  prod/weekly/…  (Chủ nhật, giờ ICT)   prod/monthly/…  (ngày 1)   prod/pre-migrate/<version>-…
      │
      ├──▶ Uptime Kuma push monitor  (kb-backup ping sau mỗi lần thành công; im lặng 26 h → cảnh báo)
      └──▶ GitHub Actions "Backup check" (ngoài server)
             · hằng ngày: bản mới nhất < 26 h?
             · hằng tháng: tải → giải mã (khoá riêng) → restore vào Supabase Postgres tạm → verify.sql
               → decode 20 Y.Doc ngẫu nhiên → ping monitor "restore test"
```

| File                                                                   | Vai trò                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `infra/backup/Dockerfile`                                              | image `ghcr.io/nguyenthanhcv1/kb-backup` (postgres 15 Alpine + age + rclone + supercronic) |
| `infra/backup/kb-backup.sh`, `lib.sh`                                  | lệnh `schedule`, `backup`, `list`, `check`, `restore`, `restore-test`, `export-ydoc`       |
| `infra/backup/verify.sql`                                              | kiểm tra DB sau khi khôi phục (bảng, số dòng, RLS, quyền `kb_collab`, ydoc)                |
| `infra/backup/docker-compose.yml`, `env.example`                       | resource Coolify `kb-backup` và danh sách biến                                             |
| `infra/backup/e2e-test.sh`                                             | test đầu-cuối của image (chạy trong `build-images.yml`)                                    |
| `.github/workflows/backup-check.yml`, `scripts/backup/verify-ydoc.mjs` | kiểm tra độ mới hằng ngày + kiểm thử khôi phục hằng tháng                                  |

### 0.1 Thiết kế và lý do

- **Nội dung**: `pg_dump --format=custom` của DB `postgres` (mọi schema: `public`, `app`, `auth`, `storage`, `supabase_migrations`…) bằng role `postgres` (Supabase cấp sẵn `pg_read_all_data` + `BYPASSRLS`), kèm `pg_dumpall --roles-only --no-role-passwords` (role là đối tượng cấp cluster, `pg_dump` không chứa; ví dụ `kb_collab`). **Không có mật khẩu role** trong backup — đặt lại sau khi khôi phục (§7.5). DB nội bộ `_supabase` (log/pooler) không backup.
- **Tên object** theo giờ UTC `YYYY-MM-DDTHHMMSSZ` (không phải `YYYY-MM-DD` như PLAN): sắp xếp theo tên = theo thời gian, và chạy lại trong cùng ngày không ghi đè object cũ (bucket lock cấm ghi đè). Bản 02:00 ICT ngày 27 có tên `…-26T19…Z`.
- **Tầng giữ** (PLAN §7.8): mọi bản vào `daily/`; bản chạy vào **Chủ nhật** (lịch ICT) được chép thêm (server-side copy) vào `weekly/`; ngày **1** hằng tháng vào `monthly/`. Xoá tự động bằng **lifecycle rule R2** theo prefix, không có code xoá nào.
- **Mã hoá `age`** bằng khoá công khai: server production chỉ **mã hoá** được, không đọc lại được backup. Khoá riêng nằm ở password manager (+ GitHub Environment `backup` cho job kiểm thử hằng tháng, xem §3).
- **Bucket lock** chống xoá/ghi đè kể cả khi token R2 bị lộ: token "Object Read & Write" của R2 **có** quyền xoá (R2 không có quyền "ghi mà không xoá"), nên lock là lớp bảo vệ thật sự. Thời hạn lock = thời hạn giữ của từng tầng (§2.3).
- **Lịch chạy bằng supercronic trong container** (không dùng Scheduled Task của Coolify): lịch nằm trong git, log ra stdout của container, và vẫn chạy khi `kb-ops-1` (nơi đặt Coolify, quản lý `kb-prod-1` từ xa) gặp sự cố. HEALTHCHECK của container báo `unhealthy` khi quá 26 h không có bản thành công.
- **Khôi phục luôn vào một database MỚI** (`kb_restore`) trên cluster đích — không bao giờ ghi đè DB đang chạy. DB mới lấy owner, quyền và setting (`app.settings.*`) của DB `postgres` của cluster đích, nên có thể **đổi tên** thành `postgres` (§7.4). Mọi lỗi `pg_restore` đều làm lệnh dừng (`--exit-on-error`); chỉ bỏ qua đúng một mục đã biết: `GRANT` trên `graphql_public.graphql()` (hàm do event trigger của `pg_graphql` tạo sau).
- **Mục tiêu**: RPO 24 h (MVP), RTO 2 h (PLAN §7.8).

## 1. Chuẩn bị

- [ ] Quyền: Cloudflare (account có R2, zone `thanhgo.com`), Coolify (`kb-coolify.thanhgo.com`), GitHub repo `nguyenthanhcv1/kb` (admin), máy quản trị có Docker.
- [ ] Mục **"kb backup"** trong password manager để ghi mọi secret dưới đây.
- [ ] Đã có image trên GHCR: sau khi PR T0.9 merge, workflow **Build images** đẩy `ghcr.io/nguyenthanhcv1/kb-backup:main` (và `:sha-<sha>`, `:X.Y.Z` khi release). Kiểm tra: `docker pull ghcr.io/nguyenthanhcv1/kb-backup:main`.

## 2. Cloudflare R2 (người)

### 2.1 Bucket

1. [ ] Cloudflare dashboard › **R2 Object Storage** › (lần đầu: bật R2, nhập phương thức thanh toán — 10 GB đầu miễn phí).
2. [ ] **Create bucket**: tên `kb-backups`, Location **Automatic** (hoặc hint _Asia-Pacific_), Default storage class **Standard**. Không bật public access, không gắn custom domain.
3. [ ] Ghi lại **Account ID** (R2 › Overview, cột phải) → endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (`S3_ENDPOINT`).

### 2.2 Lifecycle rules (retention)

`kb-backups` › **Settings** › **Object lifecycle rules** › **Add rule** — mỗi dòng một rule, action "Delete uploaded objects after":

| Tên rule           | Prefix              | Xoá sau          |
| ------------------ | ------------------- | ---------------- |
| `prod-daily`       | `prod/daily/`       | 14 ngày          |
| `prod-weekly`      | `prod/weekly/`      | 56 ngày (8 tuần) |
| `prod-monthly`     | `prod/monthly/`     | 365 ngày         |
| `prod-pre-migrate` | `prod/pre-migrate/` | 30 ngày          |
| `staging`          | `staging/`          | 7 ngày           |

- [ ] Giữ (hoặc thêm) rule mặc định **"Abort incomplete multipart uploads" sau 1 ngày** cho cả bucket.
- [ ] Không tạo rule cho `prod/storage/` (tệp đính kèm, T3.6 — chỉ chép thêm, không xoá).

### 2.3 Bucket lock rules (chống xoá/ghi đè)

`kb-backups` › **Settings** › **Bucket lock rules** › **Add rule** — "Retention period":

| Tên rule                | Prefix              | Khoá trong |
| ----------------------- | ------------------- | ---------- |
| `lock-prod-daily`       | `prod/daily/`       | 14 ngày    |
| `lock-prod-weekly`      | `prod/weekly/`      | 56 ngày    |
| `lock-prod-monthly`     | `prod/monthly/`     | 365 ngày   |
| `lock-prod-pre-migrate` | `prod/pre-migrate/` | 30 ngày    |

- Thời hạn lock **bằng** thời hạn lifecycle của cùng prefix: object được bảo vệ suốt đời, lifecycle xoá ngay khi hết khoá. PLAN ghi "bucket lock 30 ngày" + "daily 14 ngày" — hai con số này mâu thuẫn (lock chặn lifecycle xoá). Nếu muốn khoá daily 30 ngày thì đổi **cả hai** rule `prod-daily`/`lock-prod-daily` thành 30 ngày (chi phí lưu tăng ~2×, vẫn < 2 USD/tháng).
- Không khoá `staging/` (bản thử được phép xoá).
- Lock **không gỡ được sớm** cho object đã có; thử nghiệm với prefix `staging/` trước.

### 2.4 API token

R2 › **Manage R2 API Tokens** (hoặc _API_ › _Manage API tokens_) › **Create API token** (loại _Account API token_ nếu có, để token không gắn với tài khoản cá nhân):

1. [ ] `kb-backup-writer` — Permissions **Object Read & Write**, _Specify bucket(s)_ = `kb-backups` **only**, TTL _Forever_ (hoặc 1 năm, ghi ngày hết hạn vào lịch). Ghi **Access Key ID** → `S3_ACCESS_KEY`, **Secret Access Key** → `S3_SECRET_KEY` (chỉ hiện một lần). Dùng cho resource Coolify `kb-backup`.
2. [ ] `kb-backup-reader` — Permissions **Object Read only**, bucket `kb-backups` only. Dùng cho GitHub (`backup-check.yml`) và khi khôi phục từ máy quản trị.
3. [ ] Không dùng Global API key / token quyền Admin.

## 3. Khoá `age`

1. [ ] Trên **máy quản trị** (không làm trên server):
   ```bash
   docker run --rm --entrypoint age-keygen ghcr.io/nguyenthanhcv1/kb-backup:main > kb-backup-age-2026.key
   # hoặc, nếu đã cài age: age-keygen -o kb-backup-age-2026.key
   grep 'public key' kb-backup-age-2026.key     # → age1…  (BACKUP_AGE_RECIPIENT, không bí mật)
   ```
2. [ ] Lưu **toàn bộ nội dung file** (dòng `AGE-SECRET-KEY-1…`) vào password manager, mục "kb backup", trường _age private key (2026)_. Tuỳ chọn: một bản in giấy trong két. Sau đó xoá file: `shred -u kb-backup-age-2026.key` (macOS: `rm -P`).
3. [ ] **Người thứ hai** (tránh phụ thuộc một người): admin thứ hai tự tạo khoá riêng của mình theo bước 1–2; `BACKUP_AGE_RECIPIENT` = hai khoá công khai ngăn bằng dấu phẩy. Mỗi khoá riêng đều giải mã được.
4. [ ] GitHub › Settings › Environments › **`backup`** (tạo mới; _Deployment branches_: **Selected branches → `main`**) › secret `BACKUP_AGE_IDENTITY` = dòng `AGE-SECRET-KEY-1…`. Đây là nơi thứ hai giữ khoá riêng (để kiểm thử khôi phục chạy tự động, ngoài server production). Nếu không chấp nhận, bỏ secret này và chạy §6 bằng tay mỗi tháng từ máy quản trị.
5. Khoá riêng **không bao giờ** nằm trên `kb-prod-1` hay trong resource Coolify `kb-backup`.
6. Xoay khoá (định kỳ hoặc khi nghi lộ): tạo khoá mới → thêm vào `BACKUP_AGE_RECIPIENT` (cả cũ và mới) → redeploy → sau khi bản cuối cùng mã hoá bằng khoá cũ hết hạn giữ (365 ngày với monthly), bỏ khoá cũ. **Không xoá khoá cũ khỏi password manager** khi còn backup mã hoá bằng nó.

## 4. Resource Coolify `kb-backup`

Production (`kb-prod-1`) là T7.3. Để nghiệm thu T0.9 trước khi có production, dựng tạm trên `kb-ops-1` trỏ vào **Supabase staging** với `BACKUP_PREFIX=staging` (PLAN: staging không cần backup lâu dài — prefix `staging/` tự xoá sau 7 ngày; gỡ resource này khi production có `kb-backup` riêng).

1. [ ] Coolify › Project (`kb-staging` để nghiệm thu, sau này project production) › **+ New** › **Docker Compose** (build pack _Docker Compose_), nguồn GitHub App repo `kb`, nhánh `main`, **Docker Compose Location** `/infra/backup/docker-compose.yml`. Tên resource: `kb-backup`. **Không** bật "Connect to predefined network" (file đã khai báo mạng `coolify`).
2. [ ] Environment Variables (đánh dấu _Is Literal?_ và **locked** cho secret) — danh sách đầy đủ trong `infra/backup/env.example`:

   | Biến                                    | Giá trị                                                                                                                                |
   | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
   | `KB_BACKUP_IMAGE_TAG`                   | `main` (production: tag release, vd `0.1.0`)                                                                                           |
   | `BACKUP_DATABASE_URL` 🔒                | `postgresql://postgres:<SERVICE_PASSWORD_POSTGRES>@supabase-db-<uuid>:5432/postgres` (cùng giá trị `MIGRATE_DATABASE_URL` của staging) |
   | `BACKUP_PREFIX`                         | `staging` (nghiệm thu) / `prod`                                                                                                        |
   | `BACKUP_SCHEDULE`                       | `0 2 * * *` (giờ ICT)                                                                                                                  |
   | `BACKUP_AGE_RECIPIENT`                  | `age1…` (một hoặc nhiều, ngăn bằng dấu phẩy)                                                                                           |
   | `S3_ENDPOINT`                           | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`                                                                                        |
   | `S3_BUCKET`                             | `kb-backups`                                                                                                                           |
   | `S3_ACCESS_KEY` 🔒 / `S3_SECRET_KEY` 🔒 | token `kb-backup-writer`                                                                                                               |
   | `BACKUP_HEARTBEAT_URL` 🔒               | URL push monitor (§5), có thể để trống lúc đầu                                                                                         |
   | `BACKUP_HEARTBEAT_FAIL_URL` 🔒          | tuỳ chọn (§5)                                                                                                                          |

3. [ ] **Deploy**. Log phải có dòng `schedule (TZ=Asia/Ho_Chi_Minh) → staging: 0 2 * * * /usr/local/bin/kb-backup backup;`. Thiếu biến → container thoát ngay với `Invalid environment variables` + tên biến.
4. [ ] Chạy một bản ngay (Coolify › kb-backup › **Terminal**, container `kb-backup`):
   ```bash
   kb-backup backup      # … uploaded staging/daily/<tên>.dump.age … backup <tên> done
   kb-backup list        # daily/<tên>.dump.age, daily/<tên>.roles.sql.age (+ weekly/ nếu hôm nay Chủ nhật)
   kb-backup check       # newest backup … is 0 h old (limit 26 h)
   ```
   Kiểm tra trên R2 dashboard: object nằm đúng prefix, tab _Bucket lock_ hiển thị retention (với `prod/`).
5. [ ] Backup trước migration production (T7.3 gắn vào `deploy.yml`): `kb-backup backup --kind pre-migrate --label <version>` → `prod/pre-migrate/<version>-<tên>.dump.age`.

## 5. Cảnh báo

**Chính — Uptime Kuma push monitor** (Uptime Kuma dựng ở T7.3, trên `kb-ops-1`, khác server với production):

1. [ ] Uptime Kuma › **Add New Monitor** › Monitor Type **Push**, tên `kb-backup prod`, **Heartbeat Interval `93600`** giây (26 h), Retries `0`, gắn Notification (Telegram/email — kênh chọn ở T7.3). Lưu → copy **Push URL** dạng `https://<kuma>/api/push/<token>?status=up&msg=OK&ping=`.
2. [ ] `BACKUP_HEARTBEAT_URL` = Push URL đó; `BACKUP_HEARTBEAT_FAIL_URL` = cùng URL nhưng `status=down&msg=backup%20failed` (báo ngay khi lỗi, không đợi 26 h). Redeploy.
3. [ ] Monitor thứ hai `kb-backup restore test`: Push, Heartbeat Interval `2851200` giây (33 ngày) → URL vào secret GitHub `RESTORE_TEST_HEARTBEAT_URL` (Environment `backup`).
4. [ ] Thử cảnh báo: đặt tạm Heartbeat Interval 60 s, chờ → nhận thông báo → trả về 93600.

Trước khi có Uptime Kuma có thể dùng **healthchecks.io** (mã nguồn mở BSD-3, có bản hosted miễn phí): check _Period 1 day, Grace 2 hours_; `BACKUP_HEARTBEAT_URL=https://hc-ping.com/<uuid>`, `BACKUP_HEARTBEAT_FAIL_URL=https://hc-ping.com/<uuid>/fail`. Script chỉ gọi `GET <url>`, không phụ thuộc nhà cung cấp.

**Phụ — GitHub Actions `Backup check`** (không phụ thuộc server lẫn Uptime Kuma; run thất bại → GitHub gửi email cho admin repo):

1. [ ] Environment `backup` (đã tạo ở §3.4) thêm secret: `S3_ENDPOINT`, `S3_BUCKET` (`kb-backups`), `S3_ACCESS_KEY`, `S3_SECRET_KEY` (token **`kb-backup-reader`**), tuỳ chọn `RESTORE_TEST_HEARTBEAT_URL`.
2. [ ] Repository variables: `BACKUP_CHECK_ENABLED=true`; `BACKUP_PREFIX=staging` khi nghiệm thu (sau T7.3 đổi thành `prod` hoặc xoá biến — mặc định `prod`); `RESTORE_TEST_PG_IMAGE` = image Postgres của Supabase đang chạy (xem `docker ps | grep supabase-db` trên server, vd `supabase/postgres:15.8.1.085`); tuỳ chọn `RESTORE_TEST_MIN_PAGES` (vd `1` khi production đã có dữ liệu).
3. [ ] Actions › **Backup check** › _Run workflow_ (restore_test = true) → cả hai job xanh.
4. Lịch: `freshness` mỗi ngày 08:17 ICT; `restore-test` ngày 3 hằng tháng 09:37 ICT. Lưu ý GitHub tự tắt workflow theo lịch nếu repo không có hoạt động 60 ngày.

## 6. Khôi phục vào DB tạm (kiểm thử theo runbook)

Làm khi nghiệm thu T0.9, sau mỗi thay đổi lớn của Supabase, và bất cứ khi nào nghi ngờ backup. Trên **máy quản trị** có Docker (không cần server):

1. [ ] Postgres tạm cùng image với Supabase đang chạy (có sẵn role và extension của Supabase):
   ```bash
   docker network create kb-restore
   docker run -d --name kb-restore-db --network kb-restore -e POSTGRES_PASSWORD=restore-local \
     public.ecr.aws/supabase/postgres:15.8.1.085          # = RESTORE_TEST_PG_IMAGE
   ```
2. [ ] File môi trường ngoài repo, quyền `600` (`~/kb-restore.env`):
   ```bash
   S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   S3_BUCKET=kb-backups
   S3_ACCESS_KEY=<kb-backup-reader>
   S3_SECRET_KEY=<kb-backup-reader>
   BACKUP_PREFIX=staging            # hoặc prod
   RESTORE_ADMIN_URL=postgresql://supabase_admin:restore-local@kb-restore-db:5432/postgres
   BACKUP_AGE_IDENTITY_FILE=/run/age.key
   ```
   Khoá riêng: chép từ password manager vào một file tạm, vd `~/.kb-age.key` (`chmod 600`), xoá ở bước 6.
3. [ ] Chọn bản cần thử và khôi phục + kiểm tra (DB `kb_restore_test` được giữ lại nhờ `--keep`):
   ```bash
   img=ghcr.io/nguyenthanhcv1/kb-backup:main
   run() { docker run --rm --network kb-restore --user "$(id -u):$(id -g)" --env-file ~/kb-restore.env \
             -v ~/.kb-age.key:/run/age.key:ro "$img" "$@"; }
   run list daily                  # các bản hiện có
   run restore-test --keep         # bản mới nhất → kb_restore_test → verify.sql
   # hoặc một bản cụ thể: run restore --key weekly/2026-09-26T190002Z --db kb_restore_test --replace
   ```
   Kết quả đúng: dòng `restore test OK: … {"auth_users" : …, "pages" : …, "latest_migration" : "2026…"}`. Mọi lỗi dừng lệnh với exit ≠ 0 (xem §9).
4. [ ] Decode ngẫu nhiên 20 Y.Doc (cần repo đã `pnpm install`):
   ```bash
   run export-ydoc --limit 20 | node scripts/backup/verify-ydoc.mjs    # {"checked":20,"failed":0}
   ```
5. [ ] (Tuỳ chọn) Xem dữ liệu: `docker exec -it kb-restore-db psql -h 127.0.0.1 -U supabase_admin -d kb_restore_test -c 'select title, updated_at from public.pages order by updated_at desc limit 10'`.
6. [ ] Dọn: `docker rm -f kb-restore-db && docker network rm kb-restore && shred -u ~/.kb-age.key`.
7. [ ] Ghi kết quả (ngày, tên bản, số dòng, thời gian khôi phục) vào issue/nhật ký vận hành — T7.6 cần "restore thử trong 7 ngày qua".

## 7. Khôi phục production (sự cố)

Hai tình huống: **(A)** server còn, dữ liệu hỏng (xoá nhầm, migration lỗi) — khôi phục trên cùng cluster; **(B)** mất server — dựng Supabase mới rồi khôi phục. Luôn khôi phục vào DB mới `kb_restore`, kiểm tra, rồi mới đổi tên. Chọn bản: bản daily gần nhất trước sự cố (`kb-backup list daily`), hoặc `pre-migrate/<version>-…` nếu migration lỗi.

### 7.1 Chuẩn bị

1. [ ] Thông báo sự cố (kênh của team), ghi thời điểm bắt đầu.
2. [ ] (B) Dựng server + Coolify + Supabase theo `staging.md` / `infra/coolify/production.md` (T7.3), **cùng phiên bản** template Supabase và image `supabase/postgres` như trước, **dùng lại các secret cũ** từ password manager (`SERVICE_PASSWORD_POSTGRES`, `SERVICE_PASSWORD_JWT`, anon/service key) để `kb-web`/`kb-collab` và phiên đăng nhập vẫn hợp lệ. Để Supabase khởi động một lần cho các service tạo schema.
3. [ ] Dừng mọi thứ ghi vào DB: Coolify › stop `kb-web`, `kb-collab`, và trong service Supabase stop **mọi container trừ `supabase-db`** (auth, rest, storage, realtime, kong, meta, studio, …).
4. [ ] Dung lượng trống trên server ≥ 3 × kích thước DB (`df -h`; kích thước: `select pg_size_pretty(pg_database_size('postgres'))`).

### 7.2 Khôi phục vào `kb_restore`

Chạy **trên server** (SSH), khoá riêng chỉ nằm trên tmpfs trong lúc khôi phục:

```bash
install -m 700 -d /dev/shm/kb && cd /dev/shm/kb
(umask 077 && nano age.key)            # dán khoá riêng từ password manager
cat > restore.env <<'EOF'
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_BUCKET=kb-backups
S3_ACCESS_KEY=<kb-backup-reader>
S3_SECRET_KEY=<kb-backup-reader>
BACKUP_PREFIX=prod
RESTORE_ADMIN_URL=postgresql://supabase_admin:<SERVICE_PASSWORD_POSTGRES>@supabase-db-<uuid>:5432/postgres
BACKUP_AGE_IDENTITY_FILE=/run/age.key
BACKUP_WORK_DIR=/work
EOF
install -m 700 -d /var/tmp/kb-restore          # dump giải mã tạm (trên đĩa, không phải RAM)
# --user 0: đọc được age.key (600, root) và thư mục tạm; container bị xoá ngay sau lệnh.
docker run --rm --network coolify --user 0 --env-file restore.env -v /dev/shm/kb/age.key:/run/age.key:ro \
  -v /var/tmp/kb-restore:/work ghcr.io/nguyenthanhcv1/kb-backup:<tag> \
  restore --key daily/<tên bản> --db kb_restore        # hoặc --key latest
```

- `supabase_admin` là superuser của Supabase self-host, cùng mật khẩu với `postgres` (`SERVICE_PASSWORD_POSTGRES`). Cần superuser để tạo extension, event trigger, đối tượng của `supabase_admin`.
- Lệnh tự tạo các role còn thiếu (vd `kb_collab`, **không mật khẩu**), tạo DB `kb_restore` với owner/quyền/setting của DB `postgres` hiện tại, rồi `pg_restore --exit-on-error`.

### 7.3 Kiểm tra trước khi chuyển

```bash
docker run --rm --network coolify --entrypoint psql ghcr.io/nguyenthanhcv1/kb-backup:<tag> \
  "postgresql://supabase_admin:<SERVICE_PASSWORD_POSTGRES>@supabase-db-<uuid>:5432/kb_restore" \
  -X -q -At -v ON_ERROR_STOP=1 -v min_pages=1 -f /usr/local/share/kb-backup/verify.sql
```

Đối chiếu số trang, thời điểm `last_audit_at` (≈ thời điểm của bản backup) với kỳ vọng.

### 7.4 Chuyển DB đã khôi phục thành DB chính

Kết nối vào `template1` (không phải DB sẽ đổi tên) và chạy **liền một lượt**:

```bash
docker exec -i "$(docker ps -qf name=supabase-db)" psql -h 127.0.0.1 -U supabase_admin -d template1 -v ON_ERROR_STOP=1 <<'SQL'
alter database postgres with allow_connections false;
select pg_terminate_backend(pid) from pg_stat_activity
 where datname in ('postgres', 'kb_restore') and pid <> pg_backend_pid();
alter database postgres rename to postgres_before_restore;
alter database kb_restore rename to postgres;
SQL
```

- Lỗi `database "postgres" is being accessed by other users` (worker `pg_cron`/`pg_net` kết nối lại): chạy lại khối lệnh.
- DB cũ giữ tên `postgres_before_restore`, **không nhận kết nối** — giữ ≥ 7 ngày để so sánh rồi `drop database postgres_before_restore;`.
- Quay lui (nếu bản khôi phục sai): đổi tên ngược lại và `alter database postgres_before_restore with allow_connections true`.

### 7.5 Khởi động lại

1. [ ] Restart container `supabase-db` (để `pg_cron`, `pg_net` chạy lại trên DB mới), rồi start các service Supabase còn lại. Kiểm tra `https://<api>/auth/v1/health`.
2. [ ] Mật khẩu role (không có trong backup): (A) không đổi. (B) role `kb_collab` vừa được tạo không mật khẩu → `alter role kb_collab password '<mật khẩu trong COLLAB_DATABASE_URL>';` (như `staging.md` bước "Mật khẩu role kb_collab"). Các role của Supabase do Supabase mới quản lý.
3. [ ] Deploy lại ứng dụng (Actions › Deploy, hoặc Coolify): `kb-migrate` áp các migration mới hơn bản backup (lịch sử nằm trong `supabase_migrations`), rồi `kb-collab`, `kb-web`.
4. [ ] Smoke test: đăng nhập Google, mở một Space, mở/sửa một trang (collab), tìm kiếm.
5. [ ] Tệp đính kèm (khi T3.6 bật `BACKUP_STORAGE_DIR`): `rclone copy r2:kb-backups/prod/storage <volume storage>` (xem T3.6).
6. [ ] Xoá `/dev/shm/kb` và `/var/tmp/kb-restore` (`rm -rf`), ghi lại tiến trình và RTO thực tế; hậu kiểm (post-mortem).

## 8. Kiểm thử khôi phục hằng tháng (tự động)

`backup-check.yml` job `restore-test` (ngày 3 hằng tháng, hoặc chạy tay): làm đúng §6 trên runner GitHub — Supabase Postgres tạm (`RESTORE_TEST_PG_IMAGE`) → `kb-backup restore-test --keep` → `verify.sql` → decode 20 Y.Doc → ping `RESTORE_TEST_HEARTBEAT_URL`. Kết quả ở _Summary_ của run (số dòng, không có nội dung trang). Run đỏ → làm §6 bằng tay để tìm nguyên nhân (§9). Dữ liệu giải mã chỉ tồn tại trên runner tạm của GitHub trong thời gian job chạy.

## 9. Xử lý sự cố

| Triệu chứng                                                                                                | Nguyên nhân / cách xử lý                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container thoát ngay, `Invalid environment variables`                                                      | Thiếu biến được liệt kê — thêm trong Coolify, redeploy.                                                                                                                                                                                                                                                   |
| `cannot list prod/daily/ (credentials, bucket or network)`                                                 | Sai `S3_ENDPOINT` (không kèm tên bucket), token hết hạn/sai bucket, hoặc outbound 443 bị chặn. Dòng `ERROR :` của rclone ngay trên cho biết mã lỗi (403 = token).                                                                                                                                         |
| Upload lỗi `AccessDenied`/`ObjectLockedByBucketPolicy`                                                     | Ghi đè object đang bị khoá — không xảy ra với tên theo giây; kiểm tra có ai chạy trùng giây, hoặc rule lock đặt sai prefix.                                                                                                                                                                               |
| `pg_dump: error: server version: 15.x; pg_dump version: …` / `aborting because of server version mismatch` | Supabase lên major mới → đổi `PG_IMAGE` trong `infra/backup/Dockerfile` cùng major, build lại.                                                                                                                                                                                                            |
| `no identity matched any of the recipients`                                                                | Khoá riêng không khớp khoá công khai lúc backup (xoay khoá?) — thử khoá cũ trong password manager.                                                                                                                                                                                                        |
| `database kb_restore already exists`                                                                       | Đã có lần khôi phục trước: kiểm tra rồi `--replace`, hoặc dùng `--db` khác.                                                                                                                                                                                                                               |
| `pg_restore: error: could not execute query: …`                                                            | Đọc câu lệnh lỗi. Nếu là đối tượng nội bộ Supabase do extension/event trigger tạo (như `graphql_public.graphql`), thêm mẫu vào `RESTORE_TOC_EXCLUDE` và ghi vào runbook này. **Không** bỏ qua lỗi ở `public`, `app`, `auth`, `storage`. Thường gặp khi `RESTORE_TEST_PG_IMAGE` khác phiên bản production. |
| `RESTORE_CHECK_FAILED: …`                                                                                  | `verify.sql` phát hiện thiếu bảng/quyền/RLS, trang thiếu `page_documents`, ydoc hỏng, hoặc ít trang hơn `RESTORE_TEST_MIN_PAGES`. Backup chưa dùng được → điều tra trước khi cần đến nó.                                                                                                                  |
| Container `unhealthy` / cảnh báo 26 h                                                                      | `docker logs` của `kb-backup` (Coolify › Logs): tìm `ERROR`. Chạy `kb-backup backup` trong Terminal để xem lỗi trực tiếp.                                                                                                                                                                                 |
| `No space left on device`                                                                                  | Backup cần chỗ cho bản mã hoá trong `/tmp`; khôi phục cần ~2 × dump — đặt `BACKUP_WORK_DIR` vào volume lớn hơn.                                                                                                                                                                                           |

## 10. Nghiệm thu T0.9

- [ ] Có object `staging/daily/<tên>.dump.age` + `.roles.sql.age` trên R2 (§4.4); nội dung không đọc được nếu không có khoá (`age` header `age-encryption.org/v1`).
- [ ] Khôi phục vào DB tạm theo §6 thành công (`restore test OK`, `{"checked":…, "failed":0}`); ghi kết quả vào PR T0.9.
- [ ] Workflow **Backup check** chạy tay xanh cả hai job.
- [ ] Cảnh báo khi quá 26 h không có backup: monitor push (Uptime Kuma hoặc healthchecks.io) đã nhận ping; thử nghiệm cảnh báo (§5.4) đến đúng kênh. Job `freshness` đỏ khi bản mới nhất > 26 h.
- [ ] Rule lifecycle + bucket lock đã tạo đúng bảng §2.2–§2.3; hai token R2 đúng quyền; khoá riêng `age` chỉ có trong password manager (+ secret `BACKUP_AGE_IDENTITY` nếu đồng ý).
