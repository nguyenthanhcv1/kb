"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { pageHref } from "@/lib/page-href";
import { acceptInvitation } from "@/server/members/actions";

import { memberErrorKey } from "./errors";

/**
 * Accepts the invitation, then opens the Space — or the shared page of a page invitation. Errors
 * (expired meanwhile…) show inline.
 */
export function AcceptInvitationButton({ token }: { token: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onAccept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitation({ token });
      if (!result.ok) {
        setError(t(memberErrorKey(result.error)));
        return;
      }
      const { spaceSlug, page } = result.data;
      router.push(page ? pageHref(spaceSlug, page) : `/s/${encodeURIComponent(spaceSlug)}`);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <Button onClick={onAccept} disabled={pending} className="w-full">
        {pending ? t("members.invitePage.accepting") : t("members.invitePage.accept")}
      </Button>
    </div>
  );
}
