import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LeaveSpaceButton } from "@/components/members/leave-space-button";
import { canManageSpace } from "@/components/space/permissions";
import { SpaceHeader } from "@/components/space/space-header";
import { listMembers } from "@/server/members/actions";

import { loadSpace, requireUser } from "../../_lib/data";

type Props = { params: Promise<{ spaceSlug: string }> };

export async function generateMetadata({ params }: Props) {
  const space = await loadSpace((await params).spaceSlug);
  const t = await getTranslations("space");
  return { title: space?.name ?? t("notFound.title") };
}

/** Space landing page. The page tree and pages of the Space arrive with T2.3 / T2.4. */
export default async function SpacePage({ params }: Props) {
  const space = await loadSpace((await params).spaceSlug);
  if (!space) notFound();
  const t = await getTranslations("space.home");
  const canLeave = !canManageSpace(space.role) && (await isExplicitMember(space.id));
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-4 sm:p-6">
      <SpaceHeader
        space={space}
        actions={canLeave ? <LeaveSpaceButton space={{ id: space.id, name: space.name }} /> : null}
      />
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="font-medium">{t("emptyTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("emptyDescription")}</p>
      </div>
    </div>
  );
}

/**
 * Explicit members may leave; implicit viewers of an `internal` Space (no member row) cannot.
 * Admins leave from the members settings instead. A read error just hides the button.
 */
async function isExplicitMember(spaceId: string): Promise<boolean> {
  const [user, result] = await Promise.all([requireUser(), listMembers({ spaceId })]);
  return result.ok && result.data.members.some((member) => member.userId === user.id);
}
