import {
  applyBlockEdits,
  assertValidDocument,
  assignBlockIds,
  type BlockEdit,
  BlockEditError,
  docToMarkdown,
  listBlocks,
  markdownToDoc,
  reuseUnchangedBlocks,
} from "@kb/editor/markdown";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JSONContent } from "@tiptap/core";
import { z } from "zod";

import { pageHref, parsePageRef } from "@/lib/page-href";
import { CollabError, replaceDocument, type ReplaceDocumentInput } from "@/server/collab";
import {
  createPage,
  getPageByShortId,
  getPageContent,
  getPageSummary,
  listChildPages,
  listPageAncestors,
  movePage,
  PAGE_TITLE_MAX_LENGTH,
  PageError,
  type PageSummary,
  renamePage,
  restorePage,
  setPageIcon,
  trashPage,
} from "@/server/pages";
import { searchPages, SearchError } from "@/server/search";
import { withPageLinks } from "@/server/search/links";
import { listSpaces, type SpaceDb, SpaceError } from "@/server/space";

import type { McpPrincipal } from "./oauth";

/**
 * Tools the MCP connector offers to AI assistants (Claude, ChatGPT…). Each runs with the user's
 * own Supabase client (`createUserClient`), so RLS decides what they may see and change exactly
 * as in the app; page content is written through kb-collab (`replaceDocument`) like every other
 * content change. Content is exchanged as Markdown (`@kb/editor/markdown`).
 *
 * Descriptions are written for the model (English, not shown in the kb UI); results are JSON,
 * errors carry the same codes as the app (`{ "error": "PAGE_NOT_FOUND" }`).
 */

export interface ToolContext {
  db: SupabaseClient;
  principal: McpPrincipal;
  /** Public origin of kb-web, for absolute page URLs. */
  origin: string;
  replaceDocument?: (input: ReplaceDocumentInput) => Promise<unknown>;
}

export class ToolError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "ToolError";
  }
}

/** Biggest Markdown a single call may send (kb-collab accepts 8 MB of JSON). */
export const MAX_MARKDOWN_LENGTH = 500_000;
/** Pages returned by one `list_pages` call. */
export const MAX_LISTED_PAGES = 300;

const markdown = z.string().max(MAX_MARKDOWN_LENGTH);
const pageRefInput = z
  .string()
  .min(1)
  .max(2000)
  .describe("Page id (UUID), 8-character short id, or the page URL / path (…/p/<slug>-<shortId>).");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireWrite(ctx: ToolContext) {
  if (ctx.principal.scope !== "write") throw new ToolError("MCP_READ_ONLY");
}

/** UUID, short id, `<slug>-<shortId>` or a URL/path containing `/p/<ref>`. */
async function resolvePage(ctx: ToolContext, ref: string): Promise<PageSummary> {
  const value = ref.trim();
  if (UUID.test(value)) {
    const page = await getPageSummary(ctx.db, value.toLowerCase());
    if (page) return page;
    throw new ToolError("PAGE_NOT_FOUND");
  }
  const fromPath = /\/p\/([^/?#]+)/.exec(value)?.[1] ?? value;
  const parts = parsePageRef(fromPath);
  if (!parts) throw new ToolError("PAGE_NOT_FOUND");
  const page = await getPageByShortId(ctx.db, { shortId: parts.shortId });
  if (!page) throw new ToolError("PAGE_NOT_FOUND");
  return page;
}

type SpaceInfo = { id: string; slug: string; name: string; role: string };

/** Narrows supabase-js' deeply generic client to the structural contract (see space/actions.ts). */
function spaceDb(ctx: ToolContext): SpaceDb {
  return ctx.db as unknown as SpaceDb;
}

async function spacesById(ctx: ToolContext): Promise<Map<string, SpaceInfo>> {
  const { spaces } = await listSpaces(spaceDb(ctx));
  return new Map(spaces.map((space) => [space.id, space]));
}

function pageUrl(
  ctx: ToolContext,
  spaceSlug: string | undefined,
  page: PageSummary,
): string | null {
  return spaceSlug ? new URL(pageHref(spaceSlug, page), ctx.origin).toString() : null;
}

function describePage(ctx: ToolContext, page: PageSummary, space: SpaceInfo | undefined) {
  return {
    id: page.id,
    title: page.title,
    icon: page.icon,
    url: pageUrl(ctx, space?.slug, page),
    spaceId: page.spaceId,
    spaceName: space?.name ?? null,
    parentId: page.parentId,
    lastEditedAt: page.lastEditedAt,
    inTrash: page.deletedAt !== null,
  };
}

async function pageRole(ctx: ToolContext, pageId: string): Promise<string | null> {
  const { data, error } = await ctx.db.rpc("my_page_role", { p_page_id: pageId });
  if (error) throw new ToolError("PAGE_ACTION_FAILED");
  return typeof data === "string" ? data : null;
}

async function currentDocument(ctx: ToolContext, pageId: string): Promise<JSONContent> {
  const content = await getPageContent(ctx.db, { pageId });
  return (content?.contentJson as JSONContent | undefined) ?? { type: "doc", content: [] };
}

/** Writes a whole document through kb-collab after checking edit rights (collab trusts kb-web). */
async function writeContent(ctx: ToolContext, page: PageSummary, doc: JSONContent) {
  if (page.deletedAt) throw new ToolError("PAGE_DELETED");
  const role = await pageRole(ctx, page.id);
  if (role !== "editor" && role !== "admin") throw new ToolError("FORBIDDEN");
  const content = assignBlockIds(doc);
  assertValidDocument(content);
  await (ctx.replaceDocument ?? replaceDocument)({
    pageId: page.id,
    content: content as ReplaceDocumentInput["content"],
    actorId: ctx.principal.userId,
    reason: "assistant",
  });
  return content;
}

function plainSnippet(html: string): string {
  return html
    .replace(/<\/?mark>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

const blockEditSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("replace"),
    blockId: z.string(),
    markdown: markdown.describe("Replacement blocks (empty string deletes the block)."),
  }),
  z.object({
    op: z.literal("insert"),
    afterBlockId: z.string().nullable().describe("Insert after this block; null = at the top."),
    markdown,
  }),
  z.object({ op: z.literal("delete"), blockId: z.string() }),
  z.object({ op: z.literal("append"), markdown }),
]);

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  title: string;
  description: string;
  inputSchema: Shape;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  /** Needs a connection with the `write` scope. */
  write: boolean;
  run: (ctx: ToolContext, input: z.infer<z.ZodObject<Shape>>) => Promise<unknown>;
}

