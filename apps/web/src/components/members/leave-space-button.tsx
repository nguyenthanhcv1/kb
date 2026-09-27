"use client";

import { LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { leaveSpace } from "@/server/members/actions";

import { ConfirmAction } from "./confirm-action";
import { memberErrorKey } from "./errors";

/**
 * "Leave space" for an explicit member (any role). The last admin gets `SPACE_REQUIRES_ADMIN`
 * and stays. After leaving, the Space may no longer be visible → back to the Spaces list.
 */
export function LeaveSpaceButton({
  space,
  size = "sm",
}: {
  space: { id: string; name: string };
  size?: "sm" | "default";
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await leaveSpace({ spaceId: space.id });
      if (!result.ok) {
        setError(t(memberErrorKey(result.error)));
        return;
      }
      setOpen(false);
      router.push("/");
      router.refresh();
    });
  }

  return (
    <ConfirmAction
      trigger={
        <Button variant="outline" size={size}>
          <LogOutIcon aria-hidden />
          {t("members.leave.action")}
        </Button>
      }
      title={t("members.leave.confirmTitle")}
      description={t("members.leave.confirmDescription", { space: space.name })}
      confirmLabel={t("members.leave.confirm")}
      pendingLabel={t("members.leave.leaving")}
      pending={pending}
      error={error}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
      onConfirm={onConfirm}
    />
  );
}
