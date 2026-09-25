/**
 * Version of the shared ProseMirror schema built by `createExtensions()`.
 *
 * Bump this whenever a node, mark or attribute is added, removed or changes
 * meaning. `kb-collab` rejects clients whose version differs from the server
 * (`CLIENT_OUTDATED`), and stored documents record the version they were
 * written with so they can be migrated on load.
 */
export const EDITOR_SCHEMA_VERSION = 1;
