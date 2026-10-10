import type { JSONContent } from "@tiptap/core";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageView } from "@/components/page/page-view";
import { canEditSpaceContent } from "@/components/space/permissions";
import { collabClientConfig } from "@/lib/collab/config";
import { canonicalPageRedirect } from "@/lib/page-href";

import { loadSpace } from "../../../../_lib/data";
import { loadPageAncestors, loadPageByRef, loadPageContent } from "../../../../_lib/pages";

type Props = { params: Promise<{ spaceSlug: string; pageRef: string }> };

export async function generateMetadata({ params }: Props) {
  const page = await loadPageByRef((await params).pageRef);
  const t = await getTranslations();
  return { title: page ? page.title || t("tree.untitled") : t("common.notFound.title") };
}

/**
 * A page: `/s/<spaceSlug>/p/<slug>-<shortId>`. Only the short id identifies it, so links with an
 * old slug (renamed page) or an old Space (moved page) redirect to the canonical URL.
 */
export default async function PageRoute({ params }: Props) {
  const { spaceSlug, pageRef } = await params;
  const page = await loadPageByRef(pageRef);
  if (!page) notFound();

  const canonical = canonicalPageRedirect({ spaceSlug, ref: pageRef }, page);
  if (canonical) redirect(canonical);

  const space = await loadSpace(page.spaceSlug);
  if (!space) notFound();
  const [content, ancestors] = await Promise.all([
    loadPageContent(page.id),
    loadPageAncestors(page.id),
  ]);

  return (
    <PageView
      // Remount on navigation between pages so local edit state never leaks across pages.
      key={page.id}
      page={page}
      spaceSlug={space.slug}
      spaceName={space.name}
      ancestors={ancestors}
      canEdit={canEditSpaceContent(space.role)}
      collab={collabClientConfig()}
      content={(content?.contentJson as JSONContent | undefined) ?? null}
    />
  );
}
