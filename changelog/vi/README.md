# Ghi chú phát hành tiếng Việt

`CHANGELOG.md` (tiếng Anh) do release-please sinh; workflow `release-vi-notes.yml` chèn ghi chú tiếng
Việt vào đó thành khối `### Tiếng Việt`, và trang **Có gì mới** đọc nó qua
`apps/web/src/generated/changelog.json`.

Quy trình đầy đủ: [`docs/runbooks/release.md`](../../docs/runbooks/release.md).

## Mỗi PR `feat`/`fix` kèm một ghi chú — `unreleased/<tên-ngắn>.md`

PR có tiêu đề `feat`, `fix`, `perf`, `revert` hoặc `security` (hiện ở trang Có gì mới) thêm **một file**
`changelog/vi/unreleased/<tên-ngắn>.md`, vd `unreleased/chia-se-trang.md`:

```md
### Thêm

- Bạn có thể chia sẻ một trang và các trang con với người ngoài không gian.
```

- Check `agent-scope` đỏ nếu PR như vậy thiếu file này (PR `Agent: human`: chỉ cảnh báo). PR `chore`,
  `docs`, `ci`, `test`, `refactor` không cần.
- Mỗi PR một file riêng (tên theo việc, không theo version) nên các PR song song không xung đột.
- Trên Release PR, `release-vi-notes` **gộp** mọi file trong `unreleased/` thành `<version>.md` (gom theo
  mục, theo thứ tự tên file), xoá các file đó rồi chèn vào `CHANGELOG.md` — không cần PR ghi chú riêng.
- Sửa ghi chú khi PR chưa phát hành: sửa file trong `unreleased/` qua PR thường.

## `<version>.md` — ghi chú của một bản

Thường do workflow sinh từ `unreleased/`. Viết tay (copy [`_template.md`](_template.md)) khi muốn bản
tổng quan thay cho phần gộp, vd `1.0.0.md` "bản chính thức đầu tiên": file viết tay được dùng nguyên, các
file trong `unreleased/` bị bỏ — đưa ý cần giữ vào file viết tay.

## Cách viết

- Dùng ba mục `### Thêm`, `### Thay đổi`, `### Sửa lỗi` (thêm `### Bảo mật`, `### Gỡ bỏ` nếu cần); ghi
  chú trong `unreleased/` thường chỉ có một mục. Nội dung không nằm dưới mục nào được xếp vào
  `### Thay đổi`. Tiêu đề được tự hạ cấp khi chèn vào `CHANGELOG.md`, nên cứ viết `###`.
- Mỗi gạch đầu dòng là một câu người dùng hiểu được, nói về lợi ích — không nhắc tên file, mã task,
  scope commit. Tham khảo tiêu đề PR (dòng `Added`/`Fixed` trong Release PR).
- Thuật ngữ theo [`docs/glossary.md`](../../docs/glossary.md) (Space = "Không gian", Page = "Trang"…),
  xưng "bạn".
- Bản không có thay đổi nào người dùng thấy được (chỉ `perf` nội bộ…): vẫn cần ghi chú, vd
  `- Cải thiện độ ổn định.`
- Chỉ tên file dạng `<semver>.md` được trang Có gì mới đọc; README, `_template.md`, `unreleased/` bị bỏ
  qua.
