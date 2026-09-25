# Glossary — Thuật ngữ vi/en

Bảng thuật ngữ thống nhất cho giao diện, email và tài liệu người dùng của `kb`. Reviewer dùng file này để kiểm tra văn phong khi duyệt chuỗi dịch (`docs/PLAN.md` §5.5).

## Nguyên tắc văn phong

| Chủ đề        | Tiếng Việt                                                                           | English                                                   |
| ------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Xưng hô       | Trung tính, gọi người dùng là "bạn"; không dùng "quý khách", "anh/chị"               | Second person "you"; friendly, plain                      |
| Viết hoa      | Chỉ viết hoa chữ đầu câu và tên riêng: "Tạo không gian", không phải "Tạo Không Gian" | Sentence case: "Create space", not "Create Space"         |
| Nút, mục menu | Động từ + tân ngữ, ngắn: "Lưu", "Mời thành viên"                                     | Verb + object: "Save", "Invite members"                   |
| Câu xác nhận  | Nói rõ hậu quả: "Trang sẽ được chuyển vào thùng rác."                                | State the outcome: "The page will be moved to the trash." |
| Thông báo lỗi | Nói điều đã xảy ra và cách xử lý, không đổ lỗi cho người dùng                        | Say what happened and what to do next                     |
| Dấu câu       | Không có dấu chấm ở nhãn, nút, tiêu đề; có dấu chấm ở câu hoàn chỉnh                 | Same                                                      |
| Dấu ba chấm   | Dùng ký tự `…` (U+2026), vd "Đang lưu…"                                              | Use `…`, e.g. "Saving…"                                   |
| Số lượng      | Dùng ICU `plural`, không ghép chuỗi: `{count, plural, other {# trang}}`              | `{count, plural, one {# page} other {# pages}}`           |
| Ngày giờ, số  | Luôn qua formatter của `next-intl`, không tự định dạng                               | Always use the `next-intl` formatters                     |

Thuật ngữ tiếng Anh vẫn được giữ nguyên trong tiếng Việt nếu người dùng quen dùng hơn bản dịch (vd "email", "link", "Markdown"); khi đó ghi ở cột **Ghi chú**.

## Khái niệm chính

| English                  | Tiếng Việt     | Ghi chú                                           |
| ------------------------ | -------------- | ------------------------------------------------- |
| Knowledge base           | Kho kiến thức  | Tên sản phẩm giữ là `kb`                          |
| Space                    | Không gian     | Viết thường giữa câu: "không gian Kỹ thuật"       |
| Page                     | Trang          |                                                   |
| Subpage / child page     | Trang con      |                                                   |
| Parent page              | Trang cha      |                                                   |
| Page tree                | Cây trang      |                                                   |
| Sidebar                  | Thanh bên      |                                                   |
| Breadcrumb               | Đường dẫn      | Chỉ dùng trong tài liệu; giao diện không cần nhãn |
| Block                    | Khối           |                                                   |
| Table                    | Bảng           |                                                   |
| Cell / row / column      | Ô / hàng / cột |                                                   |
| Header row               | Hàng tiêu đề   |                                                   |
| Merge cells / split cell | Gộp ô / tách ô |                                                   |
| Attachment               | Tệp đính kèm   |                                                   |
| Image                    | Hình ảnh       |                                                   |
| Title                    | Tiêu đề        |                                                   |
| Icon                     | Biểu tượng     |                                                   |
| Draft                    | Bản nháp       |                                                   |
| Template                 | Mẫu trang      | V2                                                |
| Comment                  | Bình luận      | V2                                                |
| Mention                  | Nhắc tên       | V2                                                |

## Thao tác

| English             | Tiếng Việt            | Ghi chú                                        |
| ------------------- | --------------------- | ---------------------------------------------- |
| Create              | Tạo                   | "Tạo trang", "Tạo không gian"                  |
| New page            | Trang mới             |                                                |
| Edit                | Sửa                   | Không dùng "chỉnh sửa" trên nút (dài)          |
| Save                | Lưu                   |                                                |
| Cancel              | Huỷ                   | Viết "Huỷ" (dấu trên `u`), thống nhất toàn app |
| Delete              | Xoá                   | Viết "Xoá", thống nhất toàn app                |
| Move to trash       | Chuyển vào thùng rác  |                                                |
| Delete permanently  | Xoá vĩnh viễn         |                                                |
| Restore             | Khôi phục             | Dùng cho cả thùng rác và phiên bản             |
| Rename              | Đổi tên               |                                                |
| Move                | Di chuyển             | "Di chuyển tới…"                               |
| Duplicate           | Nhân bản              |                                                |
| Copy link           | Sao chép liên kết     |                                                |
| Share               | Chia sẻ               |                                                |
| Archive / unarchive | Lưu trữ / bỏ lưu trữ  | Space đã lưu trữ chỉ đọc                       |
| Search              | Tìm kiếm              |                                                |
| Filter              | Lọc                   |                                                |
| Sort                | Sắp xếp               |                                                |
| Export              | Xuất                  | "Xuất CSV"                                     |
| Import              | Nhập                  |                                                |
| Upload              | Tải lên               |                                                |
| Download            | Tải xuống             |                                                |
| Paste               | Dán                   |                                                |
| Undo / redo         | Hoàn tác / làm lại    |                                                |
| Expand / collapse   | Mở rộng / thu gọn     |                                                |
| Drag and drop       | Kéo thả               |                                                |
| Sign in / sign out  | Đăng nhập / đăng xuất | Không dùng "log in" trong bản en               |
| Sign in with Google | Đăng nhập bằng Google |                                                |

