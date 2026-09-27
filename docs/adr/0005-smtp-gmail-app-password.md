# ADR 0005 — Email giai đoạn 1: Gmail SMTP (`smtp.gmail.com:587`, STARTTLS) bằng App Password của một tài khoản Workspace

- Trạng thái: **Đề xuất — chờ xác minh trên staging** (môi trường agent không mở được kết nối ra `smtp.gmail.com:587` — thử `openssl s_client -starttls smtp` bị timeout; kết luận dựa trên tài liệu Google và PLAN)
- Ngày: 2026-09-27
- Liên quan: `docs/PLAN.md` §7.6 (`SMTP_*`), §7.14, rủi ro R16 · T0.10 điểm (f) · T1.5a (gửi lời mời), T1.7a (email thử) · `infra/coolify/staging/docker-compose.yml` (`SMTP_*` của `kb-web`) · `docs/runbooks/spike-t0.10.md` §f

## Bối cảnh

Supabase self-host không có dịch vụ gửi mail. App dùng Google OAuth, provider email của GoTrue tắt (`GOTRUE_EXTERNAL_EMAIL_ENABLED=false`) → **GoTrue gần như không gửi mail**; email của app (lời mời khách, email thử; V2: thông báo) do `kb-web` gửi qua `SMTP_*`. PLAN §7.14 chọn giai đoạn 1: Gmail SMTP + App Password (không cần admin Workspace, không đổi DNS), giai đoạn 2: Resend với domain `thanhgo.com`.

Điều cần xác minh: (1) tài khoản Workspace của công ty có tạo được App Password không; (2) máy `kb-ops-1` (Hostinger) mở được cổng 587/465 ra ngoài; (3) Gmail nhận đăng nhập SMTP từ IP datacenter và mail tới được hộp thư (không vào spam).

## Quyết định

1. `kb-web` gửi mail qua **`smtp.gmail.com:587` STARTTLS** (`SMTP_PORT=587`, TLS bắt buộc — không cho phép hạ xuống plaintext). `465` (TLS ngay từ đầu) là dự phòng nếu 587 bị chặn.
2. `SMTP_USER` = địa chỉ tài khoản Workspace; `SMTP_PASSWORD` = App Password 16 ký tự (bỏ khoảng trắng); `SMTP_FROM="KB <cùng địa chỉ đó>"` — Gmail **ghi đè** `From` nếu khác địa chỉ đăng nhập hoặc alias đã xác minh ("Send mail as"); `SMTP_REPLY_TO` = người phụ trách.
3. **Không cấu hình SMTP cho GoTrue** ở giai đoạn này (không có luồng email nào của GoTrue được bật). Nếu sau này bật magic link/OTP, dùng cùng thông số (`GOTRUE_SMTP_HOST/PORT/USER/PASS`, `GOTRUE_SMTP_ADMIN_EMAIL`).
4. Tài khoản gửi: ưu tiên tài khoản dùng chung của team (`kb@…`) thay vì tài khoản cá nhân (R16); App Password đặt tên `kb-smtp-staging` / `kb-smtp-prod` (mỗi môi trường một cái để thu hồi riêng), lưu password manager + Coolify (locked).
5. Local/CI không gửi thật: Mailpit của Supabase CLI (`[local_smtp]`, cổng web 54324).

## Phương án dự phòng

| Tình huống                                                                                                  | Xử lý                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Không thấy mục **App passwords** (Workspace bắt buộc security key / Advanced Protection, hoặc 2SV chưa bật) | Bật Xác minh 2 bước cho tài khoản; nếu chính sách công ty vẫn chặn → **giai đoạn 2: Resend** trên `thanhgo.com` (SPF/DKIM/DMARC trong Cloudflare, không cần IT công ty) |
| `535-5.7.8 Username and Password not accepted`                                                              | Sai/thu hồi App Password, hoặc đổi mật khẩu tài khoản (App Password bị huỷ) → tạo lại (runbook)                                                                         |
| Kết nối 587 timeout từ `kb-ops-1`                                                                           | Thử 465; nếu cả hai bị chặn (Hostinger chặn SMTP ra ngoài) → mở ticket Hostinger hoặc Resend qua **HTTPS API** (cổng 443, không phụ thuộc SMTP)                         |
| Google chặn đăng nhập từ IP lạ ("Critical security alert")                                                  | Xác nhận "Yes, it was me" trên tài khoản; nếu lặp lại → Resend                                                                                                          |
| Vượt hạn mức (~2.000 mail/ngày/tài khoản Workspace)                                                         | Không xảy ra với team nhỏ; nếu có → Resend/SES                                                                                                                          |

## Hệ quả

- Không cần admin Workspace, không đổi DNS; SPF/DKIM do Google lo vì mail đi ra từ domain công ty.
- Phụ thuộc một tài khoản (R16): người đó nghỉ/đổi mật khẩu → mail ngừng gửi. `kb-web` phải log lỗi gửi mail (T1.5a) và trang "Gửi email thử" (T1.7a) là cách kiểm tra nhanh.
- Code chỉ đọc `SMTP_*` → chuyển Resend (SMTP `smtp.resend.com:587`, user `resend`, password = API key) chỉ là đổi biến.

## Cách xác minh

`docs/runbooks/spike-t0.10.md` §f: trên `kb-ops-1` chạy `curl` gửi một mail qua `smtp://smtp.gmail.com:587 --ssl-reqd` bằng App Password (không cần code app), kiểm tra hộp thư người nhận (Inbox, không Spam; header `Authentication-Results` có `dkim=pass spf=pass`). Ghi kết quả vào mục dưới, đổi trạng thái thành **Chấp nhận** hoặc chuyển giai đoạn 2.

## Kết quả trên staging

_(người điền)_
