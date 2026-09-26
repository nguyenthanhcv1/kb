# Công cụ agent (`scripts/ai`)

Hiện thực hoá quy trình ở [`docs/ai/WORKFLOW.md`](../../docs/ai/WORKFLOW.md) §5–§7 dựa trên
[`docs/ai/tasks.yaml`](../../docs/ai/tasks.yaml) và trạng thái git/GitHub (không có file trạng thái).

| Lệnh                        | Làm gì                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm ai:next --agent <id>` | Task tiếp theo của lane (§5); lane hết việc → task mượn được (§6, ưu tiên đường găng). Thoát 1 nếu không có. |
| `pnpm ai:status`            | Mỗi lane: đã xong, đang làm, ready, mượn được, đang chờ task nào.                                            |
| `pnpm ai:scope`             | Check CI `agent-scope` (workflow `agent-scope.yml`).                                                         |

Tuỳ chọn chung của `ai:next`/`ai:status`: `--json`, `--no-fetch` (không `git fetch`), `--no-prs`
(không gọi GitHub API). `ai:next` thêm `--allow-ui-steal` (Claude xét cả task UI của Claude khác —
chỉ khi người đồng ý). `ai:status` thêm `--lane <id>`.

## Trạng thái task

- **done** — `[Txx]` trong tiêu đề commit trên `origin/main` (`[Txx-contract]` không tính).
- **in_progress** — nhánh `origin/<agent>/<Txx>-<slug>` hoặc PR đang mở có `[Txx]`/`[Txx-contract]`.
  PR đọc qua GitHub REST API; repo private cần `GITHUB_TOKEN` hoặc `GH_TOKEN`. Không đọc được →
  cảnh báo, và task chỉ nhận bằng draft PR (nhánh bị ép tên như `claude/<phiên>`) sẽ trông như chưa ai làm.
- **ready** — chưa done/in_progress, mọi `deps` đã done. Còn lại là **blocked**.

## `agent-scope`

Đọc `Agent:` và `Task:` trong thân PR (bỏ comment HTML của template), `tasks.yaml` **từ nhánh gốc**
(PR không tự nới vùng được), và `git diff --name-status base...head`.

Lỗi (check đỏ):

- thiếu/sai `Agent:` hoặc `Task:`; task không có trong `tasks.yaml`; tiêu đề thiếu `[Txx]`;
- Codex sửa file UI (§3) — bất kể task hay `touches`;
- làm task lane khác mà không ghi `Agent: <id> (mượn từ lane <lane>)`, hoặc mượn task không
  `stealable`, hoặc Codex mượn task UI;
- file thuộc lane khác, ngoài `owns` của lane gốc + `touches` của task (glob cụ thể hơn thắng);
- sửa `CHANGELOG.md`, `.release-please-manifest.json`.

Cảnh báo (không đỏ, reviewer xác nhận): file không lane nào sở hữu (vd `packages/*/package.json`);
Claude mượn task của Claude khác (cần người đồng ý).

Bỏ qua: `Agent: human`, PR do bot tạo (release-please, dependabot).

Ngoại lệ ngoài `tasks.yaml` (`EXTRA_RULES` trong `scope.mjs`, theo WORKFLOW §7–§8):
`pnpm-lock.yaml` lane nào cũng đổi được; root config còn lại (`*.config.mjs`, `.editorconfig`, …)
thuộc `claude-2`; task `ui: true` được thêm `apps/web/src/server/*/mock*.ts` và component shadcn
**mới** trong `components/ui/`.

Chạy thử local:

```bash
PR_TITLE="feat(web): space list [T1.4b]" PR_BODY=$'Agent: claude-2\nTask: T1.4b' pnpm ai:scope --base origin/main
```
