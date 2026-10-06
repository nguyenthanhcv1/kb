# Connect AI assistants (Claude, ChatGPT) over MCP

KB runs an **MCP** (Model Context Protocol) server. Once connected, an AI assistant can search, read, create, edit, move and delete (to the trash) pages **with exactly your permissions**: in a Space where you can only view, so can the assistant.

The server address is in **Settings › AI assistants (MCP)**: `https://<your-kb>/api/mcp`.

## Claude (claude.ai, Claude Desktop, mobile apps)

1. Claude › **Settings › Connectors** › **Add custom connector**.
2. Give it a name (e.g. `KB`), paste the MCP server address, click **Add**, then **Connect**.
3. KB opens in the browser: sign in if needed, choose **Read only** or **Read and edit**, click **Allow**.

Team/Enterprise plans: a Claude organization admin adds the connector once, then each person clicks **Connect**.

## ChatGPT

1. ChatGPT › **Settings › Apps & Connectors › Advanced** › turn on **Developer mode**.
2. **Create** a connector: paste the MCP server address, authentication **OAuth**.
3. Sign in to KB and click **Allow** as above.

## Claude Code and other apps that send a header

1. **Settings › AI assistants (MCP) › Create a personal token**: name, access and lifetime. Copy the token right away — it is shown only once.
2. Run:

   ```bash
   claude mcp add --transport http kb https://<your-kb>/api/mcp --header "Authorization: Bearer <TOKEN>"
   ```

## What the assistant can do

| Tool                                       | Does                                         |
| ------------------------------------------ | -------------------------------------------- |
| `list_spaces`, `list_pages`                | List Spaces and the page tree                |
| `search_pages`                             | Search (works without Vietnamese diacritics) |
| `get_page`                                 | Read a page as Markdown                      |
| `create_page`, `update_page`               | Create pages, change title/icon/content      |
| `move_page`, `delete_page`, `restore_page` | Move, send to the trash, restore             |

- Content is exchanged as Markdown (headings, lists, tables, code blocks, images, callouts as `> [!NOTE]`). Merged cells, cell colours and column widths have no Markdown form: edits elsewhere on the page leave such a table untouched.
- Every change lands in the version history and audit log just like your own edits. People who have the page open see "An AI assistant just updated this page".
- Assistants never delete pages for good.

## Revoking access

**Settings › AI assistants (MCP) › Active connections › Revoke**: the assistant loses access immediately. Being removed from the access list or deactivated also stops every connection.
