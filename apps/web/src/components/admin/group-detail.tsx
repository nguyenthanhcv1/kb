"use client";

import { SearchIcon, Trash2Icon, UserMinusIcon, UserPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, useTransition } from "react";

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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addGroupMembers,
  deleteGroup,
  removeGroupMember,
  searchGroupCandidates,
  updateGroup,
} from "@/server/admin/actions";
import {
  GROUP_DESCRIPTION_MAX,
  GROUP_NAME_MAX,
  type Group,
  type GroupCandidate,
  type GroupMember,
} from "@/server/admin/groups";

import { adminErrorKey } from "./errors";

/** Delay between the last keystroke and the search request. */
export const GROUP_SEARCH_DEBOUNCE_MS = 250;

type Person = Pick<GroupCandidate, "fullName" | "email" | "avatarUrl">;
const nameOf = (person: Person) => person.fullName?.trim() || person.email;

function PersonAvatar({ person }: { person: Person }) {
  return (
    <Avatar className="size-9" aria-hidden>
      {person.avatarUrl && (
        <AvatarImage src={person.avatarUrl} alt="" referrerPolicy="no-referrer" />
      )}
      <AvatarFallback className="text-xs font-medium">
        {initials({ displayName: person.fullName, email: person.email })}
      </AvatarFallback>
    </Avatar>
  );
}

type SearchResult =
  { status: "done"; candidates: GroupCandidate[] } | { status: "error"; message: string };

/**
 * One group of `/admin/groups/<id>`: edit its name and description, delete it (the dialog says
 * how many people lose access), list its members with "Remove", and add internal users found by
 * an accent-insensitive search.
 */
