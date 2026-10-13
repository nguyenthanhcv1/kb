-- Deterministic local seed data is added alongside the schema that owns it.

-- kb-collab connects as kb_collab (T3.3a). Local only: deployed environments set their own
-- password (runbook, T0.8). DATABASE_URL=postgresql://kb_collab:kb_collab_local@127.0.0.1:54322/postgres
alter role kb_collab password 'kb_collab_local';

-- Local and CI only: fixtures create users by inserting into auth.users and expect them usable at
-- once, so account approval (on by default, see 20261012090000_account_approval.sql) is off here.
-- Tests of the approval flow switch it on inside their own transaction.
update public.app_settings set require_account_approval = false where id = 1;
