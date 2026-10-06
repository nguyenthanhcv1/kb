# Kết nối trợ lý AI (Claude, ChatGPT) qua MCP

KB có máy chủ **MCP** (Model Context Protocol). Khi kết nối, trợ lý AI tìm, đọc, tạo, sửa, di chuyển và xoá (vào thùng rác) trang **bằng đúng quyền của bạn**: Space nào bạn chỉ xem thì trợ lý cũng chỉ xem.

Địa chỉ máy chủ có trong **Cài đặt › Trợ lý AI (MCP)**, dạng `https://<địa-chỉ-kb>/api/mcp`.

## Claude (claude.ai, Claude Desktop, ứng dụng di động)

1. Claude › **Cài đặt › Trình kết nối** (Connectors) › **Thêm trình kết nối tùy chỉnh**.
2. Đặt tên (vd `KB`), dán địa chỉ máy chủ MCP, bấm **Thêm**, rồi **Kết nối**.
3. Trình duyệt mở KB: đăng nhập nếu cần, chọn **Chỉ đọc** hoặc **Đọc và sửa**, bấm **Cho phép**.

Gói Team/Enterprise: quản trị viên tổ chức Claude thêm trình kết nối một lần, từng người bấm **Kết nối**.

## ChatGPT

1. ChatGPT › **Cài đặt › Ứng dụng và trình kết nối › Nâng cao** › bật **Chế độ nhà phát triển**.
2. **Tạo** trình kết nối: dán địa chỉ máy chủ MCP, xác thực **OAuth**.
3. Đăng nhập KB và bấm **Cho phép** như trên.

## Claude Code và ứng dụng dùng header

1. **Cài đặt › Trợ lý AI (MCP) › Tạo token cá nhân**: đặt tên, chọn quyền và thời hạn. Sao chép token ngay — token chỉ hiện một lần.
2. Chạy:

   ```bash
   claude mcp add --transport http kb https://<địa-chỉ-kb>/api/mcp --header "Authorization: Bearer <TOKEN>"
   ```

## Trợ lý làm được gì

| Công cụ                                    | Việc                                    |
| ------------------------------------------ | --------------------------------------- |
| `list_spaces`, `list_pages`                | Xem các Space và cây trang              |
| `search_pages`                             | Tìm kiếm (gõ không dấu vẫn ra)          |
| `get_page`                                 | Đọc trang dưới dạng Markdown            |
| `create_page`, `update_page`               | Tạo trang, sửa tiêu đề/icon/nội dung    |
| `move_page`, `delete_page`, `restore_page` | Di chuyển, đưa vào thùng rác, khôi phục |

- Nội dung trao đổi bằng Markdown (tiêu đề, danh sách, bảng, khối mã, ảnh, callout dạng `> [!NOTE]`). Ô gộp, màu nền ô và độ rộng cột không có trong Markdown: trợ lý sửa đoạn khác thì bảng đó giữ nguyên.
- Mọi thay đổi ghi vào lịch sử phiên bản và nhật ký như khi bạn sửa. Người đang mở trang thấy thông báo "Trang vừa được trợ lý AI cập nhật".
- Trợ lý không xoá vĩnh viễn trang.

## Thu hồi

**Cài đặt › Trợ lý AI (MCP) › Kết nối đang hoạt động › Thu hồi**: trợ lý mất quyền ngay. Bị gỡ khỏi danh sách truy cập hoặc bị khoá tài khoản thì mọi kết nối cũng ngừng.
