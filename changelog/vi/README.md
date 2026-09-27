# Ghi chú phát hành tiếng Việt

Mỗi phiên bản có một file `changelog/vi/<version>.md` (vd `0.3.0.md`) viết **cho người dùng**, bằng
tiếng Việt. `CHANGELOG.md` (tiếng Anh) do release-please sinh; workflow `release-vi-notes.yml` chèn
file này vào đó thành khối `### Tiếng Việt`, và trang **Có gì mới** đọc nó qua
`apps/web/src/generated/changelog.json`.

Quy trình đầy đủ: [`docs/runbooks/release.md`](../../docs/runbooks/release.md).

## Cách viết

- Bắt đầu từ [`_template.md`](_template.md): copy thành `<version>.md`, xoá mục không dùng.
- Dùng ba mục `### Thêm`, `### Thay đổi`, `### Sửa lỗi` (thêm `### Bảo mật`, `### Gỡ bỏ` nếu cần).
  Tiêu đề được tự hạ cấp khi chèn vào `CHANGELOG.md`, nên cứ viết `###`.
- Mỗi gạch đầu dòng là một câu người dùng hiểu được, nói về lợi ích — không nhắc tên file, mã task,
  scope commit. Tham khảo mục `Added`/`Fixed` trong Release PR.
- Thuật ngữ theo [`docs/glossary.md`](../../docs/glossary.md) (Space = "Không gian", Page = "Trang"…),
  xưng "bạn".
- Không có thay đổi nào người dùng thấy được (bản vá nội bộ): vẫn phải có file, vd
  `- Cải thiện độ ổn định.`
- Chỉ tên file dạng `<semver>.md` được đọc; README và `_template.md` bị bỏ qua.
