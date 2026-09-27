"use client";

import { useTranslations } from "next-intl";

import { Separator } from "@/components/ui/separator";
import type { Invitation, SpaceMember } from "@/server/members";

import { AddMemberForm } from "./add-member-form";
import { FeedbackMessage, useFeedback } from "./feedback";
import { InvitationList } from "./invitation-list";
import { InviteGuestForm } from "./invite-guest-form";
import { MemberList } from "./member-list";

/**
 * Members section of the Space settings (admins only — the settings layout gates it, RLS
 * enforces it): add internal people, members with roles, guest invitations. Data comes from the
 * Server Component page; every action ends with `router.refresh()` to re-read it.
 */
export function MembersSettings({
  space,
  members,
  invitations,
  currentUserId,
}: {
  space: { id: string; name: string };
  members: readonly SpaceMember[];
  invitations: readonly Invitation[];
  currentUserId: string;
}) {
  const t = useTranslations("members");
  const { feedback, success, error } = useFeedback();
  const notify = { success, error };

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="members-heading" className="grid gap-6">
        <div className="grid gap-1">
          <h2 id="members-heading" className="text-lg font-semibold">
            {t("list.title")}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {t("list.count", { count: members.length })}
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">{t("list.description")}</p>
        </div>
        <AddMemberForm spaceId={space.id} notify={notify} />
        <FeedbackMessage feedback={feedback} />
        <MemberList space={space} members={members} currentUserId={currentUserId} notify={notify} />
      </section>
      <Separator />
      <div className="grid gap-6">
        <InviteGuestForm spaceId={space.id} />
        <InvitationList invitations={invitations} />
      </div>
    </div>
  );
}
