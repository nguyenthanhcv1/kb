# Quy trình nhiều AI agent làm việc song song

> Áp dụng cho 4 agent: **`claude-1`, `claude-2`, `claude-3`** (Claude Code) và **`codex-1`** (ChatGPT Codex), cộng **người điều phối** (human).
> Lane Platform & collab trước đây là `codex-2` (Codex), nay là `claude-3` (Claude Code). Task/PR cũ ghi `codex-2` được hiểu là `claude-3`.
> Quy tắc tóm tắt nằm ở `AGENTS.md` §0 (Codex tự đọc `AGENTS.md`; Claude đọc `CLAUDE.md` → import `AGENTS.md`). Tài liệu này là bản đầy đủ.
> Danh sách task, lane, vùng sở hữu: `docs/ai/tasks.yaml`.

## 1. Nguyên lý chống xung đột

Xung đột giữa các agent xảy ra ở 3 chỗ: **cùng nhận một task**, **cùng sửa một file**, và **phụ thuộc chưa sẵn sàng**. Quy trình chặn cả ba bằng thiết kế, không dựa vào việc agent "cẩn thận":

| Nguy cơ | Cơ chế chặn |
|---|---|
| Hai agent làm cùng task | **Lane cố định**: mỗi task được gán sẵn cho đúng một agent trong `tasks.yaml`. Không có "hàng đợi chung" để tranh nhau. Mượn task (§6) chỉ khi đã kiểm tra không ai nhận. |
| Hai agent sửa cùng file | **Vùng sở hữu**: mỗi lane sở hữu một tập glob. Chỉ sửa file của lane mình (+ `touches` của task). File dùng chung có luật riêng (§7). CI `agent-scope` chặn PR vi phạm. |
| Làm trước khi phụ thuộc xong | Task chỉ `ready` khi mọi `deps` đã **merge vào `main`**. UI cần dữ liệu thì dùng **contract + mock** (§8) thay vì chờ. |
| Trạng thái lệch nhau | **Không có file trạng thái dùng chung** để sửa. Trạng thái suy ra từ git/GitHub (commit trên `main`, nhánh, PR) — nguồn sự thật duy nhất, không bao giờ conflict. |
| Merge chồng chéo | **Người merge**, từng PR một, bật "Require branches to be up to date" → PR sau phải merge `main` mới nhất và CI xanh lại. |

## 2. Vai trò

| Agent | Công cụ | Lane | Phạm vi chính |
|---|---|---|---|
| `claude-1` | Claude Code (tài khoản 1) | UI lõi & editor | khung app, theme, component `ui/`, editor TipTap, table block (UI, kéo thả), upload, màn hình đăng nhập |
| `claude-2` | Claude Code (tài khoản 2) | UI tính năng | Space, thành viên, admin, cài đặt, cây trang, tìm kiếm, lịch sử, audit, What's new, email template, tài liệu người dùng, ghi chú phát hành tiếng Việt |
| `codex-1` | Codex (tài khoản 1) | DB & server | Supabase (migration, RLS, pgTAP), server actions/contract, Route Handler, middleware auth, SQL tìm kiếm, bảo mật |
| `claude-3` | Claude Code (tài khoản 3) | Platform & collab (không-UI, trước là `codex-2`) | monorepo tooling, CI/CD, Docker, Coolify, release, backup, `apps/collab`, logic editor không-UI (trích xuất, parser paste), hạ tầng test |
| human | Bạn | Điều phối | khởi động phiên, cấp secret, thao tác UI nhà cung cấp (Coolify, Hostinger, Cloudflare, Google Cloud), review & merge, sửa `tasks.yaml` |

Tải dự kiến (ngày công, từ `tasks.yaml`): claude-1 ≈ 13, claude-2 ≈ 13, claude-3 ≈ 19, codex-1 ≈ 17. Nếu chạy liên tục và merge nhanh, MVP có thể xong trong **~23 ngày làm việc** (mô phỏng theo `deps`); thực tế tính thêm thời gian review/merge của người → **~6–7 tuần**. `claude-1`/`claude-2` có ít việc hơn nên được **mượn** task không-UI có `stealable: true` của `claude-3`/`codex-1` (§6).

