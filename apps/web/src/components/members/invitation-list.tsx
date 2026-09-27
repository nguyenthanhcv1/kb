"use client";

import { MailIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Invitation } from "@/server/members";
import { resendInvitation, revokeInvitation } from "@/server/members/actions";

import { ConfirmAction } from "./confirm-action";
import { memberErrorKey } from "./errors";
import { FeedbackMessage, useFeedback } from "./feedback";
import { InviteLink } from "./invite-link";

type Notify = { success: (message: string) => void; error: (message: string) => void };

/**
 * Pending and expired invitations of the Space: resend (new link, new 14 days — the old link
 * stops working) or revoke behind a confirmation.
 */
export function InvitationList({ invitations }: { invitations: readonly Invitation[] }) {
  const t = useTranslations("members.invitations");
  const id = useId();
  const { feedback, success, error } = useFeedback();
  const [link, setLink] = useState<{ invitationId: string; url: string } | null>(null);
  const notify: Notify = { success, error };

  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-3">
      <h3 id={`${id}-title`} className="font-semibold">
        {t("title")}
      </h3>
      <FeedbackMessage feedback={feedback} />
      {invitations.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-labelledby={`${id}-title`}>
          {invitations.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              invitation={invitation}
              notify={notify}
              onResent={(url) => setLink({ invitationId: invitation.id, url })}
            />
          ))}
        </ul>
      )}
      {link && invitations.some((i) => i.id === link.invitationId) && <InviteLink url={link.url} />}
    </section>
  );
}

function InvitationRow({
  invitation,
  notify,
  onResent,
}: {
  invitation: Invitation;
  notify: Notify;
  onResent: (url: string) => void;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const [resendPending, startResend] = useTransition();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokePending, startRevoke] = useTransition();
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const { email } = invitation;
  const expired = invitation.status === "expired";
  const date = format.dateTime(new Date(invitation.expiresAt), {
    dateStyle: "medium",
    timeStyle: "short",
  });

  function onResend() {
    startResend(async () => {
      const result = await resendInvitation({ invitationId: invitation.id });
      if (!result.ok) {
        notify.error(t(memberErrorKey(result.error)));
        return;
      }
      const { emailStatus } = result.data;
      if (emailStatus === "sent") notify.success(t("members.invitations.resent", { email }));
      else notify.error(t(`members.invite.emailStatus.${emailStatus}`, { email }));
      onResent(result.data.inviteUrl);
      router.refresh();
    });
  }

  function onRevoke() {
    setRevokeError(null);
    startRevoke(async () => {
      const result = await revokeInvitation({ invitationId: invitation.id });
      if (!result.ok && result.error !== "INVITATION_REVOKED") {
        setRevokeError(t(memberErrorKey(result.error)));
        return;
      }
      setRevokeOpen(false);
      notify.success(t("members.invitations.revoked", { email }));
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <MailIcon className="size-4 text-muted-foreground" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 font-medium break-all">{email}</span>
            <Badge variant={expired ? "destructive" : "secondary"}>
              {t(`members.invitations.status.${invitation.status}`)}
            </Badge>
          </p>
          <p className="text-sm text-muted-foreground">
            {t(`space.roles.${invitation.role}`)}
            <span aria-hidden> · </span>
            {expired
              ? t("members.invitations.expired", { date })
              : t("members.invitations.expires", { date })}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onResend}
          disabled={resendPending}
          aria-label={t("members.invitations.resendLabel", { email })}
        >
          <RotateCwIcon aria-hidden />
          {t("members.invitations.resend")}
        </Button>
        <ConfirmAction
          trigger={
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("members.invitations.revokeLabel", { email })}
            >
              <XIcon aria-hidden />
              {t("members.invitations.revoke")}
            </Button>
          }
          title={t("members.invitations.revokeConfirmTitle")}
          description={t("members.invitations.revokeConfirmDescription", { email })}
          confirmLabel={t("members.invitations.revoke")}
          pendingLabel={t("members.invitations.revoking")}
          pending={revokePending}
          error={revokeError}
          open={revokeOpen}
          onOpenChange={(next) => {
            setRevokeOpen(next);
            if (!next) setRevokeError(null);
          }}
          onConfirm={onRevoke}
        />
      </div>
    </li>
  );
}
