# ADR 0006 — Chất lượng và hiệu năng tìm kiếm: golden set 30 truy vấn, benchmark 20k trang, sửa đường truy vấn dưới RLS

- Trạng thái: **Đã chấp nhận — số liệu đo trên PostgreSQL 16 thường, cần chạy lại trên Supabase local/staging** (môi trường agent không có Docker nên không chạy được `supabase start`; xem "Môi trường đo")
- Ngày: 2026-10-01
- Liên quan: `docs/PLAN.md` §4.4 (xếp hạng), §8 (chỉ tiêu: MRR ≥ 0,8, p95 < 300 ms với 20k trang), rủi ro R6 · T5.2 (`search_pages`) · `scripts/seed-perf.ts`, `scripts/search-bench.ts`, `supabase/tests/search_quality/` · migration `20260930090000_search_ranked_perf.sql`

## Bối cảnh

T5.2 đưa RPC `public.search_pages` (SECURITY INVOKER) vào. T5.4 phải chứng minh hai chỉ tiêu của PLAN: **MRR ≥ 0,8** trên bộ 30 truy vấn thực tế và **p95 < 300 ms** với 20.000 trang, rồi tinh chỉnh hệ số nếu chưa đạt.

## Bộ công cụ đã thêm

| Thành phần                                      | Mục đích                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `supabase/tests/search_quality/anchors.json`    | 26 trang "đáp án" viết tay (nghỉ phép, VPN, bảng phụ cấp, danh sách nhân sự, sự cố production…)                                                                                                                                                  |
| `supabase/tests/search_quality/golden.json`     | 30 truy vấn: không dấu, có dấu, NFD, cụm từ `"…"`, tiền tố, gõ sai, trong tiêu đề phụ, trong bảng, mã `NV-20418`, loại trừ `-từ`; mỗi truy vấn có trang đúng (`expect`) và trang không được xuất hiện (`forbid`)                                 |
| `supabase/tests/search_quality/golden.test.sql` | pgTAP (sinh từ hai file JSON bằng `node scripts/search-golden-sql.ts`): MRR ≥ 0,8 trên corpus 26 trang và không có trang `forbid`; chạy trong `pnpm db:test` để chặn hồi quy xếp hạng                                                            |
| `scripts/seed-perf.ts`                          | sinh xác định (seed cố định) 20.000 trang: 26 anchor + 19.974 trang nền (tiêu đề, đề mục, 4–20 câu, ~15% có bảng `NV-xxxxx`), 6 Space (4 internal, 2 restricted — người đo là thành viên của 1, không thấy 1, ~10% trang nằm ở Space không thấy) |
| `scripts/search-bench.ts`                       | chạy 30 truy vấn bằng vai trò `authenticated` (RLS bật, xoá bộ đếm rate limit trước mỗi lần gọi), 1 lần khởi động + 5 lần đo mỗi truy vấn; in MRR, hit@1/3, p50/p95/max; thoát mã 1 nếu không đạt                                                |
| `scripts/search-quality.test.mjs`               | test offline (`pnpm test:scripts`): golden hợp lệ, corpus xác định, từ vựng trang nền không chứa thuật ngữ của anchor, phép tính MRR/percentile, file pgTAP đã sinh khớp JSON                                                                    |

Tái hiện:

```bash
supabase start && pnpm db:reset
pnpm search:seed      # ~45 s; DATABASE_URL mặc định postgresql://postgres:postgres@127.0.0.1:54322/postgres
pnpm search:bench     # --repeats N, --json
```

Corpus nền cố ý dùng từ vựng chung (nhân viên, khách hàng, báo cáo, kế hoạch…) để có nhiễu thật nhưng tránh các cụm đặc trưng của anchor, nên mỗi truy vấn có đáp án rõ ràng.

## Kết quả

### Môi trường đo

PostgreSQL **16.14** (gói Ubuntu, không phải image Supabase PG 15.x), 1 container Linux nhỏ, `shared_buffers` mặc định 128 MB, schema được dựng bằng chính các migration của repo với phần stub tối thiểu cho `auth`/`storage`/role Supabase (không có `vector`). Mọi test pgTAP liên quan (`search`, `search_rpc`, `rate_limits`, `000_rls_enabled`, `search_quality`) đều pass trên cấu hình này. Thời gian là thời gian thực thi **trong database** của RPC (không gồm PostgREST, mạng, Next.js). Cần chạy lại bằng `pnpm search:bench` trên Supabase local/staging trước khi coi là số chính thức.

### Chất lượng (corpus 20.000 trang, 30 truy vấn)

| Chỉ số                   | Kết quả     | Mục tiêu |
| ------------------------ | ----------- | -------- |
| MRR                      | **1,000**   | ≥ 0,8    |
| hit@1 / hit@3            | 1,00 / 1,00 | —        |
| Trang `forbid` xuất hiện | 0           | 0        |

**Không cần đổi hệ số** (`0,5 / 0,4 / 0,3 / 0,05` của PLAN §4.4 giữ nguyên). Cảnh báo trung thực: corpus và golden set do cùng một tác giả viết, trang nền được thiết kế để không trùng cụm đặc trưng, nên MRR 1,0 là cận trên dễ đạt; đây là lưới chặn hồi quy chứ chưa phải đo chất lượng trên dữ liệu thật. **Việc cho người:** khi có nội dung thật (hoặc sau khi dùng thử nội bộ), bổ sung vào `golden.json` các truy vấn người dùng thực sự gõ (viết tắt như "NP", từ ghép nhiều nghĩa) rồi chạy lại.

