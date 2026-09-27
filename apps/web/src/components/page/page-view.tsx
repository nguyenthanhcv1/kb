"use client";

import type { JSONContent } from "@tiptap/core";
import { ArchiveRestoreIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { pageHref, spaceTrashHref } from "@/lib/page-href";
import type { PageSummary } from "@/server/pages";
import { restorePageAction } from "@/server/pages/actions";

import { pageErrorKey } from "./errors";
import { PageActionsMenu } from "./page-actions-menu";
import { PageContent } from "./page-content";
import { PageIconPicker } from "./page-icon-picker";
import { PageTitle } from "./page-title";

type PageViewProps = {
  page: PageSummary;
  spaceSlug: string;
  /** Editors and admins of the Space (RLS decides; this only shows the controls). */
  canEdit: boolean;
  content: JSONContent | null;
};

/**
 * `/s/<space>/p/<ref>`: icon, title (editable in place for editors), the trashed notice with
 * "restore", and the read-only content. A rename changes the slug, so the URL is replaced with
 * the new canonical one (old links keep working through the route's redirect).
 */
export function PageView({ page, spaceSlug, canEdit, content }: PageViewProps) {
  const router = useRouter();
  const trashed = page.deletedAt !== null;
  const editable = canEdit && !trashed;

  function onRenamed(renamed: PageSummary) {
    if (renamed.slug !== page.slug) router.replace(pageHref(spaceSlug, renamed), { scroll: false });
    router.refresh();
  }

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-10">
      {trashed && <TrashedPageNotice page={page} spaceSlug={spaceSlug} canRestore={canEdit} />}
      <header className="flex items-start gap-2">
        {/* `md:pl-8`: aligned with the editor content, whose gutter holds the block handle. */}
        <div className="flex min-w-0 flex-1 flex-col gap-2 md:pl-8">
          <PageIconPicker page={page} editable={editable} onChanged={() => router.refresh()} />
          <PageTitle page={page} editable={editable} onRenamed={onRenamed} />
        </div>
        {editable && <PageActionsMenu page={page} />}
      </header>
      <PageContent content={content} title={page.title} />
    </article>
  );
}

function TrashedPageNotice({
  page,
  spaceSlug,
  canRestore,
}: {
  page: Pick<PageSummary, "id">;
  spaceSlug: string;
  canRestore: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function restore() {
    setError(null);
    startTransition(async () => {
      const result = await restorePageAction({ pageId: page.id });
      if (!result.ok) {
        setError(t(pageErrorKey(result.code)));
        return;
      }
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="trashed-page-title"
      className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center"
    >
      <Trash2Icon className="size-5 shrink-0 text-destructive" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 id="trashed-page-title" className="font-medium">
          {t("tree.page.trashed.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("tree.page.trashed.description")}</p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {canRestore && (
          <Button size="sm" onClick={restore} disabled={pending}>
            <ArchiveRestoreIcon aria-hidden />
            {pending ? t("tree.trash.restoring") : t("tree.trash.restore")}
          </Button>
        )}
        <Button asChild size="sm" variant="outline">
          <Link href={spaceTrashHref(spaceSlug)}>{t("tree.page.trashed.openTrash")}</Link>
        </Button>
      </div>
    </section>
  );
}
