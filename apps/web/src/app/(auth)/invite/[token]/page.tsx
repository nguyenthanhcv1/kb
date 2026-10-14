import { CircleAlertIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";

import { AcceptInvitationButton } from "@/components/members/accept-invitation-button";
import { memberErrorKey } from "@/components/members/errors";
import { invitationView } from "@/components/members/invitation-view";
import { SpaceIcon } from "@/components/space/space-icon";
import { Button } from "@/components/ui/button";
import { pageHref } from "@/lib/page-href";
import { getCurrentUser } from "@/server/auth";
import type { MemberErrorCode } from "@/server/members";
import { getInvitation } from "@/server/members/actions";

import { switchAccountForInvitation } from "./actions";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("members.invitePage");
  return { title: t("metaTitle") };
}

/**
 * `/invite/<token>` — the link from the invitation email (T1.5). The middleware only requires a
 * session here (not `has_active_access`: a guest has no membership until they accept), and sends
 * signed-out visitors to `/login?next=/invite/<token>`. Shows the invitation, then accepts it and
 * opens the Space (or the shared page of a page invitation); used / revoked / expired / unknown
 * links and a wrong account get a translated explanation.
 */
export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  const loginUrl = `/login?next=${encodeURIComponent(`/invite/${encodeURIComponent(token)}`)}`;
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl);

  const t = await getTranslations();
  const result = await getInvitation({ token: token });
  if (!result.ok) {
    if (result.error === "UNAUTHORIZED") redirect(loginUrl);
    return <InvitationError code={result.error} />;
  }

  const preview = result.data;
  const view = invitationView(preview);
  const page = preview.page;
  if (view.kind === "error") {
    const href = !view.canOpenSpace
      ? null
      : page
        ? pageHref(preview.spaceSlug, page)
        : `/s/${encodeURIComponent(preview.spaceSlug)}`;
    return <InvitationError code={view.code} href={href} isPage={page !== null} />;
  }
  const pageTitle = page ? page.title || t("tree.untitled") : null;
  const inviter = preview.inviterName || preview.inviterEmail;

  const format = await getFormatter();
  const expires = format.dateTime(new Date(preview.expiresAt), {
    dateStyle: "long",
    timeStyle: "short",
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <SpaceIcon icon={preview.spaceIcon} name={preview.spaceName} size="lg" />
        <h1 className="text-xl font-semibold">
          {pageTitle === null ? t("members.invitePage.title") : t("members.invitePage.pageTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {pageTitle !== null
            ? inviter
              ? t("members.invitePage.pageDescription", { inviter, page: pageTitle })
              : t("members.invitePage.pageDescriptionNoInviter", { page: pageTitle })
            : inviter
              ? t("members.invitePage.description", { inviter, space: preview.spaceName })
              : t("members.invitePage.descriptionNoInviter", { space: preview.spaceName })}
        </p>
      </div>
      <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
        {pageTitle !== null ? (
          <>
            <p className="font-medium break-words">
              {page?.icon && (
                <span aria-hidden className="me-1">
                  {page.icon}
                </span>
              )}
              {pageTitle}
            </p>
            <p className="text-muted-foreground">
              {t("members.invitePage.pageInSpace", { space: preview.spaceName })}
            </p>
            <p className="text-muted-foreground">{t("members.invitePage.pageScope")}</p>
          </>
        ) : (
          <p className="font-medium break-words">{preview.spaceName}</p>
        )}
        <p>{t("members.invitePage.role", { role: t(`space.roles.${preview.role}`) })}</p>
        <p className="text-muted-foreground">
          {t("members.invitePage.expires", { date: expires })}
        </p>
      </div>

      {view.kind === "accept" ? (
        <AcceptInvitationButton token={token} />
      ) : (
        <div className="flex flex-col gap-3">
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">
              {t("members.invitePage.mismatch", { invited: preview.email, current: user.email })}
            </span>
          </p>
          <form action={switchAccountForInvitation}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" className="w-full">
              {t("members.invitePage.switchAccount")}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

async function InvitationError({
  code,
  href = null,
  isPage = false,
}: {
  code: MemberErrorCode;
  /** Where an already accepted invitation leads (the Space or the shared page). */
  href?: string | null;
  isPage?: boolean;
}) {
  const t = await getTranslations();
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <CircleAlertIcon className="size-6" aria-hidden />
      </div>
      <h1 className="text-xl font-semibold">{t("members.invitePage.errorTitle")}</h1>
      <p role="alert" className="text-sm text-muted-foreground">
        {t(memberErrorKey(code))}
      </p>
      <Button asChild className="mt-2 w-full" variant={href ? "default" : "outline"}>
        <Link href={href ?? "/"}>
          {!href
            ? t("members.invitePage.backHome")
            : isPage
              ? t("members.invitePage.openPage")
              : t("members.invitePage.openSpace")}
        </Link>
      </Button>
    </div>
  );
}
