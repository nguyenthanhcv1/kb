import { z } from "zod";

import { webEnv } from "@/lib/env";

import { signRequest } from "./signature";

/**
 * kb-web → kb-collab internal API client (tasks T3.7, T6.1b; docs/PLAN.md §1.2). Server-only.
 *
 * The single way for kb-web to change page content (restore a version T6.3, apply a template,
 * import): kb-collab applies it through a Hocuspocus direct connection, so every open editor sees
 * it at once and it is stored by the normal collab write path. **Check permissions before calling**
 * — collab trusts kb-web (HMAC with `COLLAB_INTERNAL_SECRET`) and does not re-check the actor.
 *
 * ```ts
 * const result = await replaceDocument({
 *   pageId: "7b0c2a4e-1f5d-4c3b-9a8e-2d6f1b3c5a7e",
 *   content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Xin chào" }] }] },
 *   actorId: user.id,
 *   reason: "restore",
 * });
 * // { pageId: "7b0c2a4e-…", schemaVersion: 1, connections: 2 }
 * ```
 *
 * Failures throw {@link CollabError}: `code` is a user-facing code (`errors.<code>`), `reason` the
 * precise cause for logs (collab's code, `NOT_CONFIGURED`, `TIMEOUT`, `NETWORK`, `BAD_RESPONSE`).
 */

/** User-facing codes (all exist in `packages/i18n/messages/*\/errors.json`). */
export const COLLAB_ERROR_CODES = [
  "FORBIDDEN",
  "PAGE_NOT_FOUND",
  "VALIDATION_FAILED",
  "PAGE_ACTION_FAILED",
] as const;
export type CollabErrorCode = (typeof COLLAB_ERROR_CODES)[number];

export class CollabError extends Error {
  constructor(
    readonly code: CollabErrorCode,
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`${code} (${reason})`, options);
    this.name = "CollabError";
  }
}

/** Why the content is replaced; open editors receive it (stateless `document.replaced`). */
export const REPLACE_REASONS = ["restore", "template", "import"] as const;
export type ReplaceReason = (typeof REPLACE_REASONS)[number];

export const replaceDocumentInputSchema = z.object({
  pageId: z.guid(),
  /** TipTap JSON of the whole document; kb-collab validates it against the editor schema. */
  content: z.looseObject({ type: z.literal("doc"), content: z.array(z.unknown()).optional() }),
  /** User the change is attributed to (pages.last_edited_by, audit `page.update_content`). */
  actorId: z.guid(),
  reason: z.enum(REPLACE_REASONS).optional(),
});
export type ReplaceDocumentInput = z.input<typeof replaceDocumentInputSchema>;

export const replaceDocumentResultSchema = z.object({
  pageId: z.guid(),
  /** EDITOR_SCHEMA_VERSION of the collab server that applied the content. */
  schemaVersion: z.number().int(),
  /** Editors connected at that moment (they already show the new content). */
  connections: z.number().int().min(0),
});
export type ReplaceDocumentResult = z.infer<typeof replaceDocumentResultSchema>;

export interface CollabClientOptions {
  /** Defaults to `COLLAB_INTERNAL_URL` / `COLLAB_INTERNAL_SECRET` from the environment. */
  url?: string;
  secret?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Collab's internal codes → user-facing codes. */
function toUserCode(collabCode: string): CollabErrorCode {
  if (collabCode === "PAGE_NOT_FOUND") return "PAGE_NOT_FOUND";
  if (collabCode === "FORBIDDEN") return "FORBIDDEN";
  if (collabCode === "VALIDATION_FAILED" || collabCode === "PAYLOAD_TOO_LARGE") {
    return "VALIDATION_FAILED";
  }
  return "PAGE_ACTION_FAILED";
}

function resolveConfig(options: CollabClientOptions) {
  if (options.url && options.secret) return { url: options.url, secret: options.secret };
  const env = webEnv();
  const url = options.url ?? env.COLLAB_INTERNAL_URL;
  const secret = options.secret ?? env.COLLAB_INTERNAL_SECRET;
  if (!url || !secret) throw new CollabError("PAGE_ACTION_FAILED", "NOT_CONFIGURED");
  return { url, secret };
}

/** Replace the whole content of a page for everyone (see module docs). */
export async function replaceDocument(
  input: ReplaceDocumentInput,
  options: CollabClientOptions = {},
): Promise<ReplaceDocumentResult> {
  const parsed = replaceDocumentInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CollabError("VALIDATION_FAILED", "VALIDATION_FAILED", { cause: parsed.error });
  }
  const { pageId, ...payload } = parsed.data;
  return postInternal(
    `/internal/documents/${pageId}/replace`,
    payload,
    replaceDocumentResultSchema,
    options,
  );
}

