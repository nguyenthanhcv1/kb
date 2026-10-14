# Runbook: phát hành phiên bản (release-please + changelog song ngữ)

Thiết kế: [`docs/PLAN.md`](../PLAN.md) §6. Số hiệu theo SemVer, bắt đầu `0.1.0`; không ai sửa version
bằng tay.

| Thành phần                                | Vai trò                                                                                                                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release-please-config.json`              | Cấu hình release-please: type `node`, tag `vX.Y.Z`, bump `apps/web` + `apps/collab/package.json`, map commit → mục Keep a Changelog (`feat` → Added, `fix` → Fixed…; `docs`/`chore`/`ci`/`test`/`refactor` ẩn).               |
| `.release-please-manifest.json`           | Version đã phát hành gần nhất. Chỉ release-please (và người, khi thiết lập lần đầu) sửa.                                                                                                                                      |
| `.github/workflows/release-please.yml`    | Push `main` → mở/cập nhật Release PR `chore(release): release X.Y.Z`; merge PR đó → tag + GitHub Release.                                                                                                                     |
| `.github/workflows/release-vi-notes.yml`  | Trên Release PR: gộp `changelog/vi/unreleased/*.md` thành `changelog/vi/<version>.md` (nếu chưa có file viết tay), chèn khối `### Tiếng Việt` vào `CHANGELOG.md` và commit lại (idempotent); không có ghi chú nào → check đỏ. |
| `scripts/release/inject-vi-changelog.mjs` | Script gộp + chèn (`pnpm changelog:inject-vi [--version X.Y.Z]`).                                                                                                                                                             |
| `scripts/release/build-changelog.mjs`     | Sinh `apps/web/src/generated/changelog.json` cho trang Có gì mới; chạy tự động trước `build`/`dev` của web (`pnpm changelog:build`).                                                                                          |
| `changelog/vi/unreleased/<tên-ngắn>.md`   | Ghi chú tiếng Việt chờ phát hành — **mỗi PR `feat`/`fix` kèm một file** (check `agent-scope` đòi). Hướng dẫn ở [`changelog/vi/README.md`](../../changelog/vi/README.md).                                                      |
| `changelog/vi/<version>.md`               | Ghi chú tiếng Việt của một bản: thường do `release-vi-notes` gộp từ `unreleased/`; viết tay khi muốn bản tổng quan (vd `1.0.0`).                                                                                              |

## Vì sao trang "Có gì mới" trống?

Trang đọc `CHANGELOG.md` + `changelog/vi/<version>.md` lúc **build**. Cả hai chỉ có sau khi một Release PR được merge. Nếu repo **chưa có** `.release-please-manifest.json`, `release-please.yml` chỉ cảnh báo và bỏ qua → không có Release PR, không có tag, trang hiện "Chưa có phiên bản nào được phát hành" và version ở footer là `v0.0.0-<sha>`. Làm "Thiết lập lần đầu" bên dưới là hết.

## Thiết lập lần đầu (người điều phối, một lần)

1. **Tạo `.release-please-manifest.json`** ở gốc repo với nội dung `{ ".": "0.0.0" }` (commit trực tiếp
   hoặc PR `Agent: human`). Agent không được tạo/sửa file này (WORKFLOW §7, check `agent-scope`).
   Chưa có file → `release-please.yml` chỉ cảnh báo và bỏ qua.
   - `0.0.0` nghĩa là "chưa phát hành". KB **đã chạy production** nên bản đầu tiên nên là **`1.0.0`**
     (bản chính thức; PLAN §6.2): sau khi có manifest, đẩy lên `main` (qua PR) một commit có footer
     `Release-As: 1.0.0`, vd `git commit --allow-empty -m "chore(release): 1.0.0" -m "Release-As: 1.0.0"`.
     Không ép số → release-please dùng `initial-version` (`0.1.0`).
   - Bản đầu tiên gom **toàn bộ lịch sử** commit `feat`/`fix` (khá dài). Muốn chỉ tính từ một mốc: thêm
     `"bootstrap-sha": "<sha>"` vào `release-please-config.json` rồi bỏ đi sau bản đầu. Ghi chú tiếng Việt
     `changelog/vi/1.0.0.md` nên là bản tổng quan "bản chính thức đầu tiên" thay vì liệt kê từng thay đổi.
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

## Agent làm gì khi người yêu cầu phát hành

Người nói "phát hành" / "cập nhật Có gì mới" → agent:

1. Tìm Release PR đang mở (`chore(release): release X.Y.Z`, nhánh `release-please--branches--main`). Chưa có
   mà `main` có `feat`/`fix` mới → kiểm tra workflow `Release Please` (manifest, token) và báo người.
2. Xem `release-vi-notes`: thường đã xanh vì các PR `feat`/`fix` kèm `changelog/vi/unreleased/*.md` và
   workflow đã gộp chúng thành `changelog/vi/X.Y.Z.md`. Đọc khối `### Tiếng Việt` trong `CHANGELOG.md` của
   Release PR: thiếu ý nào trong mục `Added`/`Fixed`/`Changed` (PR cũ không kèm ghi chú) → bước 3.
3. Chỉ khi cần: thêm/sửa ghi chú bằng PR `docs(release): add Vietnamese notes for X.Y.Z` (`Task: none`) —
   thêm file vào `changelog/vi/unreleased/`, hoặc viết cả `changelog/vi/X.Y.Z.md` (file viết tay thay
   toàn bộ phần gộp). Merge xong mà Release PR không đổi → bấm **Update branch** trên Release PR (mục Sự cố).
4. Báo người: Release PR + việc còn lại (chờ `release-vi-notes` và CI xanh, người squash-merge); **không**
   tự merge Release PR. Merge xong thì trang Có gì mới có bản mới sau lần deploy kế tiếp (build lại image).

Tần suất gợi ý: phát hành khi đã gom đủ thay đổi người dùng thấy được (vài ngày một lần, hoặc sau mỗi
tính năng lớn); `chore`/`docs`/`ci`/`test`/`refactor` không tạo Release PR.

## Mỗi lần phát hành

1. PR thường được squash-merge vào `main` → release-please cập nhật Release PR (version suy từ tiêu đề
   commit: trước 1.0 `feat` → MINOR, `fix`/`perf` → PATCH, `!` → MINOR).
2. Xem Release PR: version, mục `Added`/`Fixed`… trong `CHANGELOG.md`. Dòng nào khó hiểu → sửa thân PR
   gốc (đã merge), thêm khối `BEGIN_COMMIT_OVERRIDE` … `END_COMMIT_OVERRIDE` chứa commit message đúng,
   rồi chạy lại workflow `Release Please`.
3. Ghi chú tiếng Việt: mỗi PR `feat`/`fix` đã kèm `changelog/vi/unreleased/<tên-ngắn>.md`;
   `release-vi-notes` gộp chúng thành `changelog/vi/<version>.md`, xoá các file `unreleased/` và chèn vào
   `CHANGELOG.md` — không cần làm gì thêm. Muốn bản tổng quan thay cho phần gộp (vd `1.0.0`): viết
   `changelog/vi/<version>.md` (copy `changelog/vi/_template.md`) bằng PR nhỏ vào `main`, tiêu đề
   `docs(release): add Vietnamese notes for <version>`; file viết tay được dùng nguyên, các file
   `unreleased/` bị bỏ (đưa ý cần giữ vào file viết tay). Push thẳng vào nhánh Release PR cũng được nhưng
   release-please **dựng lại nhánh** mỗi khi `main` có `feat`/`fix` mới → file bị mất.
4. Chờ `release-vi-notes` xanh (nó commit `chore(release): add Vietnamese release notes to CHANGELOG.md`
   lên Release PR, gồm `changelog/vi/<version>.md` và việc xoá `unreleased/`) và CI xanh → **squash-merge** Release PR (không sửa tiêu đề).
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
pnpm changelog:inject-vi --version 0.1.0 --check    # chỉ kiểm tra có changelog/vi/0.1.0.md hoặc unreleased/*.md
```

## Sự cố

| Triệu chứng                                                       | Nguyên nhân / cách xử lý                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `release-please` cảnh báo "Chưa có .release-please-manifest.json" | Làm bước 1 phần Thiết lập lần đầu.                                                                                                          |
| Release PR không có check nào                                     | Release PR do `GITHUB_TOKEN` tạo — cấu hình GitHub App (bước 2) hoặc đóng/mở lại PR.                                                        |
| `release-vi-notes` đỏ "Thiếu ghi chú phát hành tiếng Việt"        | Các PR `feat`/`fix` của bản này không kèm ghi chú: PR `docs(release)` thêm `changelog/vi/unreleased/*.md` hoặc `changelog/vi/<version>.md`. |
| Đã merge PR ghi chú mà Release PR vẫn đỏ, không chạy lại          | PR `docs` không đổi nội dung changelog tiếng Anh → release-please không dựng lại nhánh. Bấm **Update branch** trên Release PR.              |
| `release-vi-notes` đỏ "không có section cho version"              | `CHANGELOG.md` trên nhánh không có `## … X.Y.Z` (manifest và changelog lệch) — xem log release-please, chạy lại workflow `Release Please`.  |
| Tag có nhưng không có image `X.Y.Z`                               | Tag tạo bằng `GITHUB_TOKEN` không kích hoạt `build-images.yml` — chạy tay workflow đó trên tag, và cấu hình GitHub App.                     |