### Hiệu năng

|                                    | p50      | p95          | max      | Đạt < 300 ms |
| ---------------------------------- | -------- | ------------ | -------- | ------------ |
| T5.2 nguyên trạng                  | 1.877 ms | 2.282 ms     | 5.623 ms | **Không**    |
| Sau migration `search_ranked_perf` | 32,1 ms  | **177,5 ms** | 226,2 ms | Có           |

Truy vấn từ chung chung khớp gần hết corpus (ngoài golden set), sau sửa: `nhan vien` 216 ms, `bao cao` 233 ms, `kế hoạch` 369 ms, `n` (tiền tố 1 ký tự) 270 ms, `khach hang doanh nghiep` 64 ms. Nghĩa là truy vấn rất rộng vẫn có thể vượt 300 ms ở 20k trang — xem "Rủi ro còn lại".

## Nguyên nhân chậm và quyết định

`EXPLAIN` của T5.2 cho thấy `Seq Scan on page_search` với `Filter: (NOT is_deleted) AND (app.page_row_role(space_id, page_id) IS NOT NULL) AND (tsv @@ …)`, `Rows Removed by Filter: 19999`, ~1,8 s; chạy cùng câu bằng superuser (không RLS) dùng `Bitmap Index Scan` trên `page_search_tsv_idx`, 0,14 ms. Hai nguyên nhân cộng lại:

1. Dưới RLS, planner chỉ được đẩy toán tử **leakproof** xuống trước điều kiện policy. `tsvector @@ tsquery` và trigram `%` không leakproof → không dùng được GIN, buộc quét tuần tự.
2. `app.page_row_role()` tốn ~90 µs/dòng (tra vai trò theo Space), bị gọi cho **mọi** dòng.

**Quyết định:** thêm `app.search_ranked()` (SECURITY DEFINER, `STABLE`, `set search_path = ''`) làm bước khớp + xếp hạng bằng index, và `public.search_pages` gọi nó. Giữ nguyên các điều kiện an toàn:

- `search_ranked` chỉ đọc các Space mà `app.can_view_space()` đúng cho người gọi (chính quy tắc của policy `spaces_select`/`page_search_select`, dùng `auth.uid()` của người gọi) và loại trang đã xoá; tham số `space_ids` chỉ **thu hẹp** tập Space đó chứ không mở rộng.
- Hàm chỉ trả `page_id, space_id, title, last_edited_at, score`; `search_pages` vẫn là SECURITY INVOKER nên snippet, `match_in` lấy qua `page_documents` dưới RLS của người gọi.
- Chỉ `authenticated` được `EXECUTE`; `anon`/`public` bị thu hồi.
- Test pgTAP có sẵn của T5.2 (ma trận vai trò/khách mời, rate limit) pass nguyên vẹn sau thay đổi.

Hàm giữ ràng buộc "không lặp logic quyền" bằng cách dùng helper `app.can_view_space`, không viết lại điều kiện.

## Phương án đã cân nhắc

| Phương án                                                               | Vì sao không chọn                                                                                              |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Đánh dấu `ts_match_vq`/`similarity_op` là `LEAKPROOF`                   | Cần superuser trên hàm hệ thống/extension, không áp dụng được qua migration ở Supabase managed/self-host chuẩn |
| Bỏ RLS trên `page_search`, tự lọc trong RPC                             | Phá nguyên tắc "RLS cho mọi bảng"; mất lớp bảo vệ nếu có đường truy cập khác                                   |
| Làm toàn bộ `search_pages` SECURITY DEFINER                             | Snippet/`match_in` sẽ đọc `page_documents` bỏ qua RLS; rủi ro rò rỉ lớn hơn                                    |
| Cột `space_id` được denormalize + policy chỉ dùng `space_id = any(...)` | Đổi policy của bảng đã merge, rộng hơn phạm vi T5.4; có thể xét lại ở T7.1                                     |

## Rủi ro còn lại và việc tiếp theo

- Truy vấn rất rộng (từ xuất hiện trong gần mọi trang) vẫn tính `ts_rank_cd` trên toàn bộ tập khớp: 200–370 ms ở 20k trang. Hướng xử lý nếu thực tế gặp: giới hạn tập ứng viên bằng truy vấn con có `LIMIT` theo điểm rẻ (vd. chỉ title/headings) trước khi xếp hạng đầy đủ; hoặc từ chối/cắt truy vấn một ký tự ở UI. Chưa làm ở T5.4 vì golden set và chỉ tiêu PLAN đã đạt và để tránh đổi công thức xếp hạng khi chưa có dữ liệu thật.
- Chưa đo trên Supabase thật, PG 15, nhiều kết nối đồng thời, và cache lạnh (lần chạy đầu của mỗi truy vấn đã bị loại bằng lượt khởi động).
- Thời gian đo là thời gian DB; thêm PostgREST + mạng + Next.js khoảng vài chục ms.
