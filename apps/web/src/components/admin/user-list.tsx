"use client";

import {
  EllipsisVerticalIcon,
  LockIcon,
  LockOpenIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { initials } from "@/components/layout/user-menu";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AdminUser } from "@/server/admin";
import { setUserDeactivated, setUserSuperAdmin } from "@/server/admin/actions";

import { adminErrorKey } from "./errors";
import { userActionInput, userActions, type UserAction } from "./user-actions";

const ACTION_ICONS = {
  lock: LockIcon,
  unlock: LockOpenIcon,
  grant: ShieldCheckIcon,
  revoke: ShieldOffIcon,
} as const;

type Pending = { user: AdminUser; action: UserAction };

/**
 * Users of `/admin/users`: who they are, role badges, why they can sign in, and a menu to lock /
 * unlock them or grant / revoke super admin — each behind a confirmation. Errors (e.g.
 * `LAST_SUPER_ADMIN`) are shown translated in the dialog.
 */
export function UserList({ users }: { users: AdminUser[] }) {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nameOf = (user: AdminUser) => user.fullName ?? user.email;

  function onConfirm() {
    if (!confirming) return;
    const { user, action } = confirming;
    setError(null);
    startTransition(async () => {
      const call = userActionInput(action, user.id);
      const result =
        call.kind === "deactivate"
          ? await setUserDeactivated(call.input)
          : await setUserSuperAdmin(call.input);
      if (!result.ok) {
        setError(t(adminErrorKey(result.error)));
        return;
      }
      setConfirming(null);
      setMessage(t(`admin.users.done.${action}`, { name: nameOf(user) }));
      router.refresh();
    });
  }

  if (users.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        {t("admin.users.empty")}
      </p>
    );
  }

  return (
    <>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {message}
      </p>
      <ul className="divide-y rounded-lg border">
        {users.map((user) => {
          const name = nameOf(user);
          const deactivated = user.deactivatedAt !== null;
          return (
            <li key={user.id} className="flex items-start gap-3 p-4">
              <Avatar className="mt-0.5">
                {user.avatarUrl && (
                  <AvatarImage src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
                )}
                <AvatarFallback className="text-xs font-medium">
                  {initials({ displayName: user.fullName, email: user.email })}
                </AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-words">{name}</span>
                  {user.isSelf && <Badge variant="outline">{t("admin.users.self")}</Badge>}
                  {user.isSuperAdmin && <Badge>{t("admin.users.superAdmin")}</Badge>}
                  {user.isGuest && <Badge variant="secondary">{t("admin.users.guest")}</Badge>}
                  {deactivated && (
                    <Badge variant="destructive">{t("admin.users.status.deactivated")}</Badge>
                  )}
                </div>
                {user.fullName && (
                  <span className="text-sm break-all text-muted-foreground">{user.email}</span>
                )}
                <p className="text-xs text-muted-foreground">
                  {t(`admin.users.access.${user.access}`)}
                  {" · "}
                  {t("admin.users.spaces", { count: user.spaceCount })}
                  {" · "}
                  {deactivated
                    ? t("admin.users.deactivatedAt", { date: new Date(user.deactivatedAt!) })
                    : user.lastSignInAt
                      ? t("admin.users.lastSignIn", { date: new Date(user.lastSignInAt) })
                      : t("admin.users.neverSignedIn")}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("admin.users.actions.open", { name })}
                  >
                    <EllipsisVerticalIcon aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  {userActions(user).map(({ action, disabled }) => {
                    const Icon = ACTION_ICONS[action];
                    return (
                      <DropdownMenuItem
                        key={action}
                        disabled={disabled}
                        variant={
                          action === "lock" || action === "revoke" ? "destructive" : "default"
                        }
                        onSelect={() => {
                          setError(null);
                          setConfirming({ user, action });
                        }}
                      >
                        <Icon aria-hidden />
                        {t(`admin.users.actions.${action}`)}
                      </DropdownMenuItem>
                    );
                  })}
                  {user.isSelf && (
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      {t("admin.users.actions.selfHint")}
                    </DropdownMenuLabel>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirming(null);
        }}
      >
        {confirming && (
          <AlertDialogContent aria-describedby={`${id}-confirm-description`}>
            <AlertDialogHeader>
              <AlertDialogTitle className="break-words">
                {t(`admin.users.confirm.${confirming.action}Title`, {
                  name: nameOf(confirming.user),
                })}
              </AlertDialogTitle>
              <AlertDialogDescription id={`${id}-confirm-description`}>
                {t(`admin.users.confirm.${confirming.action}Description`, {
                  name: nameOf(confirming.user),
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>{t("common.actions.cancel")}</AlertDialogCancel>
              <Button
                variant={
                  confirming.action === "lock" || confirming.action === "revoke"
                    ? "destructive"
                    : "default"
                }
                onClick={onConfirm}
                disabled={pending}
              >
                {pending
                  ? t("admin.users.confirm.working")
                  : t(`admin.users.actions.${confirming.action}`)}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  );
}
