import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { appInfo } from "@/lib/env";

import { runTool, type ToolContext, TOOLS } from "./tools";

/** Shown to the assistant when it connects (MCP `instructions`). */
export const SERVER_INSTRUCTIONS =
  "Tools for the company knowledge base (kb). Pages live in spaces and form a tree. " +
  "Find content with search_pages or list_spaces → list_pages, read it with get_page, and " +
  "write with create_page / update_page / move_page / delete_page (trash, restorable). " +
  "Everything runs with the signed-in user's permissions. Content is Markdown. " +
  "Answer in the user's language; pages are mostly in Vietnamese.";

/**
 * One stateless MCP server per HTTP request (Streamable HTTP, JSON responses, no sessions):
 * nothing is kept between requests, so any kb-web instance can answer. Read-only connections do
 * not see the writing tools at all.
 */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "kb", title: "KB", version: appInfo().version },
    { instructions: SERVER_INSTRUCTIONS },
  );
  for (const [name, definition] of Object.entries(TOOLS)) {
    if (definition.write && ctx.principal.scope !== "write") continue;
    server.registerTool(
      name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: { title: definition.title, openWorldHint: false, ...definition.annotations },
      },
      async (input: unknown) => {
        const outcome = await runTool(ctx, name, input);
        const payload = outcome.ok ? outcome.result : outcome.error;
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          ...(outcome.ok ? {} : { isError: true }),
        };
      },
    );
  }
  return server;
}

export async function handleMcpRequest(request: Request, ctx: ToolContext): Promise<Response> {
  const server = createMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    void server.close();
  }
}