## 3. Thế nào là "UI" — chỉ Claude (`claude-1`, `claude-2`) được làm

Một thay đổi là **UI** nếu nó thuộc một trong các nhóm sau:
- File trong `apps/web/src/app/**` **trừ** `app/api/**` và `app/auth/callback/**` (trang, layout, `loading.tsx`, `error.tsx`, `not-found.tsx`).
- `apps/web/src/components/**`, `apps/web/src/hooks/**` và hook React bất kỳ dùng cho hiển thị.
- CSS, `globals.css`, Tailwind config, theme token, `components.json` (shadcn), icon, font, ảnh tĩnh giao diện.
- Editor: `packages/editor/src/extensions/**` (schema + node view + menu), `packages/editor/src/ui/**`, `packages/editor/src/table/drag.ts` (tương tác kéo thả).
- `packages/emails/**` (template email hiển thị).
- Chuỗi hiển thị trong `packages/i18n/messages/**` **trừ** `errors.json` và `audit.json` (Codex được thêm key lỗi/audit do server trả về, luôn đủ `vi` + `en`).
- Tài liệu người dùng `docs/user-guide/**`, `docs/glossary.md`, ghi chú phát hành `changelog/vi/**`.
- E2E Playwright kiểm thử luồng giao diện (`apps/web/e2e/editor|table|features/**`).

**Không phải UI** (`codex-1`/`claude-3` làm; `claude-1`/`claude-2` mượn được): migration/SQL, server actions, Route Handler, middleware, collab server, CI, Docker, script, hàm thuần trong `packages/editor/src/extract|table/paste.ts|table/csv.ts|migrations`, cấu hình Playwright/Vitest (`e2e/support/**`), ADR, runbook.

Ranh giới trong một task hỗn hợp: task đã được **tách sẵn** thành `a` (server/nền tảng, `codex-1`/`claude-3`) và `b` (UI, `claude-1`/`claude-2`). Nếu lane không-UI đang làm mà thấy cần UI → dừng ở contract, ghi "Yêu cầu cho lane khác: claude-x cần …" trong PR. Nếu cần một task UI mới chưa có trong `tasks.yaml` → báo người để thêm task.

## 4. Khởi động một phiên (người làm)

Mở phiên mới cho mỗi agent với prompt mẫu (thay tên agent):

```
Bạn là `codex-1` trong dự án kb (4 agent chạy song song).
1. Đọc AGENTS.md, docs/ai/WORKFLOW.md, docs/ai/tasks.yaml.
2. Fetch origin, xác định task tiếp theo của lane `codex-1` theo WORKFLOW §5
   (nếu có `pnpm ai:next --agent codex-1` thì dùng lệnh đó).
3. Báo cho tôi task bạn chọn và kế hoạch ngắn, rồi làm luôn đến khi mở PR.
Chỉ làm đúng 1 task trong phiên này.
```

- **Một phiên = một task.** Xong task (PR đã mở) → kết thúc phiên; phiên mới cho task kế tiếp. Giữ ngữ cảnh gọn, tránh agent "tiện tay" làm thêm.
- Với Claude Code: dùng `claude-1`/`claude-2`/`claude-3` trong prompt. Với Codex: `codex-1`.
- Mỗi agent chạy trong **môi trường riêng** (Claude Code on the web / Codex cloud có container riêng — khuyến nghị). Nếu chạy local trên cùng một máy: mỗi agent một **git worktree/clone riêng** và **không** chạy đồng thời 2 bộ Supabase local (trùng cổng 54321–54324); dùng một máy/VM riêng cho mỗi agent hoặc lần lượt.

## 5. Chọn task tự động

Thuật toán (agent tự làm; từ T0.11 có lệnh `pnpm ai:next --agent <id>` làm hộ):

