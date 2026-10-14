"use client";

import { Share2Icon, UserMinusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState, useTransition } from "react";

import { ConfirmAction } from "@/components/members/confirm-action";
import { isValidEmail, memberDisplayName } from "@/components/members/display";
import { FeedbackMessage, useFeedback } from "@/components/members/feedback";
import { InvitationList } from "@/components/members/invitation-list";
import { InviteLink } from "@/components/members/invite-link";
import { MemberAvatar } from "@/components/members/member-avatar";
import { RoleSelect } from "@/components/members/role-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PageSummary } from "@/server/pages";
import {
  PAGE_SHARE_ERROR_CODES,
  PAGE_SHARE_ROLES,
  type ListPageSharesOutput,
  type PageShare,
  type PageShareErrorCode,
  type PageShareRole,
} from "@/server/page-shares";
import {
  changePageShareRoleAction,
  listPageSharesAction,
  removePageShareAction,
  sharePageAction,
} from "@/server/page-shares/actions";

type Notify = { success: (message: string) => void; error: (message: string) => void };

/** Translation key (in `errors`) of a page share error code. */
export function pageShareErrorKey(code: PageShareErrorCode): `errors.${PageShareErrorCode}` {
  return `errors.${PAGE_SHARE_ERROR_CODES.includes(code) ? code : "PAGE_SHARE_FAILED"}`;
}

/**
 * "Share" button of a page (Space admins): opens {@link SharePageDialog}.
 */
export function SharePageButton({ page }: { page: Pick<PageSummary, "id" | "title"> }) {
  const t = useTranslations("members.pageShare");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t("buttonLabel")}>
          <Share2Icon aria-hidden />
          <span className="sr-only sm:not-sr-only">{t("button")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        {open && <SharePageDialogBody page={page} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Share a page by email with a role (viewer/editor) — the person then reads (or edits) this page
 * and all its subpages, nothing else of the Space. Lists the people it is shared with (direct
 * shares can be changed or removed; inherited ones name the page they come from) and pending
 * invitations of people without an account yet.
 */
export function SharePageDialogBody({ page }: { page: Pick<PageSummary, "id" | "title"> }) {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const [data, setData] = useState<ListPageSharesOutput | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PageShareRole>("viewer");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { feedback, success, error, clear } = useFeedback();
  const notify: Notify = { success, error };

  const apply = useCallback(
    (result: Awaited<ReturnType<typeof listPageSharesAction>>) => {
      if (result.ok) {
        setData(result.data);
        setLoadError(null);
      } else {
        setLoadError(t(pageShareErrorKey(result.error)));
      }
    },
    [t],
  );

  const reload = useCallback(
    async () => apply(await listPageSharesAction({ pageId: page.id })),
    [apply, page.id],
  );

  useEffect(() => {
    let active = true;
    void listPageSharesAction({ pageId: page.id }).then((result) => {
      if (active) apply(result);
    });
    return () => {
      active = false;
    };
  }, [apply, page.id]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clear();
    setInviteUrl(null);
    if (!isValidEmail(email)) {
      setEmailError(t("members.invite.emailInvalid"));
      return;
    }
    setEmailError(null);
    startTransition(async () => {
      const result = await sharePageAction({ pageId: page.id, email, role });
      if (!result.ok) {
        if (result.error === "VALIDATION_FAILED") setEmailError(t("members.invite.emailInvalid"));
        else error(t(pageShareErrorKey(result.error)));
        return;
      }
      const shared = email.trim().toLowerCase();
      const { emailStatus } = result.data;
      if (result.data.status === "granted") {
        const message =
          emailStatus === "failed"
            ? t("members.pageShare.sharedEmailFailed", { email: shared })
            : t("members.pageShare.shared", { email: shared });
        if (emailStatus === "failed") error(message);
        else success(message);
      } else {
        const message = t(`members.invite.emailStatus.${emailStatus}`, { email: shared });
        if (emailStatus === "sent") success(t("members.pageShare.invited", { email: shared }));
        else error(message);
        setInviteUrl(result.data.inviteUrl);
      }
      setEmail("");
      await reload();
      router.refresh();
    });
  }

  const direct = data?.shares.filter((share) => !share.inherited) ?? [];
  const inherited = data?.shares.filter((share) => share.inherited) ?? [];
  const emailId = `${id}-email`;
  const roleId = `${id}-role`;
  const errorId = `${id}-email-error`;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <DialogHeader>
        <DialogTitle className="break-words">
          {t("members.pageShare.title", { page: page.title || t("tree.untitled") })}
        </DialogTitle>
        <DialogDescription>{t("members.pageShare.description")}</DialogDescription>
      </DialogHeader>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-2">
            <Label htmlFor={emailId}>{t("members.pageShare.emailLabel")}</Label>
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
              placeholder={t("members.pageShare.emailPlaceholder")}
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
            <Label htmlFor={roleId}>{t("members.pageShare.roleField")}</Label>
            <RoleSelect
              id={roleId}
              value={role}
              roles={PAGE_SHARE_ROLES}
              onChange={setRole}
              label={t("members.pageShare.roleField")}
              disabled={pending}
            />
          </div>
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          <Share2Icon aria-hidden />
          {pending ? t("members.pageShare.submitting") : t("members.pageShare.submit")}
        </Button>
      </form>
      <FeedbackMessage feedback={feedback} />
      {inviteUrl && <InviteLink url={inviteUrl} />}

      <section aria-labelledby={`${id}-people`} className="flex flex-col gap-3">
        <h3 id={`${id}-people`} className="font-semibold">
          {t("members.pageShare.peopleTitle")}
        </h3>
        {loadError ? (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        ) : !data ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("members.pageShare.loading")}
          </p>
        ) : direct.length + inherited.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t("members.pageShare.empty")}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border" aria-labelledby={`${id}-people`}>
            {direct.map((share) => (
              <ShareRow
                key={share.userId}
                pageId={page.id}
                share={share}
                notify={notify}
                onChanged={reload}
              />
            ))}
            {inherited.map((share) => (
              <ShareRow
                key={`${share.sourcePageId}-${share.userId}`}
                pageId={page.id}
                share={share}
                notify={notify}
                onChanged={reload}
              />
            ))}
          </ul>
        )}
      </section>

      {data && data.invitations.length > 0 && (
        <InvitationList invitations={data.invitations} onChanged={() => void reload()} />
      )}
    </div>
  );
}

