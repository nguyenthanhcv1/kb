"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { initials } from "@/components/layout/user-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { REJECT_REASON_MAX, type PendingAccount } from "@/server/admin";
import { approveAccount, rejectAccount } from "@/server/admin/actions";

import { adminErrorKey } from "./errors";

type Review = { account: PendingAccount; action: "approve" | "reject" };
type Kind = "internal" | "guest";

/**
 * Accounts of `/admin/approvals`: who signed up and when, with "Approve" (the admin must pick
 * internal user or guest — no default, it decides which Spaces they see) and "Reject" (optional
 * reason, emailed to the person). A rejected account can still be approved later.
 */
export function PendingAccountList({ accounts }: { accounts: PendingAccount[] }) {
  const t = useTranslations("admin.approvals");
  const tc = useTranslations();
  const router = useRouter();
  const id = useId();
  const [review, setReview] = useState<Review | null>(null);
  const [kind, setKind] = useState<Kind | "">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nameOf = (account: PendingAccount) => account.fullName ?? account.email;

  function open(next: Review) {
    setError(null);
    setKind("");
    setReason("");
    setReview(next);
  }

  function onConfirm() {
    if (!review) return;
    const { account, action } = review;
    if (action === "approve" && kind === "") return;
    setError(null);
    startTransition(async () => {
      const result =
        action === "approve"
          ? await approveAccount({ userId: account.id, guest: kind === "guest" })
          : await rejectAccount({ userId: account.id, reason: reason.trim() || undefined });
      if (!result.ok) {
        setError(tc(adminErrorKey(result.error)));
        return;
      }
      setReview(null);
      const done = t(`done.${action}`, { name: nameOf(account) });
      setMessage(result.data.notified ? done : `${done} ${t("done.notNotified")}`);
      router.refresh();
    });
  }

  if (accounts.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        {t("empty")}
      </p>
    );
  }

  return (
    <>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {message}
      </p>
      <ul className="divide-y rounded-lg border">
        {accounts.map((account) => {
          const name = nameOf(account);
          return (
            <li key={account.id} className="flex flex-wrap items-start gap-3 p-4">
              <Avatar className="mt-0.5">
                {account.avatarUrl && (
                  <AvatarImage src={account.avatarUrl} alt="" referrerPolicy="no-referrer" />
                )}
                <AvatarFallback className="text-xs font-medium">
                  {initials({ displayName: account.fullName, email: account.email })}
                </AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-words">{name}</span>
                  {account.status === "rejected" && (
                    <Badge variant="destructive">{t("status.rejected")}</Badge>
                  )}
                </div>
                {account.fullName && (
                  <span className="text-sm break-all text-muted-foreground">{account.email}</span>
                )}
                <p className="text-xs text-muted-foreground">
                  {t("signedUpAt", { date: new Date(account.createdAt) })}
                  {account.status === "rejected" && account.reviewedAt
                    ? ` · ${t("rejectedAt", { date: new Date(account.reviewedAt) })}`
                    : ""}
                </p>
                {account.status === "rejected" && account.rejectReason && (
                  <p className="text-sm break-words">
                    {t("reasonLabel")}: {account.rejectReason}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  aria-label={t("approve.open", { name })}
                  onClick={() => open({ account, action: "approve" })}
                >
                  <CheckIcon aria-hidden />
                  {t("approve.label")}
                </Button>
                {account.status === "pending" && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={t("reject.open", { name })}
                    onClick={() => open({ account, action: "reject" })}
                  >
                    <XIcon aria-hidden />
                    {t("reject.label")}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={review !== null}
        onOpenChange={(openState) => {
          if (!openState && !pending) setReview(null);
        }}
      >
        {review && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="break-words">
                {t(`${review.action}.title`, { name: nameOf(review.account) })}
              </DialogTitle>
              <DialogDescription className="break-all">{review.account.email}</DialogDescription>
            </DialogHeader>

            {review.action === "approve" ? (
              <fieldset className="grid gap-3">
                <legend className="mb-1 text-sm font-medium">{t("approve.kindLabel")}</legend>
                <RadioGroup
                  value={kind}
                  onValueChange={(value) => setKind(value as Kind)}
                  aria-label={t("approve.kindLabel")}
                >
                  {(["internal", "guest"] as const).map((option) => (
                    <div key={option} className="flex items-start gap-3">
                      <RadioGroupItem
                        value={option}
                        id={`${id}-${option}`}
                        className="mt-0.5"
                        disabled={pending}
                      />
                      <Label htmlFor={`${id}-${option}`} className="grid gap-0.5 font-normal">
                        <span className="font-medium">{t(`approve.kind.${option}`)}</span>
                        <span className="text-muted-foreground">
                          {t(`approve.kind.${option}Hint`)}
                        </span>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </fieldset>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor={`${id}-reason`}>{t("reject.reasonLabel")}</Label>
                <Textarea
                  id={`${id}-reason`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={REJECT_REASON_MAX}
                  rows={3}
                  disabled={pending}
                  placeholder={t("reject.reasonPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">{t("reject.reasonHint")}</p>
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setReview(null)} disabled={pending}>
                {tc("common.actions.cancel")}
              </Button>
              <Button
                variant={review.action === "reject" ? "destructive" : "default"}
                onClick={onConfirm}
                disabled={pending || (review.action === "approve" && kind === "")}
              >
                {pending ? t("working") : t(`${review.action}.confirm`)}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