```
git fetch origin --prune
DONE        = các id xuất hiện dạng "[Txx]" trong `git log origin/main --format=%s`
IN_PROGRESS = các id có nhánh `origin/*/<id>-*`  ∪  PR đang mở có "[<id>]" trong tiêu đề
Duyệt tasks theo THỨ TỰ TRONG FILE (thứ tự = ưu tiên), lấy task đầu tiên thoả:
   lane == tôi  và  id ∉ DONE ∪ IN_PROGRESS  và  mọi deps ∈ DONE
   (và nếu tôi là codex-1 hoặc claude-3: ui != true — luôn đúng vì task UI chỉ nằm ở lane claude-1/claude-2)
Không có → áp dụng §6 (mượn task); vẫn không có → báo người "lane <id> đang chờ <deps>" và dừng.
```

**Nhận task ngay khi chọn** (để agent khác thấy): tạo nhánh `<agent>/<id>-<slug>` từ `origin/main`, commit đầu tiên (có thể là khung file) và **push ngay**, rồi mở **draft PR** tiêu đề `<type>(<scope>): <mô tả> [<id>]`. Môi trường ép tên nhánh (Claude Code on the web) → draft PR có `[<id>]` là dấu hiệu nhận task.

Trường hợp `human: true`: agent làm phần code/tài liệu/script, liệt kê **chính xác** các bước người phải làm (màn hình nào, nhập gì, secret tên gì) trong PR mục "Việc cho người"; task chỉ tính xong khi người làm xong và PR merge.

## 6. Mượn task (work-stealing) khi lane rảnh

Được phép khi lane của mình không còn task `ready`:
1. Chỉ mượn task có `stealable: true`, đang `ready`, **không** `in_progress`.
2. Chiều được mượn: **mọi agent với task không-UI** (vd `claude-1` mượn của `claude-3`, `claude-3` ↔ `codex-1`). **`codex-1` và `claude-3` không mượn task `ui: true`.** `claude-1` ↔ `claude-2` mượn task UI của nhau chỉ khi người đồng ý.
3. Vùng được sửa = `owns` của **lane gốc** của task + `touches` (không phải lane của người mượn).
4. Ghi trong thân PR: `Agent: claude-2 (mượn từ lane codex-1)`.
5. Ưu tiên mượn task nằm trên đường găng (task có nhiều task khác phụ thuộc).

## 7. File dùng chung ("file nóng") và cách tránh conflict

| File | Luật |
|---|---|
| `pnpm-lock.yaml` | Không sửa tay. Thêm dependency bằng `pnpm add --filter <pkg> <dep>` **chỉ** trong package mình sở hữu. Gặp conflict: lấy bản của `main` (`git checkout origin/main -- pnpm-lock.yaml`), chạy lại `pnpm install`, commit. Dependency dùng chung toàn repo (root `package.json`) → yêu cầu `claude-3`. |
| `supabase/migrations/*` | **Chỉ lane `codex-1`** tạo migration (Claude không bao giờ). Tạo bằng `supabase migration new <tên>` **ngay trước khi mở PR**. Trước khi merge, nếu `main` có migration timestamp lớn hơn của mình → đổi tên file của mình sang timestamp mới (`supabase migration new` lại rồi chép nội dung) để thứ tự luôn tăng dần. Không sửa migration đã merge. |
| `packages/db/src/types.gen.ts` | Không sửa tay. Conflict → `pnpm db:types` sinh lại sau khi merge `main`. |
| `CHANGELOG.md`, `.release-please-manifest.json`, version trong `package.json` | Chỉ release-please sửa. Agent không bao giờ đụng. |
| `changelog/vi/<version>.md` | Chỉ `claude-2` viết, và chỉ trong Release PR khi người yêu cầu. |
| File dịch `packages/i18n/messages/{vi,en}/*.json` | Mỗi namespace thuộc **một lane** (bảng 7.3). Key sắp xếp **theo alphabet** (lệnh `pnpm i18n:sort`, `i18n:check` fail nếu chưa sắp) — hai agent thêm key khác nhau hiếm khi đụng cùng dòng. Luôn thêm cả `vi` và `en` trong cùng commit. |
| `packages/shared/src/errors.ts` | Chỉ `codex-1`. Mã lỗi xếp alphabet; mỗi mã có key `errors.<CODE>` đủ vi/en. |
| Root config (`package.json`, `turbo.json`, `tsconfig*.json`, ESLint, `.github/**`) | Chỉ `claude-3`. Lane khác cần đổi → "Yêu cầu cho lane khác". |
| `apps/web/src/app/layout.tsx`, `components/ui/**`, theme | Chỉ `claude-1`. `claude-2` thêm component shadcn **mới** được (file mới), không sửa component có sẵn. |
| `apps/web/src/middleware.ts` | Chỉ `codex-1`. |
| `AGENTS.md`, `CLAUDE.md`, `docs/PLAN.md`, `docs/ai/**` | Chỉ người. Agent đề xuất bằng PR riêng, không gộp vào PR task. |

### 7.1 Khi vẫn gặp conflict
1. `git fetch origin && git merge origin/main` (không rebase nhánh đã push, không force-push).
2. Conflict trong file của lane mình → tự giải quyết, chạy lại toàn bộ kiểm tra.
3. Conflict trong file của lane khác → **không tự quyết**: lấy bản `main` cho file đó, nếu thay đổi của mình vẫn cần thì chuyển thành "Yêu cầu cho lane khác".
4. Conflict ở file sinh tự động → sinh lại (lockfile, types, changelog.json).

### 7.2 Merge `main` thường xuyên
Mỗi khi bắt đầu phiên và trước khi chuyển PR từ draft sang ready: merge `origin/main` vào nhánh. PR mở lâu > 1 ngày phải merge lại `main` trước khi xin review.

### 7.3 Namespace i18n theo lane
| Lane | Namespace |
|---|---|
| `claude-1` | `common`, `auth`, `editor`, `table` |
| `claude-2` | `nav`, `space`, `tree`, `search`, `history`, `settings`, `admin`, `email`, `whatsNew` |
| `codex-1` | `errors`, `audit` |

Cần key trong namespace của lane khác (vd `claude-2` cần chữ "Lưu" trong `common`) → dùng key đã có; chưa có thì tạo key trong namespace của mình, ghi chú để `claude-1` gom vào `common` sau.

## 8. Contract-first giữa server (Codex) và UI (Claude)

Để UI không phải chờ server và không ai sửa code của ai:
1. Task `a` (Codex) **mở PR contract sớm**: `apps/web/src/server/<area>/index.ts` export hàm có chữ ký đầy đủ + schema zod input/output + mã lỗi, thân hàm có thể `throw new Error('NOT_IMPLEMENTED')`. PR nhỏ này được merge trước, phần cài đặt đi PR sau (cùng mã task, tiêu đề `[T1.4a]` + "contract" trong mô tả; task chỉ tính `done` khi PR cài đặt merge — PR contract dùng tiêu đề `… [T1.4a-contract]`).
2. Task `b` (Claude) dựng UI theo contract; khi `a` chưa xong dùng mock `apps/web/src/server/<area>/mock.ts` (file mới do Claude tạo, được phép — thuộc `touches` ngầm định của mọi task `b`; chỉ chứa dữ liệu giả, **không** chứa logic thật). Khi `a` merge → xoá mock ở PR của `b`.
3. Đổi contract sau khi UI đã dùng là thay đổi phá vỡ: Codex **không** tự sửa code UI gọi tới contract; Codex giữ hàm cũ (đánh dấu `@deprecated`) + thêm hàm mới, ghi "Yêu cầu cho lane khác"; Claude chuyển UI sang hàm mới ở PR riêng; Codex xoá hàm cũ sau đó. Tốt nhất là thiết kế contract đủ ngay từ đầu.

Deps `b → a` trong `tasks.yaml` là mốc để **merge** `b`; `b` được bắt đầu sớm hơn nếu PR contract của `a` đã merge (ghi rõ trong PR `b`).

## 9. Vòng đời một task

1. **Chọn & nhận** (§5): nhánh + draft PR `[Txx]`.
2. **Đọc** mô tả + tiêu chí hoàn thành ở `docs/PLAN.md` §9, Handoff của các PR `deps` (xem bằng `git log origin/main --grep '\[Txx\]' --format=%B` — repo cấu hình squash merge dùng **tiêu đề + mô tả PR** làm commit message nên Handoff nằm luôn trong git log).
3. **Làm** trong vùng cho phép; commit nhỏ, message Conventional Commits.
4. **Kiểm tra** trước khi chuyển ready: `pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check` (+ `pnpm db:reset && pnpm db:test` nếu đụng DB, + E2E liên quan). Tự rà diff: có file ngoài vùng không? có chuỗi cứng không? có bảng thiếu RLS không?
5. **PR ready**: điền template (Agent, Task, tóm tắt, cách kiểm thử, ảnh chụp nếu UI, Handoff, Yêu cầu cho lane khác, Việc cho người).
6. **Review**: người review; có thể nhờ agent khác loại review chéo (Claude review PR Codex và ngược lại) — reviewer chỉ **comment**, không push vào nhánh người khác.
7. **Merge** (người): squash, theo thứ tự phụ thuộc; sau merge, các PR khác đang mở sẽ phải cập nhật `main`.
8. **Kết thúc phiên** agent. Phiên mới → task tiếp theo.

## 10. Việc của người điều phối

- Hằng ngày: `pnpm ai:status` (từ T0.11; trước đó xem danh sách PR) → biết lane nào đang chờ gì.
- Merge theo thứ tự: PR contract → PR nền tảng (DB, tooling) → PR UI. Ưu tiên PR đang chặn nhiều task khác.
- Bật trên GitHub: squash merge only, "Default commit message = Pull request title and description", "Require branches to be up to date before merging", required checks (`ci`, `agent-scope`), xoá nhánh sau merge.
- Khi hai agent vô tình đụng nhau: giữ PR có mã task đúng lane, đóng PR còn lại, ghi lại bài học vào `docs/ai/WORKFLOW.md`.
- Thêm/sửa task (bug từ pilot, task mới): sửa `tasks.yaml` trong PR riêng; gán lane theo §3 (UI → claude-1/claude-2; DB/server → codex-1; platform/collab → claude-3).

## 11. Lịch khởi động M0 (tuần đầu)

Thứ tự merge quan trọng hơn thứ tự làm — nhiều thứ làm được song song ngay từ ngày 1:

| Ngày | claude-1 | claude-2 | codex-1 | claude-3 (trước: codex-2) |
|---|---|---|---|---|
| 1 | chờ T0.1a → soạn trước đề xuất theme/token (không commit) | chờ T0.3a | **T0.4** Supabase local (thư mục độc lập) | **T0.1a** monorepo (merge sớm nhất có thể) |
| 1–2 | **T0.1b** app shell | — | mượn **T0.2** (commitlint, PR template) | **T0.3a** i18n tooling |
| 2–3 | **T0.3b** next-intl trong app | **T0.3c** glossary + skeleton dịch | **T1.1** schema lõi | **T0.5** CI → **T0.11** công cụ agent |
| 3–5 | **T1.2b** UI đăng nhập → **T3.1** extension editor | chờ T0.6a/T1.4a → mượn task stealable nếu có | **T1.2a**, **T1.4a** (contract trước) | **T0.6a**, **T0.7**, **T0.8** (cần người) |

Từ ngày thứ 3–4, `pnpm ai:next` tự đưa mỗi agent tới task tiếp theo; người chỉ cần mở phiên và merge.

## 12. Khác biệt Claude Code và Codex cần lưu ý

| | Claude Code | ChatGPT Codex |
|---|---|---|
| File hướng dẫn tự đọc | `CLAUDE.md` (import `AGENTS.md`), `CLAUDE.md` lồng trong thư mục con | `AGENTS.md` ở gốc và `AGENTS.md` lồng trong thư mục con |
| Làm UI | **Có** (duy nhất) | **Không bao giờ** |
| Tên nhánh | có thể bị môi trường ép → dựa vào `[Txx]` trong tiêu đề PR | tự đặt `<agent>/<id>-<slug>` |

Để chặn Codex ở cấp thư mục, T0.1a/T0.1b tạo thêm `AGENTS.md` ngắn trong `apps/web/src/app/`, `apps/web/src/components/`, `packages/editor/src/extensions/`, `packages/emails/` với nội dung: "Thư mục UI — chỉ Claude Code (`claude-1`/`claude-2`) được sửa. Codex: không sửa file nào ở đây; ghi yêu cầu vào PR." (Ngoại lệ trong `app/`: `api/**`, `auth/callback/**` có `AGENTS.md` riêng cho phép `codex-1`.)
