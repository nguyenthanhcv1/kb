# Quy trình nhiều AI agent làm việc song song

> Áp dụng cho mọi agent (Claude Code, ChatGPT Codex, …) và **người điều phối** (human).
> **Không còn lane**: mọi task nằm trong **một hàng đợi chung** `docs/ai/tasks.yaml`, sắp theo thứ tự thực hiện; agent nào vào cũng làm được bất kỳ task nào, sửa được file nào task cần.
> Quy tắc tóm tắt nằm ở `AGENTS.md` §0 (Codex tự đọc `AGENTS.md`; Claude đọc `CLAUDE.md` → import `AGENTS.md`). Tài liệu này là bản đầy đủ.
> Lịch sử: trước đây task được chia lane `claude-1`/`claude-2`/`codex-1` (và `codex-2` cũ). PR/commit cũ ghi các tên đó giữ nguyên.

## 1. Nguyên lý chống xung đột

Xung đột giữa các agent xảy ra ở 3 chỗ: **cùng nhận một task**, **cùng sửa một file**, và **phụ thuộc chưa sẵn sàng**:

| Nguy cơ | Cơ chế chặn |
|---|---|
| Hai agent làm cùng task | **Nhận task ngay** bằng nhánh + draft PR `[Txx]` (§4). `pnpm ai:next` bỏ qua task đã có nhánh/PR. Agent sau thấy task đã bị nhận → lấy task ready kế tiếp. |
| Hai agent sửa cùng file | **Một task = một PR nhỏ**, merge nhanh; file "nóng" có luật riêng (§5); luôn merge `main` mới nhất trước khi xin review. Khi chọn task, ưu tiên task **không cùng khu vực** với task đang có người làm (§4). |
| Làm trước khi phụ thuộc xong | Task chỉ `ready` khi mọi `deps` đã **merge vào `main`**; CI `agent-scope` đỏ nếu deps chưa merge. Task giao diện cần dữ liệu dùng **contract + mock** (§6). |
| Trạng thái lệch nhau | **Không có file trạng thái dùng chung**. Trạng thái suy ra từ git/GitHub (commit trên `main`, nhánh, PR) — nguồn sự thật duy nhất. |
| Merge chồng chéo | **Người merge**, từng PR một, bật "Require branches to be up to date" → PR sau phải merge `main` mới nhất và CI xanh lại. |

## 2. Vai trò

| Ai | Làm gì |
|---|---|
| Agent (Claude Code, Codex, …) | Lấy task ready kế tiếp trong hàng đợi, làm đến khi mở PR. Không giới hạn khu vực: DB, server, UI, editor, collab, CI, hạ tầng, tài liệu. |
| Người điều phối (human) | Khởi động phiên, cấp secret, thao tác UI nhà cung cấp (Coolify, Hostinger, Cloudflare, Google Cloud), review & merge, sửa `tasks.yaml`, làm các task `manual: true`. |

Tên agent (`Agent:` trong thân PR, tiền tố nhánh) là **tên tự do** để truy vết, vd `claude`, `codex`, `claude-2`. Không cần đăng ký trước.

Ước lượng còn lại: `pnpm ai:status` (tổng ngày công đã xong/tổng). Số agent chạy song song tuỳ người điều phối — càng nhiều agent thì càng hay gặp task `blocked`; đường găng do `deps` quyết định.

## 3. Thứ tự task

- `tasks.yaml` là **danh sách tuần tự**: thứ tự trong file = thứ tự ưu tiên thực hiện. Mỗi task luôn đứng **sau** mọi `deps` của nó (công cụ báo lỗi nếu sai).
- Task được nhóm theo milestone (M0 → M7). Trong một milestone: phần nền tảng/server (`a`) đứng trước phần giao diện (`b`), task mở khoá nhiều task khác đứng trước.
- Agent **không** tự đảo thứ tự. Thấy thứ tự không hợp lý → đề xuất trong PR riêng cho người.
- Task `ui: true` có giao diện → phải theo **Chuẩn UI** (`AGENTS.md`). Task `human: true` có bước người làm (§4). Task `manual: true` chỉ người làm, agent không nhận.

## 4. Khởi động phiên và chọn task

Prompt mẫu cho mỗi phiên (thay tên agent):

```
Bạn là agent `codex` trong dự án kb (nhiều agent chạy song song, dùng chung một hàng đợi task).
1. Đọc AGENTS.md, docs/ai/WORKFLOW.md, docs/ai/tasks.yaml.
2. Chạy `pnpm ai:next` để lấy task ready kế tiếp chưa ai nhận.
3. Báo cho tôi task bạn chọn và kế hoạch ngắn, rồi làm luôn đến khi mở PR.
Chỉ làm đúng 1 task trong phiên này.
```

Thuật toán (`pnpm ai:next` làm hộ):

