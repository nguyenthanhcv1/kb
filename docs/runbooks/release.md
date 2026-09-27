# Runbook: phát hành phiên bản (release-please + changelog song ngữ)

Thiết kế: [`docs/PLAN.md`](../PLAN.md) §6. Số hiệu theo SemVer, bắt đầu `0.1.0`; không ai sửa version
bằng tay.

| Thành phần                                | Vai trò                                                                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release-please-config.json`              | Cấu hình release-please: type `node`, tag `vX.Y.Z`, bump `apps/web` + `apps/collab/package.json`, map commit → mục Keep a Changelog (`feat` → Added, `fix` → Fixed…; `docs`/`chore`/`ci`/`test`/`refactor` ẩn). |
| `.release-please-manifest.json`           | Version đã phát hành gần nhất. Chỉ release-please (và người, khi thiết lập lần đầu) sửa.                                                                                                                        |
| `.github/workflows/release-please.yml`    | Push `main` → mở/cập nhật Release PR `chore(release): release X.Y.Z`; merge PR đó → tag + GitHub Release.                                                                                                       |
| `.github/workflows/release-vi-notes.yml`  | Trên Release PR: thiếu `changelog/vi/<version>.md` → check đỏ; có → chèn khối `### Tiếng Việt` vào `CHANGELOG.md` và commit lại (idempotent).                                                                   |
| `scripts/release/inject-vi-changelog.mjs` | Script chèn (`pnpm changelog:inject-vi [--version X.Y.Z]`).                                                                                                                                                     |
| `scripts/release/build-changelog.mjs`     | Sinh `apps/web/src/generated/changelog.json` cho trang Có gì mới; chạy tự động trước `build`/`dev` của web (`pnpm changelog:build`).                                                                            |
| `changelog/vi/<version>.md`               | Ghi chú tiếng Việt viết tay — hướng dẫn ở [`changelog/vi/README.md`](../../changelog/vi/README.md).                                                                                                             |

## Thiết lập lần đầu (người điều phối, một lần)

1. **Tạo `.release-please-manifest.json`** ở gốc repo với nội dung `{ ".": "0.0.0" }` (commit trực tiếp
   hoặc PR `Agent: human`). Agent không được tạo/sửa file này (WORKFLOW §7, check `agent-scope`).
   Chưa có file → `release-please.yml` chỉ cảnh báo và bỏ qua.
   - `0.0.0` nghĩa là "chưa phát hành": release-please dùng `initial-version: "0.1.0"` trong config →
     Release PR đầu tiên là **0.1.0**, không cần footer `Release-As`. (Dự phòng nếu vẫn ra số khác:
     tạo commit rỗng trên `main` có footer `Release-As: 0.1.0`.)
2. **GitHub App cho release** (khuyến nghị mạnh). PR, push, tag tạo bằng `GITHUB_TOKEN` **không kích
   hoạt workflow khác**: Release PR sẽ không có CI/`release-vi-notes`, tag `vX.Y.Z` không kích hoạt
   `build-images.yml`.
   - Tạo GitHub App (Settings › Developer settings › GitHub Apps), quyền repo: _Contents_ read & write,
     _Pull requests_ read & write, _Issues_ read & write, _Metadata_ read. Không cần webhook. Cài vào repo `kb`.
   - Repo › Settings › Secrets and variables › Actions: biến `RELEASE_APP_ID` (App ID), secret
     `RELEASE_APP_PRIVATE_KEY` (private key `.pem`).
   - Dùng App chứ không dùng PAT: PR do App tạo có `user.type = Bot` nên check `agent-scope` bỏ qua;
     PR do PAT tạo sẽ bị `agent-scope` đòi dòng `Agent:`.
3. Chưa có App: Settings › Actions › General › Workflow permissions › bật **Allow GitHub Actions to
   create and approve pull requests**. Khi đó sau mỗi lần release-please cập nhật Release PR phải
   **đóng rồi mở lại** Release PR để CI và `release-vi-notes` chạy, và phải chạy tay `build-images.yml`
   (workflow_dispatch trên tag) sau khi phát hành.
4. Branch protection `main`: thêm check bắt buộc **`release-vi-notes`** (PR thường: job bị skip = đạt).

## Mỗi lần phát hành

