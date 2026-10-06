/** Why kb-collab replaced the whole content of an open page (mirrors apps/collab internal API). */
export const DOCUMENT_REPLACED_REASONS = ["restore", "template", "import", "assistant"] as const;
export type DocumentReplacedReason = (typeof DOCUMENT_REPLACED_REASONS)[number];

export type DocumentReplaced = { reason: DocumentReplacedReason; actorId: string | null };

/**
 * Parses the stateless message `{"type":"document.replaced","reason":"restore","actorId":"…"}`
 * kb-collab sends to open editors after a restore / template / import (T6.3a). Anything else
 * (other stateless messages, malformed JSON, unknown reason) → `null`.
 */
export function parseDocumentReplaced(payload: string): DocumentReplaced | null {
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { type, reason, actorId } = data as Record<string, unknown>;
  if (type !== "document.replaced") return null;
  if (!DOCUMENT_REPLACED_REASONS.includes(reason as DocumentReplacedReason)) return null;
  return {
    reason: reason as DocumentReplacedReason,
    actorId: typeof actorId === "string" ? actorId : null,
  };
}
