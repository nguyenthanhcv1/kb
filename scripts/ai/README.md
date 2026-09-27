# Công cụ agent (`scripts/ai`)

Hiện thực hoá quy trình ở [`docs/ai/WORKFLOW.md`](../../docs/ai/WORKFLOW.md) dựa trên
[`docs/ai/tasks.yaml`](../../docs/ai/tasks.yaml) (một hàng đợi task chung, theo thứ tự) và trạng
thái git/GitHub (không có file trạng thái). Không có lane — mọi agent dùng cùng các lệnh.

| Lệnh             | Làm gì                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm ai:next`   | Task ready đầu tiên theo thứ tự file, chưa ai nhận, không `manual` (§4). Thoát 1 nếu không có. |
| `pnpm ai:status` | Tổng quan: đã xong, đang làm, ready, task kế tiếp, đang chờ task nào.                          |
| `pnpm ai:scope`  | Check CI `agent-scope` (workflow `agent-scope.yml`).                                           |

Tuỳ chọn chung của `ai:next`/`ai:status`: `--json`, `--no-fetch` (không `git fetch`), `--no-prs`
(không gọi GitHub API). `ai:next` thêm `--all` (liệt kê mọi task ready theo thứ tự) và
`--skip T1.3,T1.4b` (bỏ qua các task này).

## Trạng thái task

- **done** — `[Txx]` trong tiêu đề commit trên `origin/main` (`[Txx-contract]` không tính).
- **in_progress** — nhánh `origin/<agent>/<Txx>-<slug>` hoặc PR đang mở có `[Txx]`/`[Txx-contract]`.
  PR đọc qua GitHub REST API; repo private cần `GITHUB_TOKEN` hoặc `GH_TOKEN`. Không đọc được →
  cảnh báo, và task chỉ nhận bằng draft PR (nhánh bị ép tên như `claude/<phiên>`) sẽ trông như chưa ai làm.
- **ready** — chưa done/in_progress, mọi `deps` đã done. Còn lại là **blocked**.

`tasks.yaml` phải đúng thứ tự: mỗi task đứng sau mọi `deps` của nó (`parseTasks` báo lỗi nếu sai).

## `agent-scope`

Đọc `Agent:` và `Task:` trong thân PR (bỏ comment HTML của template), `tasks.yaml` **từ nhánh gốc**
(PR không tự thêm task được), `git log` của nhánh gốc và `git diff --name-status base...head`.

Lỗi (check đỏ):

- thiếu `Agent:` (tên tự do) hoặc `Task:`; task không có trong `tasks.yaml`; task `manual` mà
  không phải `Agent: human`;
- tiêu đề thiếu `[Txx]` khớp dòng `Task:`, hoặc chứa mã của task khác (một PR = một task);
- `deps` của task chưa merge vào nhánh gốc;
- sửa `CHANGELOG.md`, `.release-please-manifest.json`.

Bỏ qua: `Agent: human` (không bắt buộc `Task:`), PR do bot tạo (release-please, dependabot).

Chạy thử local:

```bash
PR_TITLE="feat(web): space list [T1.4b]" PR_BODY=$'Agent: claude\nTask: T1.4b' pnpm ai:scope --base origin/main
```
