# ADR 0007 — Một môi trường production duy nhất, không staging, không preview theo PR

- Trạng thái: **Chấp nhận** (người điều phối, 2026-10-06)
- Ngày: 2026-10-06
- Liên quan: `docs/PLAN.md` §0, §3.7, §6.5, §7.0–§7.8, §7.12, §7.13, §11 (R4, R8, R12), §12 · ADR 0001 (cập nhật), ADR 0004 (không áp dụng) · task T0.8, T7.3

## Bối cảnh

PLAN gốc có 4 môi trường: local, staging (`kb-staging.thanhgo.com`, máy `kb-ops-1` cùng Coolify), preview theo PR (`kb-pr-<n>`, dùng chung Supabase staging) và production (`kb.thanhgo.com`, máy riêng `kb-prod-1`, deploy khi release và có duyệt).

Thực tế triển khai: chỉ một máy chạy Coolify, và resource dựng theo runbook staging (T0.8) được trỏ vào `kb.thanhgo.com` (biến `KB_WEB_HOST` từ PR #81) — đó là môi trường người dùng thật đang dùng. Không có staging, không có preview, không có máy thứ hai.

## Quyết định

1. **Chỉ có local, CI và production** (`kb.thanhgo.com`, `kb-collab.thanhgo.com`, `kb-api.thanhgo.com`) trên **một VPS** `kb-ops-1` (Coolify + Supabase + kb-web + kb-collab + kb-backup).
2. **Merge vào `main` = deploy production** (`deploy.yml` sau `Build images`). release-please chỉ tạo tag, GitHub Release, changelog và retag image — không có bước deploy riêng khi release.
3. **Bỏ preview theo PR** (`kb-pr-<n>`, `preview-dns.yml`, Application `kb-web-preview`).
4. **Lưới an toàn thay cho staging**:
   - CI + E2E (vi/en) bắt buộc trên mọi PR, Supabase tạm trong GitHub Actions.
   - Migration forward-only, expand → contract, phải chạy được bằng `supabase db reset` + pgTAP ở CI.
   - **Backup `pre-migrate` tự động trước mỗi deploy** (T7.3) + backup hằng đêm lên R2 (T0.9).
   - Rollback = chạy lại Deploy với commit tốt trước đó.
   - PR rủi ro (migration dữ liệu, nâng cấp Supabase): chạy local, có thể với bản restore của backup; snapshot VPS trước nâng cấp hạ tầng.
5. Tên _staging_ còn trong code/cấu hình (`infra/coolify/staging/`, `APP_ENV: staging`, GitHub Environment `staging`, biến `STAGING_*`, `docs/runbooks/staging.md`) được **đổi thành production ở T7.3**, có bước người đổi Coolify/GitHub; cho đến lúc đó cấu hình hiện tại vẫn chạy đúng.

## Hệ quả

- Tốt: một máy, một bộ secret, một luồng deploy — ít việc vận hành và chi phí cho team nhỏ; sửa lỗi lên production ngay sau merge.
- Đánh đổi: không có chỗ thử với dữ liệu/cấu hình giống thật trước khi người dùng thấy. Lỗi lọt qua CI đến thẳng người dùng → backup trước migration và rollback nhanh là bắt buộc, không còn tuỳ chọn.
- Đánh đổi: Coolify chung máy với dữ liệu; Coolify hỏng thì không deploy được (production vẫn chạy). Nâng cấp Coolify/Supabase cần snapshot VPS trước.
- Mở lại: khi cần (nâng cấp lớn, nhiều người dùng hơn), thêm máy thứ hai làm remote server của Coolify và dựng staging bằng chính cấu hình compose hiện tại (ADR 0001); ADR 0004 là tài liệu cho preview.