## Người dùng và phân quyền

Giá trị lưu trong DB là **mã** (cột "Mã"); giao diện hiển thị bản dịch.

| Mã           | English             | Tiếng Việt                   | Ghi chú                                               |
| ------------ | ------------------- | ---------------------------- | ----------------------------------------------------- |
| —            | User                | Người dùng                   |                                                       |
| —            | Member              | Thành viên                   | Người có vai trò trong một không gian                 |
| —            | Guest               | Khách mời                    | `profiles.is_guest`; tối đa quyền Sửa                 |
| —            | Super admin         | Quản trị viên hệ thống       | Quản lý truy cập toàn hệ thống                        |
| —            | Role                | Vai trò                      |                                                       |
| —            | Permission          | Quyền                        |                                                       |
| `viewer`     | Viewer (Can view)   | Người xem (Xem)              | Nhãn ngắn trong danh sách chọn: "Xem" / "Can view"    |
| `editor`     | Editor (Can edit)   | Người sửa (Sửa)              | "Sửa" / "Can edit"                                    |
| `admin`      | Admin (Full access) | Quản trị viên (Quản trị)     | "Quản trị" / "Full access"                            |
| `restricted` | Restricted          | Hạn chế                      | Chỉ thành viên thấy; mặc định cho không gian mới      |
| `internal`   | Internal            | Nội bộ                       | Mọi người dùng nội bộ (không phải khách mời) được xem |
| —            | Invitation          | Lời mời                      |                                                       |
| —            | Invite              | Mời                          | "Mời thành viên"                                      |
| —            | Pending invitation  | Lời mời đang chờ             |                                                       |
| —            | Revoke invitation   | Thu hồi lời mời              |                                                       |
| —            | Expired             | Đã hết hạn                   |                                                       |
| —            | Accept invitation   | Nhận lời mời                 |                                                       |
| —            | Access allowlist    | Danh sách được phép truy cập | Trang Quản trị › Truy cập                             |
| `domain`     | Domain              | Tên miền                     |                                                       |
| `email`      | Email               | Email                        |                                                       |

## Tìm kiếm

| English        | Tiếng Việt       | Ghi chú             |
| -------------- | ---------------- | ------------------- |
| Search         | Tìm kiếm         |                     |
| Quick switcher | Chuyển nhanh     | Mở bằng ⌘K / Ctrl K |
| Search results | Kết quả tìm kiếm |                     |
| No results     | Không có kết quả |                     |
| Recent pages   | Trang gần đây    |                     |

## Phiên bản và lịch sử

| Mã            | English         | Tiếng Việt          | Ghi chú                            |
| ------------- | --------------- | ------------------- | ---------------------------------- |
| —             | Version         | Phiên bản           |                                    |
| —             | Version history | Lịch sử phiên bản   |                                    |
| —             | Current version | Phiên bản hiện tại  |                                    |
| —             | Compare         | So sánh             |                                    |
| —             | Changes         | Thay đổi            |                                    |
| `auto`        | Autosave        | Tự động lưu         |                                    |
| `manual`      | Named version   | Phiên bản đặt tên   | Người dùng lưu thủ công và đặt tên |
| `pre_restore` | Before restore  | Trước khi khôi phục |                                    |
| `restore`     | Restored        | Đã khôi phục        |                                    |
| `template`    | From template   | Tạo từ mẫu          |                                    |
| `import`      | Imported        | Đã nhập             |                                    |
| —             | Trash           | Thùng rác           |                                    |

## Quản trị, cài đặt, nhật ký

| English                      | Tiếng Việt                            | Ghi chú                                 |
| ---------------------------- | ------------------------------------- | --------------------------------------- |
| Settings                     | Cài đặt                               |                                         |
| Personal settings            | Cài đặt cá nhân                       |                                         |
| Space settings               | Cài đặt không gian                    |                                         |
| Administration               | Quản trị                              | Khu vực `/admin`                        |
| Profile                      | Hồ sơ                                 |                                         |
| Display name                 | Tên hiển thị                          |                                         |
| Avatar                       | Ảnh đại diện                          |                                         |
| Language                     | Ngôn ngữ                              |                                         |
| Time zone                    | Múi giờ                               |                                         |
| Theme: light / dark / system | Giao diện: sáng / tối / theo hệ thống |                                         |
| Audit log                    | Nhật ký hoạt động                     | Nhãn hành động lấy từ namespace `audit` |
| Actor                        | Người thực hiện                       |                                         |
| Action                       | Hành động                             |                                         |
| About                        | Giới thiệu                            | Settings › Giới thiệu                   |
| What's new                   | Có gì mới                             | Trang changelog trong app               |
| Version (app release)        | Phiên bản                             | Ghi `v1.2.0`, không dịch số             |
| Release notes                | Ghi chú phát hành                     |                                         |

## Trạng thái và thông báo

| English               | Tiếng Việt                  | Ghi chú |
| --------------------- | --------------------------- | ------- |
| Loading…              | Đang tải…                   |         |
| Saving…               | Đang lưu…                   |         |
| Saved                 | Đã lưu                      |         |
| Offline               | Mất kết nối                 |         |
| Reconnecting…         | Đang kết nối lại…           |         |
| Read-only             | Chỉ xem                     |         |
| Something went wrong  | Đã có lỗi xảy ra            |         |
| Not found             | Không tìm thấy              |         |
| You don't have access | Bạn không có quyền truy cập |         |
| Try again             | Thử lại                     |         |