```
git fetch origin --prune
DONE        = các id xuất hiện dạng "[Txx]" trong `git log origin/main --format=%s`
IN_PROGRESS = các id có nhánh `origin/*/<id>-*`  ∪  PR đang mở có "[<id>]" trong tiêu đề
Duyệt tasks theo THỨ TỰ TRONG FILE, lấy task đầu tiên thoả:
   id ∉ DONE ∪ IN_PROGRESS  và  mọi deps ∈ DONE  và  manual != true
Không có → báo người "đang chờ <deps>" và dừng.
```

- `pnpm ai:next --all` liệt kê mọi task ready theo thứ tự; `--skip T1.3` bỏ qua một task. Được chọn task ready **sau** task đầu tiên khi task đầu đụng cùng khu vực/file với một PR đang mở (giảm conflict) — ghi lý do trong PR.
- **Nhận task ngay khi chọn** (để agent khác thấy): tạo nhánh `<agent>/<id>-<slug>` từ `origin/main`, commit đầu tiên (có thể là khung file), **push ngay**, rồi mở **draft PR** tiêu đề `<type>(<scope>): <mô tả> [<id>]`. Môi trường ép tên nhánh (Claude Code on the web: `claude/<phiên>`) → draft PR có `[<id>]` là dấu hiệu nhận task.
- Trước khi push lần đầu, chạy lại `pnpm ai:next` (hoặc xem PR đang mở): nếu task vừa bị agent khác nhận → bỏ nhánh của mình, lấy task kế tiếp. Nếu hai PR vẫn trùng task → người giữ PR mở trước, đóng PR sau.
- **Một phiên = một task.** Xong task (PR đã mở) → kết thúc phiên; phiên mới cho task kế tiếp.
- Mỗi agent chạy trong **môi trường riêng** (Claude Code on the web / Codex cloud có container riêng — khuyến nghị). Nếu chạy local trên cùng một máy: mỗi agent một **git worktree/clone riêng** và **không** chạy đồng thời 2 bộ Supabase local (trùng cổng 54321–54324).
- Task `human: true`: agent làm phần code/tài liệu/script, liệt kê **chính xác** các bước người phải làm (màn hình nào, nhập gì, secret tên gì) trong PR mục "Việc cho người"; task chỉ tính xong khi người làm xong và PR merge.

## 5. File dùng chung ("file nóng") và cách tránh conflict

| File | Luật |
|---|---|
| `pnpm-lock.yaml` | Không sửa tay. Thêm dependency bằng `pnpm add --filter <pkg> <dep>`. Gặp conflict: lấy bản của `main` (`git checkout origin/main -- pnpm-lock.yaml`), chạy lại `pnpm install`, commit. |
| `supabase/migrations/*` | Tạo bằng `supabase migration new <tên>` **ngay trước khi mở PR**. Trước khi merge, nếu `main` có migration timestamp lớn hơn của mình → đổi tên file của mình sang timestamp mới để thứ tự luôn tăng dần. Không sửa migration đã merge. |
| `packages/db/src/types.gen.ts` | Không sửa tay. Conflict → `pnpm db:types` sinh lại sau khi merge `main`. |
| `CHANGELOG.md`, `.release-please-manifest.json`, version trong `package.json` | Chỉ release-please sửa. Agent không bao giờ đụng (CI `agent-scope` chặn). |
| `changelog/vi/<version>.md` | Chỉ viết trong Release PR khi người yêu cầu. |
| File dịch `packages/i18n/messages/{vi,en}/*.json` | Key sắp xếp **theo alphabet** (`pnpm i18n:sort`, `i18n:check` fail nếu chưa sắp) — hai PR thêm key khác nhau hiếm khi đụng cùng dòng. Luôn thêm cả `vi` và `en` trong cùng commit. Dùng key đã có trước khi tạo key mới; chữ dùng chung (Lưu, Huỷ…) đặt ở `common`. |
| `packages/shared/src/errors.ts` | Mã lỗi xếp alphabet; mỗi mã có key `errors.<CODE>` đủ vi/en. |
| Component có sẵn trong `apps/web/src/components/ui/**`, theme, `layout.tsx` | Dùng chung cho mọi màn hình: sửa nhỏ, tương thích ngược; đổi hành vi/giao diện chung thì nêu rõ trong PR. Component shadcn mới → `pnpm dlx shadcn add <name>`. |
| `AGENTS.md`, `CLAUDE.md`, `docs/PLAN.md`, `docs/ai/**` | Chỉ người. Agent đề xuất bằng PR riêng, không gộp vào PR task. |

### 5.1 Khi vẫn gặp conflict
1. `git fetch origin && git merge origin/main` (không rebase nhánh đã push, không force-push).
2. Giải quyết conflict, giữ cả hai thay đổi khi có thể; chạy lại toàn bộ kiểm tra.
3. Hai bên đổi cùng một logic và không giữ được cả hai → hỏi người, không tự bỏ thay đổi của PR khác.
4. Conflict ở file sinh tự động → sinh lại (lockfile, types, changelog.json).

### 5.2 Merge `main` thường xuyên
Mỗi khi bắt đầu phiên và trước khi chuyển PR từ draft sang ready: merge `origin/main` vào nhánh. PR mở lâu > 1 ngày phải merge lại `main` trước khi xin review.

## 6. Contract-first giữa server (`a`) và giao diện (`b`)

Task hỗn hợp được **tách sẵn** thành `a` (server/nền tảng) và `b` (giao diện). Hai phần có thể do hai agent khác nhau làm song song:
1. Task `a` **mở PR contract sớm**: `apps/web/src/server/<area>/index.ts` export hàm có chữ ký đầy đủ + schema zod input/output + mã lỗi từ `packages/shared/src/errors.ts`, JSDoc có ví dụ dữ liệu; thân hàm có thể `throw new Error('NOT_IMPLEMENTED')`. PR contract dùng tiêu đề `… [T1.4a-contract]`, được merge trước; task chỉ tính `done` khi PR cài đặt `[T1.4a]` merge.
2. Task `b` dựng giao diện theo contract; khi `a` chưa xong dùng mock `apps/web/src/server/<area>/mock.ts` (chỉ dữ liệu giả, không logic thật). Khi `a` merge → xoá mock ở PR của `b`.
3. Đổi contract sau khi giao diện đã dùng là thay đổi phá vỡ: giữ hàm cũ (`@deprecated`) + thêm hàm mới, chuyển nơi gọi sang hàm mới, rồi xoá hàm cũ ở PR sau. Tốt nhất là thiết kế contract đủ ngay từ đầu.

Deps `b → a` trong `tasks.yaml` là mốc để **merge** `b` (CI `agent-scope` đỏ tới khi `a` merge); `b` được bắt đầu sớm hơn nếu PR contract của `a` đã merge (ghi rõ trong PR `b`).

## 7. Vòng đời một task

1. **Chọn & nhận** (§4): nhánh + draft PR `[Txx]`.
2. **Đọc** mô tả + tiêu chí hoàn thành ở `docs/PLAN.md` §9, Handoff của các PR `deps` (xem bằng `git log origin/main --grep '\[Txx\]' --format=%B` — squash merge dùng **tiêu đề + mô tả PR** làm commit message nên Handoff nằm luôn trong git log).
3. **Làm**; commit nhỏ, message Conventional Commits. Chỉ làm đúng task — việc phát hiện thêm ghi vào Handoff để người thêm task.
4. **Kiểm tra** trước khi chuyển ready: `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check` (+ `pnpm db:reset && pnpm db:test` nếu đụng DB, + E2E liên quan). Tự rà diff: có chuỗi cứng không? có bảng thiếu RLS không? có file ngoài phạm vi task không?
5. **PR ready**: điền template (Agent, Task, tóm tắt, cách kiểm thử, ảnh chụp nếu UI, Handoff, Việc cho người).
6. **Review**: người review; có thể nhờ agent khác review chéo — reviewer chỉ **comment**, không push vào nhánh người khác.
7. **Merge** (người): squash, theo thứ tự phụ thuộc; sau merge, các PR khác đang mở phải cập nhật `main`.
8. **Kết thúc phiên** agent. Phiên mới → task tiếp theo.

## 8. Việc của người điều phối

- Hằng ngày: `pnpm ai:status` → task nào đang làm, ready, đang chờ gì, task kế tiếp.
- Merge theo thứ tự: PR contract → PR nền tảng (DB, tooling) → PR giao diện. Ưu tiên PR đang chặn nhiều task khác.
- Bật trên GitHub: squash merge only, "Default commit message = Pull request title and description", "Require branches to be up to date before merging", required checks (`ci`, `agent-scope`), xoá nhánh sau merge.
- Khi hai agent vô tình nhận cùng task: giữ PR mở trước, đóng PR còn lại, ghi lại bài học vào `docs/ai/WORKFLOW.md`.
- Thêm/sửa task (bug từ pilot, task mới): sửa `tasks.yaml` trong PR riêng (`Agent: human`), chèn task vào đúng vị trí ưu tiên (sau mọi deps của nó). Task hỗn hợp server + giao diện nên tách `a`/`b` để hai agent làm song song.

## 9. Khác biệt Claude Code và Codex cần lưu ý

| | Claude Code | ChatGPT Codex |
|---|---|---|
| File hướng dẫn tự đọc | `CLAUDE.md` (import `AGENTS.md`), `CLAUDE.md` lồng trong thư mục con | `AGENTS.md` ở gốc và `AGENTS.md` lồng trong thư mục con |
| Tên nhánh | có thể bị môi trường ép → dựa vào `[Txx]` trong tiêu đề PR | tự đặt `<agent>/<id>-<slug>` |
| Ảnh chụp màn hình (task `ui: true`) | chụp bằng Playwright/Chromium trong container | chụp bằng Playwright nếu môi trường có trình duyệt; không có → ghi rõ trong PR để người chụp |
