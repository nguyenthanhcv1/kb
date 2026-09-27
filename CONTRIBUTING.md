# Đóng góp cho kb

Tài liệu này dành cho người và AI agent. Quy tắc bắt buộc nằm ở [`AGENTS.md`](AGENTS.md); quy trình nhiều agent chạy song song ở [`docs/ai/WORKFLOW.md`](docs/ai/WORKFLOW.md); kế hoạch ở [`docs/PLAN.md`](docs/PLAN.md). Khi có mâu thuẫn, `AGENTS.md` thắng.

## 1. Cài đặt

Yêu cầu: Node ≥ 22, pnpm 10 (`corepack enable`).

```bash
pnpm install     # cài dependency + git hooks (lefthook)
pnpm dev
```

`pnpm install` tự chạy `lefthook install` (bỏ qua khi `CI=true`). Hook chưa được cài → chạy `pnpm exec lefthook install`.

## 2. Git hooks

| Hook         | Làm gì                                                                |
| ------------ | --------------------------------------------------------------------- |
| `commit-msg` | `commitlint` — chặn commit message sai Conventional Commits           |
| `pre-commit` | `prettier --check` file đã stage; `pnpm i18n:check` khi sửa file dịch |

Sửa lỗi format: `pnpm format`. Chỉ bỏ qua hook khi thật cần (vd commit WIP trên nhánh riêng): `LEFTHOOK=0 git commit …` — CI vẫn kiểm tra lại tiêu đề PR.

## 3. Commit message và tiêu đề PR

Theo [Conventional Commits](https://www.conventionalcommits.org/). PR được **squash-merge** nên **tiêu đề PR là commit message trên `main`** — release-please dựa vào nó để sinh `CHANGELOG.md` và bump version.

```
<type>(<scope>): <mô tả> [<task-id>]
```

- **type**: `feat` (tính năng → minor), `fix` (sửa lỗi → patch), `perf`, `refactor`, `security`, `docs`, `chore`, `ci`, `test`, `build`, `style`, `revert`.
- **scope** (có thể bỏ trống): `web`, `collab`, `db`, `editor`, `table`, `search`, `auth`, `i18n`, `infra`, `ci`, `release`, `docs`, `deps`.
- **mô tả**: tiếng Anh, bắt đầu bằng chữ thường, không dấu chấm cuối, cả dòng ≤ 100 ký tự. Với `feat`/`fix`, viết câu người dùng đọc hiểu (hiện ở trang "What's new").
- **Mã task** `[T1.1]` ở cuối tiêu đề PR — là dấu hiệu "đã nhận/đã xong task" mà agent khác kiểm tra.
- **Thay đổi phá vỡ**: `feat(db)!: …` hoặc footer `BREAKING CHANGE: …`.

Ví dụ:

```
feat(db): add core schema and RLS [T1.1]
fix(search): match queries typed without diacritics [T5.2]
chore(ci): add commitlint and lefthook [T0.2]
```

Kiểm tra thử một tiêu đề: `echo "feat(web): add space list [T1.4b]" | pnpm exec commitlint`.

Cấu hình: [`commitlint.config.mjs`](commitlint.config.mjs) (danh sách type/scope được export để CI và script dùng lại).

## 4. Nhánh và PR

1. Chọn task: `pnpm ai:next` (task ready đầu tiên theo thứ tự trong `docs/ai/tasks.yaml` chưa ai nhận — [`scripts/ai/README.md`](scripts/ai/README.md)); tổng quan: `pnpm ai:status`. Không có lane: agent nào cũng làm được task nào. Bắt đầu từ `origin/main` mới nhất. Nhánh: `<agent>/<task-id>-<slug>` (vd `codex/T1.1-core-schema`); môi trường ép tên nhánh thì giữ `[Txx]` trong tiêu đề PR.
2. Commit đầu tiên + push ngay + mở **draft PR** để nhận task.
3. Một task = một PR nhỏ. Chỉ sửa những gì task cần.
4. Trước khi chuyển ready: `git merge origin/main` (không rebase/force-push nhánh đã push), rồi

   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check
   ```

5. Điền đủ [PR template](.github/pull_request_template.md): `Agent:`, `Task:`, Handoff, checklist Definition of Done. CI `agent-scope` đọc hai dòng `Agent:`/`Task:` để kiểm tra PR gắn đúng một task và deps đã merge — PR của người ghi `Agent: human`.

## 5. Review và merge

- Mọi PR cần người điều phối duyệt ([`.github/CODEOWNERS`](.github/CODEOWNERS)); agent chỉ comment khi review chéo, không push vào nhánh người khác.
- Squash merge, commit message = tiêu đề + mô tả PR.
- Không sửa tay `CHANGELOG.md`, `pnpm-lock.yaml`, `packages/db/src/types.gen.ts`, version trong `package.json`.

## 6. Nguyên tắc nhanh

- Song ngữ vi/en, không chuỗi hiển thị hard-code (`AGENTS.md` §1).
- Mọi bảng bật RLS + pgTAP (`AGENTS.md` §4).
- Chỉ thư viện mã nguồn mở trong allowlist license (`AGENTS.md` §5).
- Không có lane: mọi agent làm chung một hàng đợi task theo thứ tự; task giao diện theo Chuẩn UI (`AGENTS.md`).