/** Longest name of a manual version (page_versions.label). */
export const VERSION_LABEL_MAX_LENGTH = 200;

export const createPageVersionInputSchema = z.object({
  pageId: z.guid(),
  /** Author of the version; kb-collab checks again that they are an editor or admin. */
  actorId: z.guid(),
  /** Optional name shown in the history (empty = unnamed). */
  label: z.string().trim().max(VERSION_LABEL_MAX_LENGTH).optional(),
});
export type CreatePageVersionInput = z.input<typeof createPageVersionInputSchema>;

export const createPageVersionResultSchema = z.object({
  pageId: z.guid(),
  versionId: z.guid(),
  /** Number of the version within the page (1, 2, …). */
  versionNo: z.number().int().positive(),
});
export type CreatePageVersionResult = z.infer<typeof createPageVersionResultSchema>;

/**
 * "Save version" (T6.1b): kb-collab writes a `manual` page version of the live document, edits
 * not yet stored included. Check edit rights before calling (collab re-checks `actorId`).
 *
 * ```ts
 * await createPageVersion({ pageId, actorId: user.id, label: "Bản đã duyệt" });
 * // { pageId: "7b0c2a4e-…", versionId: "3f1d…", versionNo: 12 }
 * ```
 *
 * Errors ({@link CollabError}): `FORBIDDEN` (viewer), `PAGE_NOT_FOUND`, `VALIDATION_FAILED`,
 * `PAGE_ACTION_FAILED`.
 */
export async function createPageVersion(
  input: CreatePageVersionInput,
  options: CollabClientOptions = {},
): Promise<CreatePageVersionResult> {
  const parsed = createPageVersionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CollabError("VALIDATION_FAILED", "VALIDATION_FAILED", { cause: parsed.error });
  }
  const { pageId, actorId, label } = parsed.data;
  return postInternal(
    `/internal/documents/${pageId}/versions`,
    { actorId, ...(label ? { label } : {}) },
    createPageVersionResultSchema,
    options,
  );
}

/** Signed POST to kb-collab's internal API; maps failures to {@link CollabError}. */
async function postInternal<T>(
  route: string,
  payload: unknown,
  resultSchema: z.ZodType<T>,
  options: CollabClientOptions,
): Promise<T> {
  const { url, secret } = resolveConfig(options);

  const endpoint = new URL(route, url);
  const path = endpoint.pathname + endpoint.search;
  const body = JSON.stringify(payload);

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(endpoint, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        ...signRequest(secret, { method: "POST", path, body }),
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new CollabError("PAGE_ACTION_FAILED", timedOut ? "TIMEOUT" : "NETWORK", {
      cause: error,
    });
  }

  const json: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const result = resultSchema.safeParse(json);
    if (result.success) return result.data;
    throw new CollabError("PAGE_ACTION_FAILED", "BAD_RESPONSE", { cause: result.error });
  }

  const code = z.object({ code: z.string().max(64) }).safeParse(json);
  const collabCode = code.success ? code.data.code : `HTTP_${response.status}`;
  throw new CollabError(toUserCode(collabCode), collabCode);
}
