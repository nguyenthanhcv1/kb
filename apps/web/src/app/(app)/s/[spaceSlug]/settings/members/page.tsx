import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { MembersSettings } from "@/components/members/members-settings";
import { canManageSpace } from "@/components/space/permissions";
import { listInvitations, listMembers } from "@/server/members/actions";

import { loadSpace, requireUser } from "../../../../_lib/data";

type Props = { params: Promise<{ spaceSlug: string }> };

export async function generateMetadata() {
  const t = await getTranslations("space");
  return { title: t("members") };
}

/** Members + guest invitations. The layout renders the forbidden state for non-admins. */
export default async function SpaceMembersPage({ params }: Props) {
  const space = await loadSpace((await params).spaceSlug);
  if (!space) notFound();
  if (!canManageSpace(space.role)) return null;

  const [user, members, invitations] = await Promise.all([
    requireUser(),
    listMembers({ spaceId: space.id }),
    listInvitations({ spaceId: space.id }),
  ]);
  if (!members.ok) throw new Error(members.error);
  if (!invitations.ok) throw new Error(invitations.error);

  return (
    <MembersSettings
      space={{ id: space.id, name: space.name }}
      members={members.data.members}
      invitations={invitations.data.invitations}
      currentUserId={user.id}
    />
  );
}