export function GroupDetail({ group, members }: { group: Group; members: GroupMember[] }) {
  const t = useTranslations("admin.groups");
  const tc = useTranslations();
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ query: string; value: SearchResult } | null>(null);
  const trimmed = query.trim();
  const search = !trimmed
    ? ({ status: "idle" } as const)
    : result?.query === trimmed
      ? result.value
      : ({ status: "loading" } as const);

  useEffect(() => {
    if (!trimmed) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const response = await searchGroupCandidates({ groupId: group.id, query: trimmed });
      if (cancelled) return;
      setResult({
        query: trimmed,
        value: response.ok
          ? { status: "done", candidates: response.data.candidates }
          : { status: "error", message: tc(adminErrorKey(response.error)) },
      });
    }, GROUP_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, group.id, tc]);

  const dirty = name.trim() !== group.name || description.trim() !== (group.description ?? "");

  function onSave(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const response = await updateGroup({
        groupId: group.id,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      if (!response.ok) {
        setError(tc(adminErrorKey(response.error)));
        return;
      }
      setMessage(t("edit.saved"));
      router.refresh();
    });
  }

  function onAdd(candidate: GroupCandidate) {
    setBusy(candidate.userId);
    setMessage(null);
    startTransition(async () => {
      const response = await addGroupMembers({ groupId: group.id, userIds: [candidate.userId] });
      setBusy(null);
      if (!response.ok) {
        setError(tc(adminErrorKey(response.error)));
        return;
      }
      setError(null);
      setMessage(t("membersSection.added", { name: nameOf(candidate) }));
      setResult((current) =>
        current?.value.status === "done"
          ? {
              ...current,
              value: {
                status: "done",
                candidates: current.value.candidates.filter((c) => c.userId !== candidate.userId),
              },
            }
          : current,
      );
      router.refresh();
    });
  }

  function onRemove(member: GroupMember) {
    setBusy(member.userId);
    setMessage(null);
    startTransition(async () => {
      const response = await removeGroupMember({ groupId: group.id, userId: member.userId });
      setBusy(null);
      if (!response.ok) {
        setError(tc(adminErrorKey(response.error)));
        return;
      }
      setError(null);
      setMessage(t("membersSection.removed", { name: nameOf(member) }));
      router.refresh();
    });
  }

  function onDelete() {
    setDeleteError(null);
    startTransition(async () => {
      const response = await deleteGroup({ groupId: group.id });
      if (!response.ok) {
        setDeleteError(tc(adminErrorKey(response.error)));
        return;
      }
      router.push("/admin/groups");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {message}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <section aria-labelledby={`${id}-details`} className="grid gap-4">
        <h2 id={`${id}-details`} className="font-semibold">
          {t("edit.title")}
        </h2>
        <form onSubmit={onSave} className="grid gap-4 sm:max-w-lg">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-name`}>{t("edit.nameLabel")}</Label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={GROUP_NAME_MAX}
              disabled={pending}
              required
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-description`}>{t("edit.descriptionLabel")}</Label>
            <Textarea
              id={`${id}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={GROUP_DESCRIPTION_MAX}
              rows={3}
              disabled={pending}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || !dirty || name.trim() === ""}>
              {pending && busy === null ? t("edit.working") : t("edit.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="text-destructive"
              onClick={() => {
                setDeleteError(null);
                setConfirmingDelete(true);
              }}
              disabled={pending}
            >
              <Trash2Icon aria-hidden />
              {t("delete.label")}
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby={`${id}-members`} className="grid gap-3">
        <h2 id={`${id}-members`} className="font-semibold">
          {t("membersSection.title")} · {t("members", { count: members.length })}
        </h2>
        {members.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("membersSection.empty")}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {members.map((member) => (
              <li key={member.userId} className="flex items-center gap-3 p-3">
                <PersonAvatar person={member} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{nameOf(member)}</p>
                  {member.fullName && (
                    <p className="truncate text-sm text-muted-foreground">{member.email}</p>
                  )}
                </div>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {t("membersSection.addedAt", { date: new Date(member.addedAt) })}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onRemove(member)}
                  disabled={pending}
                  aria-label={t("membersSection.removeLabel", { name: nameOf(member) })}
                >
                  <UserMinusIcon aria-hidden />
                  {t("membersSection.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${id}-add`} className="grid gap-3">
        <div className="grid gap-1">
          <h2 id={`${id}-add`} className="font-semibold">
            {t("add.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("add.description")}</p>
        </div>
        <div className="grid gap-2 sm:max-w-lg">
          <Label htmlFor={`${id}-search`}>{t("add.searchLabel")}</Label>
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id={`${id}-search`}
              type="search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("add.searchPlaceholder")}
              aria-controls={`${id}-results`}
              className="pl-8"
            />
          </div>
        </div>
        <div id={`${id}-results`} aria-live="polite" aria-busy={search.status === "loading"}>
          {search.status === "loading" && (
            <p className="text-sm text-muted-foreground">{t("add.searching")}</p>
          )}
          {search.status === "error" && (
            <p className="text-sm text-destructive">{search.message}</p>
          )}
          {search.status === "done" && search.candidates.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("add.noResults")}</p>
          )}
          {search.status === "done" && search.candidates.length > 0 && (
            <ul className="divide-y rounded-lg border" aria-label={t("add.results")}>
              {search.candidates.map((candidate) => (
                <li key={candidate.userId} className="flex items-center gap-3 p-3">
                  <PersonAvatar person={candidate} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{nameOf(candidate)}</p>
                    {candidate.fullName && (
                      <p className="truncate text-sm text-muted-foreground">{candidate.email}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onAdd(candidate)}
                    disabled={pending}
                    aria-label={t("add.addLabel", { name: nameOf(candidate) })}
                  >
                    <UserPlusIcon aria-hidden />
                    {t("add.submit")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <AlertDialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmingDelete(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              {t("delete.title", { name: group.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete.description", { count: members.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{tc("common.actions.cancel")}</AlertDialogCancel>
            <Button variant="destructive" onClick={onDelete} disabled={pending}>
              {pending ? t("delete.working") : t("delete.confirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