function tool<Shape extends z.ZodRawShape>(definition: ToolDefinition<Shape>): ToolDefinition {
  return definition as unknown as ToolDefinition;
}

const MARKDOWN_NOTE =
  "Content is GitHub-flavoured Markdown: headings (#, ##, ###), lists, task lists (- [ ]), " +
  "quotes, fenced code, tables, images ![alt](url), links, **bold**, *italic*, ~~strike~~, " +
  "<u>underline</u>, `code`, and callouts as GitHub alerts (> [!NOTE], > [!TIP], > [!WARNING], " +
  "> [!CAUTION]).";

export const TOOLS: Record<string, ToolDefinition> = {
  list_spaces: tool({
    title: "List spaces",
    description:
      "List the knowledge-base spaces the user can see, with their role (viewer, editor, admin). " +
      "Pages always live in a space; start here to find where to read or write.",
    inputSchema: {
      query: z.string().max(100).optional().describe("Filter by space name (substring)."),
    },
    annotations: { readOnlyHint: true },
    write: false,
    async run(ctx, input) {
      const { spaces } = await listSpaces(spaceDb(ctx), input.query ? { query: input.query } : {});
      return {
        spaces: spaces.map((space) => ({
          id: space.id,
          name: space.name,
          description: space.description,
          icon: space.icon,
          role: space.role,
          canEdit: space.role !== "viewer",
          url: new URL(`/s/${encodeURIComponent(space.slug)}`, ctx.origin).toString(),
        })),
      };
    },
  }),

  list_pages: tool({
    title: "List pages",
    description:
      "List the page tree of a space (titles and ids, no content), starting at the root or at a " +
      "parent page, down to `depth` levels.",
    inputSchema: {
      spaceId: z.string().describe("Space id from list_spaces."),
      parentId: z.string().nullable().optional().describe("Parent page id; omit for the root."),
      depth: z.number().int().min(1).max(5).optional().describe("Levels to include (default 2)."),
    },
    annotations: { readOnlyHint: true },
    write: false,
    async run(ctx, input) {
      const spaces = await spacesById(ctx);
      const space = spaces.get(input.spaceId);
      if (!space) throw new ToolError("SPACE_NOT_FOUND");
      type Node = ReturnType<typeof describePage> & { hasChildren: boolean; children?: Node[] };
      let count = 0;
      let truncated = false;
      const walk = async (parentId: string | null, depth: number): Promise<Node[]> => {
        const children = await listChildPages(ctx.db, { spaceId: space.id, parentId });
        const nodes: Node[] = [];
        for (const child of children) {
          if (count >= MAX_LISTED_PAGES) {
            truncated = true;
            break;
          }
          count += 1;
          const node: Node = { ...describePage(ctx, child, space), hasChildren: child.hasChildren };
          if (child.hasChildren && depth > 1) node.children = await walk(child.id, depth - 1);
          nodes.push(node);
        }
        return nodes;
      };
      const pages = await walk(input.parentId ?? null, input.depth ?? 2);
      return { space: { id: space.id, name: space.name, role: space.role }, pages, truncated };
    },
  }),

  search_pages: tool({
    title: "Search pages",
    description:
      "Full-text search across the pages the user can read (Vietnamese works with or without " +
      "diacritics). Returns titles, snippets and ids; read a page with get_page.",
    inputSchema: {
      query: z.string().min(1).max(200),
      spaceIds: z.array(z.string()).max(20).optional().describe("Limit to these spaces."),
      limit: z.number().int().min(1).max(50).optional().describe("Default 10."),
    },
    annotations: { readOnlyHint: true },
    write: false,
    async run(ctx, input) {
      const output = await searchPages(ctx.db, {
        q: input.query,
        spaceIds: input.spaceIds,
        limit: input.limit ?? 10,
        offset: 0,
      });
      const hits = await withPageLinks(ctx.db, output.results);
      return {
        results: hits.map((hit) => ({
          id: hit.pageId,
          title: hit.title,
          snippet: plainSnippet(hit.snippetHtml),
          matchIn: hit.matchIn,
          spaceId: hit.spaceId,
          spaceName: hit.spaceName,
          url: new URL(hit.href, ctx.origin).toString(),
          lastEditedAt: hit.lastEditedAt,
        })),
      };
    },
  }),

  get_page: tool({
    title: "Read a page",
    description:
      'Read a page: title, location and content as Markdown. Use format "blocks" to get the ' +
      "content split into top-level blocks with their ids, for targeted edits with update_page.",
    inputSchema: {
      page: pageRefInput,
      format: z.enum(["markdown", "blocks"]).optional().describe('Default "markdown".'),
    },
    annotations: { readOnlyHint: true },
    write: false,
    async run(ctx, input) {
      const page = await resolvePage(ctx, input.page);
      const [spaces, ancestors, doc, role] = await Promise.all([
        spacesById(ctx),
        listPageAncestors(ctx.db, { pageId: page.id }),
        currentDocument(ctx, page.id),
        pageRole(ctx, page.id),
      ]);
      const result = {
        ...describePage(ctx, page, spaces.get(page.spaceId)),
        path: ancestors.map((ancestor) => ({ id: ancestor.id, title: ancestor.title })),
        canEdit: (role === "editor" || role === "admin") && page.deletedAt === null,
      };
      return input.format === "blocks"
        ? { ...result, blocks: listBlocks(doc) }
        : { ...result, markdown: docToMarkdown(doc) };
    },
  }),

  create_page: tool({
    title: "Create a page",
    description: `Create a page in a space (at the root or under a parent page), optionally with content. ${MARKDOWN_NOTE} Do not repeat the title as a heading in the content.`,
    inputSchema: {
      spaceId: z.string().describe("Space id from list_spaces (needs editor or admin role)."),
      parentId: z.string().nullable().optional().describe("Parent page id; omit for the root."),
      title: z.string().max(PAGE_TITLE_MAX_LENGTH),
      icon: z.string().max(16).nullable().optional().describe("One emoji, e.g. 📘."),
      markdown: markdown.optional().describe("Page content."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    write: true,
    async run(ctx, input) {
      const spaces = await spacesById(ctx);
      let page = await createPage(ctx.db, {
        spaceId: input.spaceId,
        parentId: input.parentId ?? null,
        title: input.title,
        icon: input.icon ?? null,
      });
      if (input.markdown?.trim()) await writeContent(ctx, page, markdownToDoc(input.markdown));
      page = (await getPageSummary(ctx.db, page.id)) ?? page;
      return { created: true, ...describePage(ctx, page, spaces.get(page.spaceId)) };
    },
  }),

  update_page: tool({
    title: "Update a page",
    description:
      "Change a page's title, icon and/or content. For content, either send `markdown` to replace " +
      "the whole page (unchanged blocks keep their identity), or `edits` to change only some " +
      'top-level blocks by id (ids from get_page with format "blocks"); prefer `edits` for ' +
      `small changes to long pages. ${MARKDOWN_NOTE}`,
    inputSchema: {
      page: pageRefInput,
      title: z.string().max(PAGE_TITLE_MAX_LENGTH).optional(),
      icon: z.string().max(16).nullable().optional().describe("Emoji; null removes the icon."),
      markdown: markdown.optional().describe("New content of the whole page."),
      edits: z
        .array(blockEditSchema)
        .max(200)
        .optional()
        .describe("Block edits, applied in order."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    write: true,
    async run(ctx, input) {
      if (input.markdown !== undefined && input.edits)
        throw new ToolError("VALIDATION_FAILED", {
          message: "Send either markdown or edits, not both.",
        });
      let page = await resolvePage(ctx, input.page);
      if (page.deletedAt) throw new ToolError("PAGE_DELETED");
      if (input.title !== undefined)
        page = await renamePage(ctx.db, { pageId: page.id, title: input.title });
      if (input.icon !== undefined)
        page = await setPageIcon(ctx.db, { pageId: page.id, icon: input.icon });

      let contentUpdated = false;
      if (input.markdown !== undefined || input.edits) {
        const current = await currentDocument(ctx, page.id);
        const next =
          input.markdown !== undefined
            ? reuseUnchangedBlocks(current, markdownToDoc(input.markdown))
            : applyBlockEdits(current, input.edits as BlockEdit[]);
        await writeContent(ctx, page, next);
        contentUpdated = true;
      }
      const spaces = await spacesById(ctx);
      page = (await getPageSummary(ctx.db, page.id)) ?? page;
      return {
        updated: true,
        contentUpdated,
        ...describePage(ctx, page, spaces.get(page.spaceId)),
      };
    },
  }),

  move_page: tool({
    title: "Move a page",
    description:
      "Move a page (with its sub-pages) under another parent, to the root of its space, or to " +
      "the root of another space.",
    inputSchema: {
      page: pageRefInput,
      parentId: z.string().nullable().describe("New parent page id; null = root of the space."),
      spaceId: z
        .string()
        .optional()
        .describe("Target space when moving to a root (parentId null)."),
      afterId: z
        .string()
        .nullable()
        .optional()
        .describe("Place after this sibling; null = first; omit = last."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    write: true,
    async run(ctx, input) {
      const page = await resolvePage(ctx, input.page);
      const moved = await movePage(ctx.db, {
        pageId: page.id,
        parentId: input.parentId,
        spaceId: input.spaceId,
        afterId: input.afterId,
      });
      const spaces = await spacesById(ctx);
      return { moved: true, ...describePage(ctx, moved, spaces.get(moved.spaceId)) };
    },
  }),

  delete_page: tool({
    title: "Delete a page",
    description:
      "Move a page and its sub-pages to the space's trash. It can be brought back with " +
      "restore_page (or from the trash in kb); nothing is deleted for good.",
    inputSchema: { page: pageRefInput },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    write: true,
    async run(ctx, input) {
      const page = await resolvePage(ctx, input.page);
      const trashed = await trashPage(ctx.db, { pageId: page.id });
      const spaces = await spacesById(ctx);
      return { deleted: true, ...describePage(ctx, trashed, spaces.get(trashed.spaceId)) };
    },
  }),

  restore_page: tool({
    title: "Restore a page",
    description: "Bring a page back from the trash (with the sub-pages trashed together with it).",
    inputSchema: { page: pageRefInput },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    write: true,
    async run(ctx, input) {
      const page = await resolvePage(ctx, input.page);
      const restored = await restorePage(ctx.db, { pageId: page.id });
      const spaces = await spacesById(ctx);
      return { restored: true, ...describePage(ctx, restored, spaces.get(restored.spaceId)) };
    },
  }),
};

/** Error → `{ error: CODE }`; unexpected errors become `INTERNAL_ERROR` (details only in logs). */
export function toolErrorPayload(error: unknown): { error: string } & Record<string, unknown> {
  if (error instanceof ToolError) return { error: error.code, ...error.detail };
  if (error instanceof BlockEditError) {
    return { error: error.code, ...(error.blockId ? { blockId: error.blockId } : {}) };
  }
  if (
    error instanceof PageError ||
    error instanceof SpaceError ||
    error instanceof SearchError ||
    error instanceof CollabError
  ) {
    return { error: error.code };
  }
  return { error: "INTERNAL_ERROR" };
}

/** Runs one tool for the connector: scope check, input validation, error mapping. */
export async function runTool(
  ctx: ToolContext,
  name: string,
  input: unknown,
): Promise<
  { ok: true; result: unknown } | { ok: false; error: { error: string } & Record<string, unknown> }
> {
  const definition = TOOLS[name];
  if (!definition) return { ok: false, error: { error: "TOOL_NOT_FOUND" } };
  try {
    if (definition.write) requireWrite(ctx);
    const parsed = z.object(definition.inputSchema).safeParse(input ?? {});
    if (!parsed.success)
      throw new ToolError("VALIDATION_FAILED", { issues: z.treeifyError(parsed.error) });
    return { ok: true, result: await definition.run(ctx, parsed.data) };
  } catch (error) {
    const payload = toolErrorPayload(error);
    if (payload.error === "INTERNAL_ERROR") console.error("[mcp] tool failed", name, error);
    return { ok: false, error: payload };
  }
}
