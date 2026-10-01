# Runbook — E2E (Playwright)

> Task **T7.1b**. Hạ tầng: `.github/workflows/e2e.yml`, `apps/web/playwright.config.ts`, `apps/web/e2e/support/*`, `apps/web/e2e/global-setup.ts`.
> Nội dung các luồng E2E là việc của T7.1c (editor + bảng) và T7.1d (Space, cây, tìm kiếm, lịch sử, ngôn ngữ).

## 1. CI

- Workflow **E2E** chạy trên mọi PR, `merge_group`, push `main`. Một job matrix `e2e (vi)` và `e2e (en)` (mỗi job có Supabase local riêng), job gom kết quả tên **`e2e`**.
- Mỗi job: `supabase start` (migration + seed) → `pnpm build` → chạy kb-collab + kb-web **bản production** → Playwright (Chromium) với `E2E_LOCALE=vi|en`.
- Cuối job: grep log kb-web tìm `MISSING_MESSAGE`/`INVALID_MESSAGE` của next-intl → có là đỏ. Trong trình duyệt, fixture `e2e/support/test.ts` làm test đỏ khi console có lỗi message hoặc `pageerror`.
- Lỗi → upload artifact `e2e-<locale>-report` (HTML report, trace, video, screenshot) và `e2e-<locale>-server-logs` (14 ngày). Mở trace: `pnpm --filter @kb/web exec playwright show-trace <trace.zip>`.

## 2. Chạy local

```bash
supabase start && eval "$(supabase status -o env | sed 's/^/export /')"
export E2E_SUPABASE_URL=$API_URL E2E_SUPABASE_ANON_KEY=$ANON_KEY E2E_SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
pnpm dev                                   # hoặc bản build: pnpm build && pnpm --filter @kb/web start
cd apps/web
E2E_LOCALE=en pnpm exec playwright test    # E2E_LOCALE mặc định vi; E2E_BASE_URL mặc định http://localhost:3000
pnpm exec playwright test e2e/smoke --ui   # chạy 1 spec có UI
```

Không đặt `E2E_SUPABASE_*` thì không có người dùng đăng nhập và các spec cần phiên (`E2E_STORAGE_STATE`) tự skip. Muốn dùng phiên có sẵn: đặt `E2E_STORAGE_STATE`.

## 3. Công cụ cho spec

| File                      | Dùng để                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/support/test.ts`     | `test`/`expect` có guard i18n (MISSING_MESSAGE, pageerror). **Spec mới import từ đây.**                                                               |
| `e2e/support/env.ts`      | `e2eLocale()`, `baseUrl()`, `supabaseEnv()`                                                                                                           |
| `e2e/support/auth.ts`     | `allowEmail`, `createUser`, `signInCookies` (cookie đúng định dạng `@supabase/ssr`), `adminFetch` — tạo thêm người dùng (viewer, khách) cho từng test |
| `e2e/support/messages.ts` | `message(locale, namespace)` — lấy nhãn từ file message, không viết chuỗi cứng trong test                                                             |
| `e2e/global-setup.ts`     | tạo người dùng nội bộ `e2e-internal@kb.test`, ghi `.auth/internal.json`, đặt `E2E_STORAGE_STATE`                                                      |

Spec cũ (T1–T6) vẫn dùng `@playwright/test` và tự lặp vi/en bên trong; khi chạy trong CI cả hai job đều chạy chúng — chấp nhận được, T7.1c/d sẽ gom về `e2e/support/test.ts` + `E2E_LOCALE`.

## 4. Quy tắc chống flaky

1. Chỉ dùng assertion web-first (`await expect(locator).toBeVisible()`…); **không** `waitForTimeout`, không `sleep`.
2. Locator theo role/label lấy từ message (`getByRole("button", { name: m.space.create })`); không CSS class, không `nth` nếu tránh được.
3. Dữ liệu duy nhất cho mỗi test (hậu tố `Date.now().toString(36)` + locale); không phụ thuộc thứ tự test hay dữ liệu test khác để lại. Spec dùng chung 1 trang: `test.describe.configure({ mode: "serial" })`.
4. Chờ trạng thái, không chờ thời gian: URL (`toHaveURL`), `aria-current`, toast, `expect.poll` cho dữ liệu dẫn xuất (search index, version).
5. Editor/collab: chờ editor sẵn sàng (có thể sửa) và trạng thái đã đồng bộ trước khi thao tác; không gõ ngay sau `goto`.
6. Timeout: test 60 s, expect 10 s, action 15 s, navigation 30 s (`playwright.config.ts`). Cần hơn → sửa nguyên nhân, đừng nâng timeout toàn cục.
7. CI retry 2 lần; test qua nhờ retry được báo `flaky` (warning trong job). Tiêu chí T7.1: xanh ổn định 10 lần liên tiếp — gặp flaky thì sửa trước khi merge, không tăng retry.
8. `test.only` làm CI đỏ (`forbidOnly`).

## 5. Việc cho người

- [ ] GitHub › Settings › Branches › rule `main`: thêm required status check **`e2e`** (job gom kết quả; không chọn `e2e (vi)`/`e2e (en)` riêng).
- [ ] Sau vài lần chạy thật: kiểm tra thời lượng job và tinh chỉnh `timeout-minutes`/`workers` nếu cần.