function ShareRow({
  pageId,
  share,
  notify,
  onChanged,
}: {
  pageId: string;
  share: PageShare;
  notify: Notify;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [rolePending, startRole] = useTransition();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removePending, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const name = memberDisplayName(share) ?? share.email;

  function onRoleChange(role: PageShareRole) {
    startRole(async () => {
      const result = await changePageShareRoleAction({ pageId, userId: share.userId, role });
      if (!result.ok) {
        notify.error(t(pageShareErrorKey(result.error)));
        return;
      }
      notify.success(t("members.pageShare.roleChanged", { name, role: t(`space.roles.${role}`) }));
      await onChanged();
      router.refresh();
    });
  }

  function onRemove() {
    setRemoveError(null);
    startRemove(async () => {
      const result = await removePageShareAction({ pageId, userId: share.userId });
      if (!result.ok && result.error !== "PAGE_SHARE_NOT_FOUND") {
        setRemoveError(t(pageShareErrorKey(result.error)));
        return;
      }
      setRemoveOpen(false);
      notify.success(t("members.pageShare.removed", { name }));
      await onChanged();
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <MemberAvatar member={share} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 font-medium break-words">{name}</span>
            {share.isGuest && <Badge variant="secondary">{t("members.list.guest")}</Badge>}
          </p>
          {share.fullName && (
            <p className="text-sm break-all text-muted-foreground">{share.email}</p>
          )}
          {share.inherited && (
            <p className="text-sm text-muted-foreground">
              {t("members.pageShare.inheritedFrom", {
                page: share.sourcePageTitle || t("tree.untitled"),
              })}
            </p>
          )}
        </div>
      </div>
      {share.inherited ? (
        <span className="text-sm text-muted-foreground">{t(`space.roles.${share.role}`)}</span>
      ) : (
        <div className="flex items-center gap-2">
          <RoleSelect
            value={share.role}
            roles={PAGE_SHARE_ROLES}
            onChange={onRoleChange}
            label={t("members.pageShare.roleLabel", { name })}
            disabled={rolePending}
            size="sm"
          />
          <ConfirmAction
            trigger={
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("members.pageShare.removeLabel", { name })}
              >
                <UserMinusIcon aria-hidden />
              </Button>
            }
            title={t("members.pageShare.removeConfirmTitle")}
            description={t("members.pageShare.removeConfirmDescription", { name })}
            confirmLabel={t("members.pageShare.remove")}
            pendingLabel={t("members.pageShare.removing")}
            pending={removePending}
            error={removeError}
            open={removeOpen}
            onOpenChange={(next) => {
              setRemoveOpen(next);
              if (!next) setRemoveError(null);
            }}
            onConfirm={onRemove}
          />
        </div>
      )}
    </li>
  );
}
