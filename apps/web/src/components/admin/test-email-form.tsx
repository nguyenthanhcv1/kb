"use client";

import { SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendTestEmail } from "@/server/admin/actions";

import { adminErrorKey } from "./errors";

const emailSchema = z.email();

/** "Send test email" of `/admin/access`: checks the SMTP settings; empty recipient = yourself. */
export function TestEmailForm({ defaultRecipient }: { defaultRecipient: string }) {
  const t = useTranslations();
  const id = useId();
  const [to, setTo] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSentTo(null);
    const recipient = to.trim();
    if (recipient && !emailSchema.safeParse(recipient).success) {
      setInvalid(true);
      return;
    }
    startTransition(async () => {
      const result = await sendTestEmail(recipient ? { to: recipient } : {});
      if (!result.ok) {
        setError(t(adminErrorKey(result.error)));
        return;
      }
      setSentTo(result.data.to);
    });
  }

  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-4 rounded-lg border bg-card p-4">
      <div className="grid gap-1">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {t("admin.access.testEmail.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("admin.access.testEmail.description")}</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-to`}>{t("admin.access.testEmail.toLabel")}</Label>
          <Input
            id={`${id}-to`}
            name="to"
            type="email"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setInvalid(false);
            }}
            placeholder={defaultRecipient}
            autoComplete="off"
            disabled={pending}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${id}-invalid` : undefined}
          />
          {invalid && (
            <p id={`${id}-invalid`} className="text-sm text-destructive">
              {t("admin.access.testEmail.invalidEmail")}
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" disabled={pending}>
            <SendIcon aria-hidden />
            {pending ? t("admin.access.testEmail.sending") : t("admin.access.testEmail.send")}
          </Button>
          <p role="status" className="text-sm text-muted-foreground">
            {sentTo ? t("admin.access.testEmail.sent", { to: sentTo }) : null}
          </p>
        </div>
      </form>
    </section>
  );
}
