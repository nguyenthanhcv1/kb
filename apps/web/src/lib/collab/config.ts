import { EDITOR_SCHEMA_VERSION } from "@kb/editor/schema-version";

export type CollabClientConfig = {
  /** `ws(s)://` URL of kb-collab with the schema version the server checks (`CLIENT_OUTDATED`). */
  url: string;
  schemaVersion: number;
};

/**
 * Server-only. Runtime setting handed to the client (no `NEXT_PUBLIC_*`, so one image serves
 * every environment). `null` when `COLLAB_PUBLIC_URL` is unset: pages stay read-only.
 */
export function collabClientConfig(
  env: Record<string, string | undefined> = process.env,
): CollabClientConfig | null {
  const raw = env.COLLAB_PUBLIC_URL?.trim();
  if (!raw) return null;
  return { url: raw.replace(/\/+$/, ""), schemaVersion: EDITOR_SCHEMA_VERSION };
}
