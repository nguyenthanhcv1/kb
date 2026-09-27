"use client";

import { UserMinusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  INVITATION_ROLES,
  MEMBER_ROLES,
  type MemberRole,
  type SpaceMember,
} from "@/server/members";
import { changeMemberRole, removeMember } from "@/server/members/actions";

import { ConfirmAction } from "./confirm-action";
import { memberDisplayName, sortMembers } from "./display";
import { memberErrorKey } from "./errors";
import { LeaveSpaceButton } from "./leave-space-button";
import { MemberAvatar } from "./member-avatar";
import { RoleSelect } from "./role-select";

type Space = { id: string; name: string };
type Notify = { success: (message: string) => void; error: (message: string) => void };

/**
 * Members of the Space with their role (changeable by admins), guest badge, and remove — or
 * "leave" on the caller's own row. The DB keeps at least one admin and never makes a guest an
 * admin; those refusals come back as translated errors.
 */
export function MemberList({
  space,
  members,
  currentUserId,
  notify,
}: {
  space: Space;
  members: readonly SpaceMember[];
  currentUserId: string;
  notify: Notify;
}) {
  const t = useTranslations("members.list");
  const locale = useLocale();
  const sorted = sortMembers(members, locale);
  return (
    <ul className="divide-y rounded-lg border" aria-label={t("title")}>
      {sorted.map((member) => (
        <MemberRow
          key={member.userId}
          space={space}
          member={member}
          isSelf={member.userId === currentUserId}
          notify={notify}
        />
      ))}
    </ul>
  );
}

function MemberRow({
  space,
  member,
  isSelf,
  notify,
}: {
  space: Space;
  member: SpaceMember;
  isSelf: boolean;
  notify: Notify;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const [role, setRole] = useState<MemberRole>(member.role);
  const [rolePending, startRoleTransition] = useTransition();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removePending, startRemoveTransition] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  const name = memberDisplayName(member) ?? t("members.list.unknown");
  const roles = member.isGuest ? INVITATION_ROLES : MEMBER_ROLES;

  function onRoleChange(next: MemberRole) {
    if (next === role) return;
    const previous = role;
    setRole(next);
    startRoleTransition(async () => {
      const result = await changeMemberRole({
        spaceId: space.id,
        userId: member.userId,
        role: next,
      });
      if (!result.ok) {
        setRole(previous);
        notify.error(t(memberErrorKey(result.error)));
        return;
      }
      notify.success(t("members.list.roleChanged", { name, role: t(`space.roles.${next}`) }));
      router.refresh();
    });
  }

  function onRemove() {
    setRemoveError(null);
    startRemoveTransition(async () => {
      const result = await removeMember({ spaceId: space.id, userId: member.userId });
      if (!result.ok && result.error !== "MEMBER_NOT_FOUND") {
        setRemoveError(t(memberErrorKey(result.error)));
        return;
      }
      setRemoveOpen(false);
      notify.success(t("members.list.removed", { name }));
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <MemberAvatar member={member} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
            <span className="min-w-0 break-words">{name}</span>
            {isSelf && <Badge variant="secondary">{t("members.list.you")}</Badge>}
            {member.isGuest && <Badge variant="outline">{t("members.list.guest")}</Badge>}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {member.fullName && member.email ? member.email : null}
            {member.fullName && member.email ? <span aria-hidden> · </span> : null}
            {t("members.list.joined", {
              date: format.dateTime(new Date(member.joinedAt), { dateStyle: "medium" }),
            })}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <RoleSelect
          value={role}
          roles={roles}
          onChange={onRoleChange}
          label={t("members.list.roleLabel", { name })}
          disabled={rolePending}
          size="sm"
        />
        {isSelf ? (
          <LeaveSpaceButton space={space} />
        ) : (
          <ConfirmAction
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("members.list.removeLabel", { name })}
                title={t("members.list.remove")}
              >
                <UserMinusIcon aria-hidden />
              </Button>
            }
            title={t("members.list.removeConfirmTitle")}
            description={t("members.list.removeConfirmDescription", { name, space: space.name })}
            confirmLabel={t("members.list.remove")}
            pendingLabel={t("members.list.removing")}
            pending={removePending}
            error={removeError}
            open={removeOpen}
            onOpenChange={(next) => {
              setRemoveOpen(next);
              if (!next) setRemoveError(null);
            }}
            onConfirm={onRemove}
          />
        )}
      </div>
    </li>
  );
}
