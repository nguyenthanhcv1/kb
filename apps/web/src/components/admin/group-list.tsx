"use client";

import { ChevronRightIcon, PlusIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createGroup } from "@/server/admin/actions";
import { GROUP_DESCRIPTION_MAX, GROUP_NAME_MAX, type Group } from "@/server/admin/groups";

import { adminErrorKey } from "./errors";

/**
 * Groups of `/admin/groups`: one row per group (name, description, member count) linking to its
 * page, and "New group". Errors such as `GROUP_NAME_TAKEN` are shown translated in the dialog.
 */
export function GroupList({ groups }: { groups: Group[] }) {
  const t = useTranslations("admin.groups");
  const tc = useTranslations();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    if (pending) return;
    if (next) {
      setName("");
      setDescription("");
      setError(null);
    }
    setOpen(next);
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createGroup({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      if (!result.ok) {
        setError(tc(adminErrorKey(result.error)));
        return;
      }
      setOpen(false);
      setMessage(t("create.created", { name: name.trim() }));
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("count", { count: groups.length })}</p>
        <Button onClick={() => onOpenChange(true)}>
          <PlusIcon aria-hidden />
          {t("create.label")}
        </Button>
      </div>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {message}
      </p>

      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {groups.map((group) => (
            <li key={group.id}>
              <Link
                href={`/admin/groups/${group.id}`}
                aria-label={t("open", { name: group.name })}
                className="flex items-center gap-3 p-4 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <UsersIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="font-medium break-words">{group.name}</span>
                  {group.description && (
                    <span className="text-sm break-words text-muted-foreground">
                      {group.description}
                    </span>
                  )}
                </div>
                <span className="text-sm whitespace-nowrap text-muted-foreground">
                  {t("members", { count: group.memberCount })}
                </span>
                <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("create.title")}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-name`}>{t("create.nameLabel")}</Label>
              <Input
                id={`${id}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={GROUP_NAME_MAX}
                placeholder={t("create.namePlaceholder")}
                disabled={pending}
                required
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-description`}>{t("create.descriptionLabel")}</Label>
              <Textarea
                id={`${id}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={GROUP_DESCRIPTION_MAX}
                rows={3}
                disabled={pending}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                {tc("common.actions.cancel")}
              </Button>
              <Button type="submit" disabled={pending || name.trim() === ""}>
                {pending ? t("create.working") : t("create.submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
