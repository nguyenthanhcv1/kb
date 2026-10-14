# Changelog

## [1.2.0](https://github.com/nguyenthanhcv1/kb/compare/v1.1.0...v1.2.0) (2026-10-14)


### Added

* **web:** share a page and its subpages with people outside the space ([#115](https://github.com/nguyenthanhcv1/kb/issues/115)) ([66b979a](https://github.com/nguyenthanhcv1/kb/commit/66b979ac4b38e1b1060bcbabcf27dfa1d917d78a))

<!-- vi-notes:start -->
### Tiếng Việt

#### Thêm

- Chia sẻ trang: quản trị viên không gian có thể cho một người xem hoặc sửa **một trang và các trang con của nó** mà không cần thêm họ vào cả không gian, kể cả người chưa có tài khoản (họ nhận email mời). Bấm **Chia sẻ** ở góc trên bên phải trang để mời, đổi quyền hoặc bỏ chia sẻ.
- Mục **Được chia sẻ với tôi** ở thanh bên liệt kê các trang người khác đã chia sẻ với bạn.
<!-- vi-notes:end -->

## [1.1.0](https://github.com/nguyenthanhcv1/kb/compare/v1.0.1...v1.1.0) (2026-10-14)


### Added

* **auth:** require approval for new accounts and add user groups with Space access ([#111](https://github.com/nguyenthanhcv1/kb/issues/111)) ([36808d6](https://github.com/nguyenthanhcv1/kb/commit/36808d6ba70f602fe9b7d59ba9aabc2b4cb23320))
* **web:** let Space admins give groups access in the members settings ([#113](https://github.com/nguyenthanhcv1/kb/issues/113)) ([172d3bd](https://github.com/nguyenthanhcv1/kb/commit/172d3bd4a288ead7bb3e83b2437848cfc7ab3069))

<!-- vi-notes:start -->
### Tiếng Việt

#### Thêm

- Tài khoản mới phải được quản trị viên duyệt trước khi dùng: trong lúc chờ, người đó chỉ thấy màn hình "Chờ duyệt". Quản trị viên duyệt (chọn người dùng nội bộ hay khách) hoặc từ chối ở trang **Chờ duyệt** trong khu quản trị, và người đó nhận email báo kết quả.
- Nhóm người dùng: quản trị viên tạo nhóm và thêm người dùng nội bộ vào nhóm, rồi cấp quyền truy cập không gian cho cả nhóm thay vì mời từng người.
- Quản trị viên không gian có thể cấp quyền xem hoặc sửa cho nhóm, đổi vai trò hoặc gỡ quyền ở mục **Nhóm có quyền truy cập** trong Cài đặt không gian › Thành viên. Trang quản trị nhóm cho biết mỗi nhóm đang vào được những không gian nào.
<!-- vi-notes:end -->

## [1.0.1](https://github.com/nguyenthanhcv1/kb/compare/v1.0.0...v1.0.1) (2026-10-11)


### Fixed

* **deps:** update Next.js to fix known security vulnerabilities ([#106](https://github.com/nguyenthanhcv1/kb/issues/106)) ([c952cfc](https://github.com/nguyenthanhcv1/kb/commit/c952cfc400ed7ed3f9ddbf2ce3448ad0c26a0a5d))

<!-- vi-notes:start -->
### Tiếng Việt

#### Bảo mật

- Cập nhật thành phần nền của ứng dụng (Next.js) để vá các lỗ hổng bảo mật đã được công bố. Không có thay đổi nào về cách dùng.
<!-- vi-notes:end -->

## 1.0.0 (2026-10-11)


### Added

* **auth:** add Supabase server authentication [T1.2a] ([#14](https://github.com/nguyenthanhcv1/kb/issues/14)) ([21ea1ad](https://github.com/nguyenthanhcv1/kb/commit/21ea1ad082deede97ff48b8e3640207a751b9c70))
* **auth:** let super admins manage the sign-in allowlist and users [T1.7a] ([#37](https://github.com/nguyenthanhcv1/kb/issues/37)) ([45480b0](https://github.com/nguyenthanhcv1/kb/commit/45480b0c8c0ec59c1ca9572b309383404b94969a))
* **auth:** manage the sign-in allowlist and users from the admin pages [T1.7b] ([#42](https://github.com/nguyenthanhcv1/kb/issues/42)) ([fec4613](https://github.com/nguyenthanhcv1/kb/commit/fec461365c7688e43b480e076ab39905c5ebf837))
* **auth:** sign in with Google, access denied page and user menu [T1.2b] ([#12](https://github.com/nguyenthanhcv1/kb/issues/12)) ([9c2a32b](https://github.com/nguyenthanhcv1/kb/commit/9c2a32b6d9104bac829ec29e740b60380c1fbf78))
* **ci:** add CI checks for lint, types, tests, i18n, licenses, database and build [T0.5] ([#16](https://github.com/nguyenthanhcv1/kb/issues/16)) ([b5674a4](https://github.com/nguyenthanhcv1/kb/commit/b5674a4bd13ed23369772ba79e6dff9da9402dc0))
* **collab:** authenticate editors and persist page documents in Postgres [T3.4] ([#24](https://github.com/nguyenthanhcv1/kb/issues/24)) ([fb0da49](https://github.com/nguyenthanhcv1/kb/commit/fb0da4950ed251ec1a5e27189ce066201ed6bfdf))
* **collab:** replace page documents through an authenticated internal API [T3.7] ([#26](https://github.com/nguyenthanhcv1/kb/issues/26)) ([d6445a3](https://github.com/nguyenthanhcv1/kb/commit/d6445a3f31b867a12432a8dd02098919dde9421f))
* **collab:** restore a page version through the internal API [T6.3a] ([#62](https://github.com/nguyenthanhcv1/kb/issues/62)) ([4f8822b](https://github.com/nguyenthanhcv1/kb/commit/4f8822b34472cc5d86a904f3a4931ba6bee2ea68))
* **collab:** save page versions automatically while editing and on demand [T6.1b] ([#51](https://github.com/nguyenthanhcv1/kb/issues/51)) ([16ec033](https://github.com/nguyenthanhcv1/kb/commit/16ec03326aed06dd0adab38ce0716ee0ab78403d))
* **db:** add core schema and RLS [T1.1] ([#7](https://github.com/nguyenthanhcv1/kb/issues/7)) ([d3fab12](https://github.com/nguyenthanhcv1/kb/commit/d3fab12b058ddaf51347f6ab236c4a943cb866b0))
* **db:** add kb_collab role with least-privilege access to page documents [T3.3a] ([#23](https://github.com/nguyenthanhcv1/kb/issues/23)) ([8df80fa](https://github.com/nguyenthanhcv1/kb/commit/8df80fabe616668871c23a2280f4414111f36299))
* **db:** add local Supabase foundation [T0.4] ([#2](https://github.com/nguyenthanhcv1/kb/issues/2)) ([a0d9ea1](https://github.com/nguyenthanhcv1/kb/commit/a0d9ea1681bd151bfbb2a2520fd32a79f388264b))
* **db:** add page tree schema with trash, move checks and audit [T2.1] ([#19](https://github.com/nguyenthanhcv1/kb/issues/19)) ([29d057c](https://github.com/nguyenthanhcv1/kb/commit/29d057c35270aafec8569708c71a56b8d610e6b0))
* **db:** record an audit log of space, member, invitation and access changes [T1.6a] ([#15](https://github.com/nguyenthanhcv1/kb/issues/15)) ([a4dcfeb](https://github.com/nguyenthanhcv1/kb/commit/a4dcfeb42531693d0a01de05ba71d048fa7f063e))
* **db:** store page attachments in a private bucket with Space permissions [T3.6a] ([#45](https://github.com/nguyenthanhcv1/kb/issues/45)) ([8e4da5e](https://github.com/nguyenthanhcv1/kb/commit/8e4da5e78c3207049109793702d2f352cddb6fb4))
* **db:** store page version snapshots with retention [T6.1a] ([#48](https://github.com/nguyenthanhcv1/kb/issues/48)) ([352e173](https://github.com/nguyenthanhcv1/kb/commit/352e173449b6b4ce1f4ed65f764d6adb826d79ee))
* **editor:** add shared editor extensions with stable block IDs [T3.1] ([#9](https://github.com/nguyenthanhcv1/kb/issues/9)) ([10a0906](https://github.com/nguyenthanhcv1/kb/commit/10a0906afe55920dfc30af5f9cc3459c0ddba6ab))
* **editor:** add slash menu, bubble menu, block drag handle and editor shortcuts [T3.2] ([#11](https://github.com/nguyenthanhcv1/kb/issues/11)) ([24305fa](https://github.com/nguyenthanhcv1/kb/commit/24305fa5c84ea39fb6340e956f13ad999e990bb1))
* **editor:** connect the editor to live collaboration with save status [T3.5] ([#56](https://github.com/nguyenthanhcv1/kb/issues/56)) ([81f30cf](https://github.com/nguyenthanhcv1/kb/commit/81f30cf1cd754f53f4621adda564347a0d1a97b8))
* **editor:** draw Mermaid diagrams from mermaid code blocks [T7.14] ([#89](https://github.com/nguyenthanhcv1/kb/issues/89)) ([8582689](https://github.com/nguyenthanhcv1/kb/commit/8582689c14153eb2e81e09eb3787829c8a4389da))
* **editor:** extract page text, headings and tables for search [T3.3b] ([#20](https://github.com/nguyenthanhcv1/kb/issues/20)) ([69e4085](https://github.com/nguyenthanhcv1/kb/commit/69e4085db929d3cf06b07c22b5cdb7e474be34ca))
* **editor:** format pasted Markdown and import .md files into a page [T7.17] ([#96](https://github.com/nguyenthanhcv1/kb/issues/96)) ([3a3983f](https://github.com/nguyenthanhcv1/kb/commit/3a3983ff068a7c27e8eef09b7ca418712fb023e8))
* **editor:** upload images and files by drag-drop and paste [T3.6b] ([#58](https://github.com/nguyenthanhcv1/kb/issues/58)) ([f14a39e](https://github.com/nguyenthanhcv1/kb/commit/f14a39e362eb7dbe4654dd3033885874071a0586))
* **i18n:** switch the interface between Vietnamese and English [T0.3b] ([#10](https://github.com/nguyenthanhcv1/kb/issues/10)) ([9ee360b](https://github.com/nguyenthanhcv1/kb/commit/9ee360bf57f78b861f922a120c6970914fce1377))
* **infra:** add Docker images for web, collab and migrations with health checks [T0.7] ([#21](https://github.com/nguyenthanhcv1/kb/issues/21)) ([a9a0bde](https://github.com/nguyenthanhcv1/kb/commit/a9a0bdea19beaa6bc71ddef33e2ec11d6cf42e2b))
* **infra:** back up the database to Cloudflare R2 with a tested restore runbook [T0.9] ([#34](https://github.com/nguyenthanhcv1/kb/issues/34)) ([90a4dc0](https://github.com/nguyenthanhcv1/kb/commit/90a4dc0bb5bb18fb335ecf0998648de30982f868))
* **infra:** prepare staging deployment on Coolify behind Cloudflare [T0.8] ([#30](https://github.com/nguyenthanhcv1/kb/issues/30)) ([ccdb437](https://github.com/nguyenthanhcv1/kb/commit/ccdb43741cd652a6d0c82cf7c6d77d34e247a9b4))
* **release:** automate releases with release-please and bilingual changelog [T0.6a] ([#27](https://github.com/nguyenthanhcv1/kb/issues/27)) ([0d12474](https://github.com/nguyenthanhcv1/kb/commit/0d12474a14e4c02b4a537d2022ac4b7ac274de8d))
* **search:** add accent-insensitive page search RPC and API [T5.2] ([#61](https://github.com/nguyenthanhcv1/kb/issues/61)) ([72cb32e](https://github.com/nguyenthanhcv1/kb/commit/72cb32e039886f3e6dd12dc863b8e688c442c4a8))
* **search:** index pages for accent-insensitive Vietnamese search [T5.1] ([#47](https://github.com/nguyenthanhcv1/kb/issues/47)) ([5a44aed](https://github.com/nguyenthanhcv1/kb/commit/5a44aedb419dc5c26c3b5cddb5c8cb259154936a))
* **search:** quick switcher and results page [T5.3] ([#64](https://github.com/nguyenthanhcv1/kb/issues/64)) ([7d63f70](https://github.com/nguyenthanhcv1/kb/commit/7d63f706c9b2029c255e53b82fc6ef27830acbd6))
* **table:** drag table rows and columns to reorder them [T4.3] ([#57](https://github.com/nguyenthanhcv1/kb/issues/57)) ([d6eff1a](https://github.com/nguyenthanhcv1/kb/commit/d6eff1a9f0f63600bccc9a89ab57746713619a29))
* **table:** export tables as CSV files [T4.5] ([#29](https://github.com/nguyenthanhcv1/kb/issues/29)) ([e7d1bb9](https://github.com/nguyenthanhcv1/kb/commit/e7d1bb94864a53165bfc1e224f6e0b4cc7f3cc61))
* **table:** insert and edit basic tables [T4.1] ([#31](https://github.com/nguyenthanhcv1/kb/issues/31)) ([fe18755](https://github.com/nguyenthanhcv1/kb/commit/fe18755d4fe90abea4baae2a796415e187812620))
* **table:** merge and split table cells and set cell background colors [T4.2] ([#46](https://github.com/nguyenthanhcv1/kb/issues/46)) ([f96351c](https://github.com/nguyenthanhcv1/kb/commit/f96351cd156e43600b35fce43294891e27b25d6e))
* **table:** parse spreadsheet clipboard data into editor tables [T4.4a] ([#28](https://github.com/nguyenthanhcv1/kb/issues/28)) ([fc3c04b](https://github.com/nguyenthanhcv1/kb/commit/fc3c04be75bbee4b3f39904fe3d6cf125a7b70ea))
* **table:** paste spreadsheet data into editor tables [T4.4b] ([#63](https://github.com/nguyenthanhcv1/kb/issues/63)) ([652658f](https://github.com/nguyenthanhcv1/kb/commit/652658f64a48a2efac4fbaa2dd08f26f2646f45c))
* **web:** add app shell with light/dark theme, sidebar and error pages [T0.1b] ([#8](https://github.com/nguyenthanhcv1/kb/issues/8)) ([0319562](https://github.com/nguyenthanhcv1/kb/commit/03195623ae864d23e80ee73950affdf8d7582e7c))
* **web:** add server actions to create, rename, move, trash, restore and purge pages [T2.2] ([#25](https://github.com/nguyenthanhcv1/kb/issues/25)) ([05e754a](https://github.com/nguyenthanhcv1/kb/commit/05e754af14cf87de9a7c940511161417085db1aa))
* **web:** add Space server actions [T1.4a] ([#17](https://github.com/nguyenthanhcv1/kb/issues/17)) ([a9fee8a](https://github.com/nguyenthanhcv1/kb/commit/a9fee8ae8ca4230b49489d20d6241598952acc46))
* **web:** audit log filters and export [T6.4b] ([#69](https://github.com/nguyenthanhcv1/kb/issues/69)) ([768ff20](https://github.com/nguyenthanhcv1/kb/commit/768ff2054154cbbb7af0e84441094c9b565a4949))
* **web:** browse and reorder pages in the sidebar tree [T2.3] ([#44](https://github.com/nguyenthanhcv1/kb/issues/44)) ([72dfcae](https://github.com/nguyenthanhcv1/kb/commit/72dfcaea87caff86a2d3443baa99aa9fb6884abd))
* **web:** browse, create, configure and archive Spaces [T1.4b] ([#38](https://github.com/nguyenthanhcv1/kb/issues/38)) ([bb3e269](https://github.com/nguyenthanhcv1/kb/commit/bb3e26996ef42589540cfa52adc875f51857dfb3))
* **web:** connect AI assistants (Claude, ChatGPT) over MCP to read and edit pages [T7.13] ([#85](https://github.com/nguyenthanhcv1/kb/issues/85)) ([ff81638](https://github.com/nguyenthanhcv1/kb/commit/ff81638f481a217772de6bc4b26c23ba0818945a))
* **web:** extended audit log queries and CSV export [T6.4a] ([#66](https://github.com/nguyenthanhcv1/kb/issues/66)) ([22c3b3f](https://github.com/nguyenthanhcv1/kb/commit/22c3b3f1bbebf64f248a1a182f8ba8eb38b20745))
* **web:** let users set their language, time zone, name and avatar in settings [T1.3] ([#39](https://github.com/nguyenthanhcv1/kb/issues/39)) ([cce4f2e](https://github.com/nguyenthanhcv1/kb/commit/cce4f2ed2880345a3c1810b1baa86d393c81015e))
* **web:** manage Space members and accept guest invitations [T1.5b] ([#40](https://github.com/nguyenthanhcv1/kb/issues/40)) ([a9fb1d5](https://github.com/nguyenthanhcv1/kb/commit/a9fb1d52cc2e5a089876bb2e55cfea45041da617))
* **web:** manage Space members and invite guests by email [T1.5a] ([#36](https://github.com/nguyenthanhcv1/kb/issues/36)) ([6e2ef4c](https://github.com/nguyenthanhcv1/kb/commit/6e2ef4c9a5848464c4e28d3ce218a1fb17382524))
* **web:** open pages by link, edit their title and icon, and restore them from the trash [T2.4] ([#43](https://github.com/nguyenthanhcv1/kb/issues/43)) ([69f6452](https://github.com/nguyenthanhcv1/kb/commit/69f6452a0b6129260cb464da2ec22244c214e103))
* **web:** open pages for reading, with Edit and Done buttons [T7.16] ([#93](https://github.com/nguyenthanhcv1/kb/issues/93)) ([ba64932](https://github.com/nguyenthanhcv1/kb/commit/ba64932889b4a7b3fd11fd85b81cf63f936b3a2b))
* **web:** redesign shell, home, reading page and editor [T7.18] [T7.19] [T7.20] [T7.21] [T7.22] ([#98](https://github.com/nguyenthanhcv1/kb/issues/98)) ([3a7734d](https://github.com/nguyenthanhcv1/kb/commit/3a7734db09ec0f5dfe9ef1e97d17e585942df164))
* **web:** restore a page version from history [T6.3b] ([#67](https://github.com/nguyenthanhcv1/kb/issues/67)) ([fa1c314](https://github.com/nguyenthanhcv1/kb/commit/fa1c3147a06013534d0943ff03992bf3d5cfd5bc))
* **web:** show a filterable activity log in Space settings [T1.6b] ([#41](https://github.com/nguyenthanhcv1/kb/issues/41)) ([f9f4205](https://github.com/nguyenthanhcv1/kb/commit/f9f42057fe1c9f6ebfb0f34da5493c803bb7f712))
* **web:** show release notes on What's new and the version in the footer and settings [T0.6b] ([#33](https://github.com/nguyenthanhcv1/kb/issues/33)) ([4f7d9e9](https://github.com/nguyenthanhcv1/kb/commit/4f7d9e909cc84ce909f694f67de7f14f250279a3))
* **web:** update the page tree live across tabs [T2.5] ([#55](https://github.com/nguyenthanhcv1/kb/issues/55)) ([0219fa8](https://github.com/nguyenthanhcv1/kb/commit/0219fa8e7b068cbd399a47b3782c2e7d59b0bc81))
* **web:** use the KA Atlas theme with teal accents, an ink sidebar and Vietnamese-ready fonts ([#97](https://github.com/nguyenthanhcv1/kb/issues/97)) ([eaa7a8c](https://github.com/nguyenthanhcv1/kb/commit/eaa7a8ca981e5bf3b528710afa16479eee044d19))
* **web:** view page version history, previews and diffs [T6.2] ([#59](https://github.com/nguyenthanhcv1/kb/issues/59)) ([adc10c7](https://github.com/nguyenthanhcv1/kb/commit/adc10c7e0d53605ac50fa120ab0c8d80ea5c1df3))


### Fixed

* **auth:** keep invited guests signed in until they accept [T7.8] ([#79](https://github.com/nguyenthanhcv1/kb/issues/79)) ([1591707](https://github.com/nguyenthanhcv1/kb/commit/159170706faa012cd9f5e6defce178480a81a20c))
* **auth:** return to the app address after Google sign-in behind a proxy ([#83](https://github.com/nguyenthanhcv1/kb/issues/83)) ([86428eb](https://github.com/nguyenthanhcv1/kb/commit/86428ebfcb9cbbad47914f910a9b690a1814bb0c))
* **auth:** sign in and out with the real company Google account [T7.7] ([#77](https://github.com/nguyenthanhcv1/kb/issues/77)) ([a4a6bc3](https://github.com/nguyenthanhcv1/kb/commit/a4a6bc33f808ca9c1942464e327414bff64dea43))
* **db:** drop the duplicate search migration added by [#53](https://github.com/nguyenthanhcv1/kb/issues/53) [T5.1] ([#54](https://github.com/nguyenthanhcv1/kb/issues/54)) ([bfd4f80](https://github.com/nguyenthanhcv1/kb/commit/bfd4f805903ddc52edbf8016a172e77068b5ab0b))
* **db:** renumber the search migration so migrations apply in order again [T5.1] ([#53](https://github.com/nguyenthanhcv1/kb/issues/53)) ([970d560](https://github.com/nguyenthanhcv1/kb/commit/970d560f108083e974b18e0d05834e7d72435581))
* **editor:** stop saving a page that was only opened ([#92](https://github.com/nguyenthanhcv1/kb/issues/92)) ([3dee110](https://github.com/nguyenthanhcv1/kb/commit/3dee11086582fd6e1d8c9df6ea2029c487dd913f))
* **infra:** give the backup e2e database the storage bucket columns [T3.6a] ([#50](https://github.com/nguyenthanhcv1/kb/issues/50)) ([78e5036](https://github.com/nguyenthanhcv1/kb/commit/78e5036ef79bab71033733fac5c10220da9410d0))
* **infra:** load .env and pass it through in pnpm dev ([#73](https://github.com/nguyenthanhcv1/kb/issues/73)) ([fb7450e](https://github.com/nguyenthanhcv1/kb/commit/fb7450e0e2c51de1efc5434ed42bb1535f279d7d))
* **infra:** make staging hostnames and TLS resolver configurable ([#81](https://github.com/nguyenthanhcv1/kb/issues/81)) ([934055a](https://github.com/nguyenthanhcv1/kb/commit/934055a3596c9976ea4b0a1eef91ed0d0202516d))
* **infra:** pass the public Supabase settings to kb-web on staging ([#82](https://github.com/nguyenthanhcv1/kb/issues/82)) ([008c305](https://github.com/nguyenthanhcv1/kb/commit/008c3050aa800a9a86ad35c678b8b079b4668c9a))
* **search:** give the search migration a unique version after the versions migration [T5.1] ([#52](https://github.com/nguyenthanhcv1/kb/issues/52)) ([8220ba7](https://github.com/nguyenthanhcv1/kb/commit/8220ba7110f9d81a095ffe431ec4d0c3211881c8))
* **web:** list the pages of a space on its home page [T2.4] ([#88](https://github.com/nguyenthanhcv1/kb/issues/88)) ([66ce271](https://github.com/nguyenthanhcv1/kb/commit/66ce2715e1f1ef77802cd751fc2a47bc9ae75bdb))
* **web:** show profile pictures hosted outside the app [T7.2] ([#84](https://github.com/nguyenthanhcv1/kb/issues/84)) ([02ea98f](https://github.com/nguyenthanhcv1/kb/commit/02ea98f5e70e51389f14d38df59f2fa71c7e4078))


### Security

* **web:** add security headers, database rate limits and dependency audit [T7.2] ([#49](https://github.com/nguyenthanhcv1/kb/issues/49)) ([65bc161](https://github.com/nguyenthanhcv1/kb/commit/65bc16111c13fd8434286e86523d673434dd2abc))

<!-- vi-notes:start -->
### Tiếng Việt

#### Thêm

- Bản chính thức đầu tiên của kho kiến thức: đăng nhập bằng tài khoản Google công ty, chỉ những người được quản trị viên cho phép mới vào được.
- Tổ chức nội dung theo **không gian** với phân quyền theo vai trò; mời thành viên và khách bằng email, xem nhật ký hoạt động của từng không gian (có bộ lọc và xuất CSV).
- Cây trang ở thanh bên: tạo, đổi tên, kéo thả sắp xếp, chuyển vào thùng rác và khôi phục; cây tự cập nhật giữa các tab.
- Trình soạn thảo theo khối: menu gõ "/", thanh định dạng, phím tắt, kéo thả khối, tải ảnh và tệp bằng kéo thả hoặc dán, sơ đồ Mermaid, dán văn bản Markdown hoặc nhập tệp `.md` vào trang.
- Bảng đầy đủ: thêm xoá hàng cột, gộp và tách ô, tô màu nền ô, kéo thả hàng và cột, dán dữ liệu từ Excel hoặc Google Sheets, xuất CSV.
- Sửa cùng lúc nhiều người, hiển thị trạng thái lưu; trang mở ở chế độ xem với nút **Sửa** và **Xong**.
- Lịch sử phiên bản của trang: tự động lưu khi sửa, xem trước, so sánh khác biệt và khôi phục.
- Tìm kiếm tiếng Việt gõ không dấu vẫn ra kết quả, mở nhanh bằng Ctrl+K hoặc trang kết quả riêng.
- Giao diện mới (KA Atlas): trang chủ có ô tìm kiếm lớn, thẻ không gian và các trang vừa sửa; trang đọc có đường dẫn, thời gian cập nhật và mục lục "Trong bài này".
- Giao diện tiếng Việt và tiếng Anh, chế độ sáng và tối; chọn ngôn ngữ, múi giờ, tên và ảnh đại diện trong phần cài đặt cá nhân.
- Kết nối trợ lý AI (Claude, ChatGPT) để đọc và sửa trang bằng đúng quyền của bạn.
- Trang **Có gì mới** hiển thị các thay đổi của từng phiên bản; phiên bản hiện tại hiện ở chân thanh bên và trong Cài đặt › Giới thiệu.

#### Sửa lỗi

- Đăng nhập Google quay về đúng địa chỉ ứng dụng, khách được mời không bị đăng xuất trước khi chấp nhận lời mời.
- Mở trang chỉ để xem không còn bị tự lưu thành phiên bản mới.
- Trang chủ của không gian liệt kê đầy đủ các trang; ảnh đại diện lưu ở nơi khác hiển thị bình thường.

#### Bảo mật

- Bổ sung các tiêu đề bảo mật, giới hạn tần suất truy cập và kiểm tra thư viện có lỗ hổng.
<!-- vi-notes:end -->
