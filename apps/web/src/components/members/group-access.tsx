"use client";

import { SearchIcon, UsersIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SPACE_GROUP_ROLES,
  type GrantableGroup,
  type SpaceGroup,
  type SpaceGroupRole,
} from "@/server/members";
import {
  addSpaceGroup,
  changeSpaceGroupRole,
  removeSpaceGroup,
  searchGrantableGroups,
} from "@/server/members/actions";

import { SEARCH_DEBOUNCE_MS } from "./add-member-form";
import { ConfirmAction } from "./confirm-action";
import { memberErrorKey } from "./errors";
import { FeedbackMessage, useFeedback } from "./feedback";
import { RoleSelect } from "./role-select";

type Space = { id: string; name: string };
type Notify = { success: (message: string) => void; error: (message: string) => void };

type SearchResult =
  { status: "done"; groups: GrantableGroup[] } | { status: "error"; message: string };
type SearchState = { status: "idle" } | { status: "loading" } | SearchResult;

/**
 * "Groups with access" of the Space settings (admins only): grant a whole group (managed by super
 * admins in `/admin/groups`) the viewer or editor role, change it, or take it away. A group is
 * never a Space admin. Every member gets the highest of their direct role and their groups' roles.
 */
export function GroupAccessSettings({
  space,
  groups,
}: {
  space: Space;
  groups: readonly SpaceGroup[];
}) {
  const t = useTranslations("members.groups");
  const { feedback, success, error } = useFeedback();
  const notify = { success, error };
  const id = useId();

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-6">
      <div className="grid gap-1">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {t("title")}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {t("count", { count: groups.length })}
          </span>
        </h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <AddGroupForm spaceId={space.id} notify={notify} />
      <FeedbackMessage feedback={feedback} />
      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label={t("title")}>
          {groups.map((group) => (
            <GroupRow key={group.groupId} space={space} group={group} notify={notify} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AddGroupForm({ spaceId, notify }: { spaceId: string; notify: Notify }) {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<SpaceGroupRole>("viewer");
  // Same pattern as AddMemberForm: results are tagged with their query, late answers ignored.
  const [result, setResult] = useState<{ query: string; value: SearchResult } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const trimmed = query.trim();
  const search: SearchState = !trimmed
    ? { status: "idle" }
    : result?.query === trimmed
      ? result.value
      : { status: "loading" };

  useEffect(() => {
    if (!trimmed) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const response = await searchGrantableGroups({ spaceId, query: trimmed });
      if (cancelled) return;
      setResult({
        query: trimmed,
        value: response.ok
          ? { status: "done", groups: response.data.groups }
          : { status: "error", message: t(memberErrorKey(response.error)) },
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, spaceId, t]);

  function onAdd(group: GrantableGroup) {
    setAdding(group.groupId);
    startTransition(async () => {
      const response = await addSpaceGroup({ spaceId, groupId: group.groupId, role });
      setAdding(null);
      if (!response.ok) {
        notify.error(t(memberErrorKey(response.error)));
        return;
      }
      notify.success(t("members.groups.added", { name: group.name }));
      setResult((current) =>
        current?.value.status === "done"
          ? {
              ...current,
              value: {
                status: "done",
                groups: current.value.groups.filter((g) => g.groupId !== group.groupId),
              },
            }
          : current,
      );
      router.refresh();
    });
  }

  const searchId = `${id}-search`;
  const roleId = `${id}-role`;
  const resultsId = `${id}-results`;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-2">
          <Label htmlFor={searchId}>{t("members.groups.searchLabel")}</Label>
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id={searchId}
              type="search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("members.groups.searchPlaceholder")}
              aria-controls={resultsId}
              className="pl-8"
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={roleId}>{t("members.groups.roleLabel")}</Label>
          <RoleSelect
            id={roleId}
            value={role}
            roles={SPACE_GROUP_ROLES}
            onChange={setRole}
            label={t("members.groups.roleLabel")}
          />
        </div>
      </div>
      <div id={resultsId} aria-live="polite" aria-busy={search.status === "loading"}>
        {search.status === "loading" && (
          <p className="text-sm text-muted-foreground">{t("members.groups.searching")}</p>
        )}
        {search.status === "error" && <p className="text-sm text-destructive">{search.message}</p>}
        {search.status === "done" && search.groups.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("members.groups.noResults")}</p>
        )}
        {search.status === "done" && search.groups.length > 0 && (
          <ul className="divide-y rounded-lg border" aria-label={t("members.groups.results")}>
            {search.groups.map((group) => (
              <li key={group.groupId} className="flex items-center gap-3 p-3">
                <GroupSummary group={group} />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAdd(group)}
                  disabled={adding !== null}
                  aria-label={t("members.groups.addLabel", { name: group.name })}
                >
                  <UsersIcon aria-hidden />
                  {t("members.groups.submit")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Icon, name, member count and description of a group. */
function GroupSummary({ group }: { group: GrantableGroup }) {
  const t = useTranslations("members.groups");
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden
      >
        <UsersIcon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="font-medium break-words">{group.name}</p>
        <p className="text-sm break-words text-muted-foreground">
          {t("members", { count: group.memberCount })}
          {group.description ? (
            <>
              <span aria-hidden> · </span>
              {group.description}
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function GroupRow({ space, group, notify }: { space: Space; group: SpaceGroup; notify: Notify }) {
  const t = useTranslations();
  const router = useRouter();
  const [role, setRole] = useState<SpaceGroupRole>(group.role);
  const [rolePending, startRoleTransition] = useTransition();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removePending, startRemoveTransition] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const name = group.name;

  function onRoleChange(next: SpaceGroupRole) {
    if (next === role) return;
    const previous = role;
    setRole(next);
    startRoleTransition(async () => {
      const result = await changeSpaceGroupRole({
        spaceId: space.id,
        groupId: group.groupId,
        role: next,
      });
      if (!result.ok) {
        setRole(previous);
        notify.error(t(memberErrorKey(result.error)));
        return;
      }
      notify.success(t("members.groups.roleChanged", { name, role: t(`space.roles.${next}`) }));
      router.refresh();
    });
  }

  function onRemove() {
    setRemoveError(null);
    startRemoveTransition(async () => {
      const result = await removeSpaceGroup({ spaceId: space.id, groupId: group.groupId });
      if (!result.ok && result.error !== "SPACE_GROUP_NOT_FOUND") {
        setRemoveError(t(memberErrorKey(result.error)));
        return;
      }
      setRemoveOpen(false);
      notify.success(t("members.groups.removed", { name }));
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4">
      <GroupSummary group={group} />
      <div className="flex items-center gap-2">
        <RoleSelect
          value={role}
          roles={SPACE_GROUP_ROLES}
          onChange={onRoleChange}
          label={t("members.groups.roleItemLabel", { name })}
          disabled={rolePending}
          size="sm"
        />
        <ConfirmAction
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("members.groups.removeLabel", { name })}
              title={t("members.groups.remove")}
            >
              <XIcon aria-hidden />
            </Button>
          }
          title={t("members.groups.removeConfirmTitle")}
          description={t("members.groups.removeConfirmDescription", { name, space: space.name })}
          confirmLabel={t("members.groups.remove")}
          pendingLabel={t("members.groups.removing")}
          pending={removePending}
          error={removeError}
          open={removeOpen}
          onOpenChange={(next) => {
            setRemoveOpen(next);
            if (!next) setRemoveError(null);
          }}
          onConfirm={onRemove}
        />
      </div>
    </li>
  );
}
