"use client";

import { MailPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INVITATION_ROLES, type InvitationRole, type SentInvitation } from "@/server/members";
import { createInvitation } from "@/server/members/actions";

import { isValidEmail } from "./display";
import { memberErrorKey } from "./errors";
import { FeedbackMessage, useFeedback } from "./feedback";
import { InviteLink } from "./invite-link";
import { RoleSelect } from "./role-select";

/**
 * Invite an external guest by email (role viewer/editor, 14 days). The result says whether the
 * email went out; the link is shown once so it can also be shared by hand.
 */
export function InviteGuestForm({ spaceId }: { spaceId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("viewer");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentInvitation | null>(null);
  const [pending, startTransition] = useTransition();
  const { feedback, success, error, clear } = useFeedback();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clear();
    setSent(null);
    if (!isValidEmail(email)) {
      setEmailError(t("members.invite.emailInvalid"));
      return;
    }
    setEmailError(null);
    startTransition(async () => {
      const result = await createInvitation({ spaceId, email, role });
      if (!result.ok) {
        if (result.error === "VALIDATION_FAILED") {
          setEmailError(t("members.invite.emailInvalid"));
        } else {
          error(t(memberErrorKey(result.error)));
        }
        return;
      }
      const invited = result.data.invitation.email;
      const message = t(`members.invite.emailStatus.${result.data.emailStatus}`, {
        email: invited,
      });
      if (result.data.emailStatus === "sent") success(message);
      else error(message);
      setSent(result.data);
      setEmail("");
      router.refresh();
    });
  }

  const emailId = `${id}-email`;
  const roleId = `${id}-role`;
  const errorId = `${id}-email-error`;

  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-4">
      <div className="grid gap-1">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {t("members.invite.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("members.invite.description")}</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="grid gap-2">
            <Label htmlFor={emailId}>{t("members.invite.emailLabel")}</Label>
            <Input
              id={emailId}
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError(null);
              }}
              placeholder={t("members.invite.emailPlaceholder")}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? errorId : undefined}
              disabled={pending}
            />
            {emailError && (
              <p id={errorId} className="text-sm text-destructive">
                {emailError}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={roleId}>{t("members.invite.roleLabel")}</Label>
            <RoleSelect
              id={roleId}
              value={role}
              roles={INVITATION_ROLES}
              onChange={setRole}
              label={t("members.invite.roleLabel")}
              disabled={pending}
            />
          </div>
        </div>
        <Button type="submit" disabled={pending} className="justify-self-start">
          <MailPlusIcon aria-hidden />
          {pending ? t("members.invite.submitting") : t("members.invite.submit")}
        </Button>
      </form>
      <FeedbackMessage feedback={feedback} />
      {sent && <InviteLink url={sent.inviteUrl} />}
    </section>
  );
}
