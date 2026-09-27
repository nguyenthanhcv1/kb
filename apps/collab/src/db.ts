import pg from "pg";
import * as Y from "yjs";

import type { DerivedContent } from "./content";

export type SpaceRole = "viewer" | "editor" | "admin";

export interface StoredDocument {
  ydoc: Uint8Array;
  schemaVersion: number;
}

export interface StoreInput {
  pageId: string;
  /** Full Y state of the in-memory document. */
  state: Uint8Array;
  schemaVersion: number;
  content: DerivedContent;
  /** Last user who changed the document (audit actor, pages.last_edited_by). */
  editorId: string | null;
}

export interface DocumentStore {
  authorize(pageId: string, userId: string): Promise<SpaceRole | null>;
  fetch(pageId: string): Promise<StoredDocument | null>;
  /** Returns false when the page no longer exists (purged while open). */
  store(input: StoreInput): Promise<boolean>;
  /** Nightly retention of page_versions (T6.1a); returns the number of versions deleted. */
  prunePageVersions(): Promise<number>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Postgres access as role `kb_collab` (T3.3a): only page_documents content, pages.last_edited_*
 * and the SECURITY DEFINER helpers. RLS stays enabled for this role.
 */
export function createDocumentStore(
  databaseUrl: string,
  options: { max?: number } = {},
): DocumentStore {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    application_name: "kb-collab",
    idleTimeoutMillis: 30_000,
  });

  return {
    async authorize(pageId, userId) {
      const { rows } = await pool.query<{ role: SpaceRole | null }>(
        "select app.authorize_document($1, $2)::text as role",
        [pageId, userId],
      );
      return rows[0]?.role ?? null;
    },

    async fetch(pageId) {
      const { rows } = await pool.query<{ ydoc: Buffer; schema_version: number }>(
        "select ydoc, schema_version from public.page_documents where page_id = $1",
        [pageId],
      );
      const row = rows[0];
      return row ? { ydoc: new Uint8Array(row.ydoc), schemaVersion: row.schema_version } : null;
    },

    async store({ pageId, state, schemaVersion, content, editorId }) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const { rows } = await client.query<{ ydoc: Buffer }>(
          "select ydoc from public.page_documents where page_id = $1 for update",
          [pageId],
        );
        if (!rows[0]) {
          await client.query("rollback");
          return false;
        }

        // Merge instead of overwrite: another instance (V2, Redis) may have written meanwhile.
        const merged = Y.mergeUpdates([new Uint8Array(rows[0].ydoc), state]);
        await client.query(
          `update public.page_documents
           set ydoc = $2, schema_version = $3, content_json = $4, content_text = $5,
               headings_text = $6, table_text = $7, word_count = $8
           where page_id = $1`,
          [
            pageId,
            Buffer.from(merged),
            schemaVersion,
            content.contentJson,
            content.contentText,
            content.headingsText,
            content.tableText,
            content.wordCount,
          ],
        );

        if (editorId) {
          await client.query("select set_config('app.actor_id', $1, true)", [editorId]);
          await client.query(
            "update public.pages set last_edited_at = now(), last_edited_by = $2 where id = $1",
            [pageId, editorId],
          );
          await client.query("select app.record_content_edit($1, $2)", [pageId, editorId]);
        } else {
          await client.query("update public.pages set last_edited_at = now() where id = $1", [
            pageId,
          ]);
        }

        await client.query("commit");
        return true;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async prunePageVersions() {
      const { rows } = await pool.query<{ deleted: number }>(
        "select app.prune_page_versions() as deleted",
      );
      return rows[0]?.deleted ?? 0;
    },

    async ping() {
      await pool.query("select 1");
    },

    async close() {
      await pool.end();
    },
  };
}
