import { createAdminClient } from "@/lib/supabase/admin";
import { bootstrapSuperAdminEmails } from "@/lib/supabase/env";

let syncPromise: Promise<void> | null = null;

/**
 * Makes `BOOTSTRAP_SUPER_ADMIN_EMAILS` actually able to sign in and become super admin:
 * - adds each email to `access_allowlist` (so `app.before_user_created_hook` lets it through)
 * - mirrors the list onto `app_settings.bootstrap_admin_emails` (so `app.handle_new_user`
 *   grants `is_super_admin` the first time that email's profile is created)
 *
 * Both writes use the service-role client, so they bypass RLS — there is no admin yet the first
 * time this runs. Idempotent and cheap; called from the middleware before every `/login` and
 * `/auth/callback` request, memoized per server process so it only hits the DB once per boot
 * (a thrown error clears the memo so the next request retries).
 */
export function ensureBootstrapAccess(): Promise<void> {
  syncPromise ??= syncBootstrapAccess().catch((error: unknown) => {
    syncPromise = null;
    throw error;
  });
  return syncPromise;
}

async function syncBootstrapAccess(): Promise<void> {
  const emails = bootstrapSuperAdminEmails();
  if (emails.length === 0) return;

  const admin = createAdminClient();

  const { error: allowlistError } = await admin.from("access_allowlist").upsert(
    emails.map((email) => ({ kind: "email", value: email })),
    { onConflict: "kind,value", ignoreDuplicates: true },
  );
  if (allowlistError) throw allowlistError;

  const { error: settingsError } = await admin
    .from("app_settings")
    .update({ bootstrap_admin_emails: emails })
    .eq("id", 1);
  if (settingsError) throw settingsError;
}
