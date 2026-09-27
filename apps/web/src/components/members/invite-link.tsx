"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Freshly created invitation link (the raw token exists only here and in the email) with a copy
 * button, so an admin can share it by hand when email is not configured or failed.
 */
export function InviteLink({ url }: { url: string }) {
  const t = useTranslations("members.invite");
  const id = useId();
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure origin, permissions): the field stays selectable.
      document.getElementById(id)?.focus();
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t("linkLabel")}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="font-mono text-xs"
        />
        <Button type="button" variant="outline" onClick={onCopy}>
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          <span className="sr-only sm:not-sr-only">{t("copy")}</span>
        </Button>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {copied ? t("copied") : null}
      </p>
    </div>
  );
}
