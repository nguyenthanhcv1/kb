"use client";

import { LogOutIcon, SettingsIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CurrentUser } from "@/server/auth/mock";
import { signOut } from "@/server/auth/mock-actions";

/** Up to two initials from the display name, else the first letter of the email. */
export function initials(user: Pick<CurrentUser, "displayName" | "email">): string {
  const words = (user.displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return user.email.charAt(0).toUpperCase();
  const picked = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
  return picked.map((word) => word!.charAt(0).toLocaleUpperCase()).join("");
}

/** Avatar button in the top bar: who is signed in, role badges, settings and sign-out. */
export function UserMenu({ user }: { user: CurrentUser }) {
  const t = useTranslations("auth.userMenu");
  const tNav = useTranslations("nav");
  const [pending, startTransition] = useTransition();
  const name = user.displayName ?? user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={t("open")}>
          <Avatar>
            {user.avatarUrl && (
              <AvatarImage src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
            )}
            <AvatarFallback className="text-xs font-medium">{initials(user)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-1 font-normal">
          <span className="truncate font-medium">{name}</span>
          {user.displayName && (
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
          )}
          {(user.isSuperAdmin || user.isGuest) && (
            <span className="flex gap-1 pt-1">
              {user.isSuperAdmin && <RoleBadge>{t("superAdmin")}</RoleBadge>}
              {user.isGuest && <RoleBadge>{t("guest")}</RoleBadge>}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <SettingsIcon aria-hidden />
            {t("settings")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/whats-new">
            <SparklesIcon aria-hidden />
            {tNav("whatsNew")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            // Keep the menu open so the pending label stays visible until the redirect.
            event.preventDefault();
            startTransition(() => signOut());
          }}
        >
          <LogOutIcon aria-hidden />
          {pending ? t("signingOut") : t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RoleBadge({ children }: { children: string }) {
  return (
    <span className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
      {children}
    </span>
  );
}
