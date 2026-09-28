import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AccessEntryList } from "@/components/admin/access-entry-list";
import { AddAccessForm } from "@/components/admin/add-access-form";
import { AdminForbidden } from "@/components/admin/admin-forbidden";
import { TestEmailForm } from "@/components/admin/test-email-form";
import { listAccessEntries } from "@/server/admin/actions";

import { requireUser } from "../../_lib/data";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin");
  return { title: t("access.title") };
}

/** Sign-in allowlist: add (bulk) / remove emails and domains, send a test email. */
export default async function AdminAccessPage() {
  const user = await requireUser();
  // The layout renders the "no access" state.
  if (!user.isSuperAdmin) return null;
  const [t, result] = await Promise.all([getTranslations("admin"), listAccessEntries()]);
  if (!result.ok) {
    if (result.error === "FORBIDDEN") return <AdminForbidden />;
    throw new Error(result.error);
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground">{t("access.description")}</p>
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr] lg:items-start">
        <AddAccessForm />
        <TestEmailForm defaultRecipient={user.email} />
      </div>
      <AccessEntryList entries={result.data.entries} />
    </div>
  );
}
