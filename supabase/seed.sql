-- Deterministic local seed data is added alongside the schema that owns it.

-- kb-collab connects as kb_collab (T3.3a). Local only: deployed environments set their own
-- password (runbook, T0.8). DATABASE_URL=postgresql://kb_collab:kb_collab_local@127.0.0.1:54322/postgres
alter role kb_collab password 'kb_collab_local';