1. PR thường được squash-merge vào `main` → release-please cập nhật Release PR (version suy từ tiêu đề
   commit: trước 1.0 `feat` → MINOR, `fix`/`perf` → PATCH, `!` → MINOR).
2. Xem Release PR: version, mục `Added`/`Fixed`… trong `CHANGELOG.md`. Dòng nào khó hiểu → sửa thân PR
   gốc (đã merge), thêm khối `BEGIN_COMMIT_OVERRIDE` … `END_COMMIT_OVERRIDE` chứa commit message đúng,
   rồi chạy lại workflow `Release Please`.
3. Viết `changelog/vi/<version>.md` (copy `changelog/vi/_template.md`). Cách đưa vào:
   - **Khuyến nghị:** PR nhỏ vào `main`, tiêu đề `docs(release): add Vietnamese notes for <version>`
     (thân PR `Agent: <tên agent>` hoặc `human`, `Task:` mã task release của milestone). `docs` là type ẩn nên
     không đổi version; release-please dựng lại Release PR và `release-vi-notes` chèn ghi chú.
   - Hoặc push thẳng file vào nhánh `release-please--branches--main`. Nhanh hơn, nhưng release-please
     **dựng lại nhánh** mỗi khi `main` có commit mới → file bị mất, phải push lại.
4. Chờ `release-vi-notes` xanh (nó commit `chore(release): add Vietnamese release notes to CHANGELOG.md`
   lên Release PR) và CI xanh → **squash-merge** Release PR (không sửa tiêu đề).
5. release-please tạo tag `vX.Y.Z` + GitHub Release → `build-images.yml` retag image `X.Y.Z`/`latest`
   → deploy production (T0.8, cần duyệt environment `production`).
6. Kiểm tra: `curl https://<host>/api/health` trả `"version":"X.Y.Z"`; trang Có gì mới có phiên bản mới
   ở cả hai ngôn ngữ.

## Trường hợp đặc biệt

- **Ép số version** (vd MVP `1.0.0`): commit trên `main` có footer `Release-As: 1.0.0`, ví dụ
  `git commit --allow-empty -m "chore(release): 1.0.0" -m "Release-As: 1.0.0"` (qua PR như thường).
  Sau 1.0 xoá `bump-minor-pre-major` khỏi config (PLAN §6.2).
- **Hotfix:** nhánh từ `main`, PR `fix(...)` → merge → Release PR bản PATCH → quy trình như trên.
- **Version trong `/api/health`:** `APP_VERSION` do `build-images.yml` truyền vào image (`X.Y.Z` khi build
  từ tag, `<manifest>-<sha7>` trên `main`); không có biến này → version trong `apps/web/package.json`.
- **Sửa ghi chú tiếng Việt của bản đã phát hành:** sửa `changelog/vi/<version>.md` qua PR thường (trang
  Có gì mới đọc file này lúc build). Khối trong `CHANGELOG.md` giữ như lúc phát hành — không sửa tay.

## Chạy thử local

```bash
pnpm test:scripts                                   # unit test script (node --test)
pnpm changelog:build                                # → apps/web/src/generated/changelog.json ([] khi chưa có CHANGELOG.md)
pnpm changelog:inject-vi --version 0.1.0 --check    # chỉ kiểm tra có changelog/vi/0.1.0.md
```

## Sự cố

| Triệu chứng                                                       | Nguyên nhân / cách xử lý                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `release-please` cảnh báo "Chưa có .release-please-manifest.json" | Làm bước 1 phần Thiết lập lần đầu.                                                                                                         |
| Release PR không có check nào                                     | Release PR do `GITHUB_TOKEN` tạo — cấu hình GitHub App (bước 2) hoặc đóng/mở lại PR.                                                       |
| `release-vi-notes` đỏ "Thiếu ghi chú phát hành tiếng Việt"        | Thêm `changelog/vi/<version>.md` (bước 3).                                                                                                 |
| `release-vi-notes` đỏ "không có section cho version"              | `CHANGELOG.md` trên nhánh không có `## … X.Y.Z` (manifest và changelog lệch) — xem log release-please, chạy lại workflow `Release Please`. |
| Tag có nhưng không có image `X.Y.Z`                               | Tag tạo bằng `GITHUB_TOKEN` không kích hoạt `build-images.yml` — chạy tay workflow đó trên tag, và cấu hình GitHub App.                    |
