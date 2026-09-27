"use client";

import { SearchIcon, UserPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MEMBER_ROLES, type MemberCandidate, type MemberRole } from "@/server/members";
import { addMember, searchMemberCandidates } from "@/server/members/actions";

import { memberDisplayName } from "./display";
import { memberErrorKey } from "./errors";
import { MemberAvatar } from "./member-avatar";
import { RoleSelect } from "./role-select";

/** Delay between the last keystroke and the search request. */
export const SEARCH_DEBOUNCE_MS = 250;

type Notify = { success: (message: string) => void; error: (message: string) => void };

type SearchResult =
  { status: "done"; candidates: MemberCandidate[] } | { status: "error"; message: string };
type SearchState = { status: "idle" } | { status: "loading" } | SearchResult;

/**
 * Add internal users: accent-insensitive search by name/email among internal people who are not
 * members yet (`searchMemberCandidates`), a role for the new member, and one "Add" per result.
 * Guests cannot be added here — they are invited by email.
 */
export function AddMemberForm({ spaceId, notify }: { spaceId: string; notify: Notify }) {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<MemberRole>("editor");
  // Result of the last finished search, tagged with its query: a newer query shows "loading"
  // until its own result arrives, and late answers to older queries are ignored.
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
      const response = await searchMemberCandidates({ spaceId, query: trimmed });
      if (cancelled) return;
      setResult({
        query: trimmed,
        value: response.ok
          ? { status: "done", candidates: response.data.candidates }
          : { status: "error", message: t(memberErrorKey(response.error)) },
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, spaceId, t]);

  function onAdd(candidate: MemberCandidate) {
    const name = memberDisplayName(candidate) ?? candidate.email;
    setAdding(candidate.userId);
    startTransition(async () => {
      const result = await addMember({ spaceId, userId: candidate.userId, role });
      setAdding(null);
      if (!result.ok) {
        notify.error(t(memberErrorKey(result.error)));
        return;
      }
      notify.success(t("members.add.added", { name }));
      setResult((current) =>
        current?.value.status === "done"
          ? {
              ...current,
              value: {
                ...current.value,
                candidates: current.value.candidates.filter((c) => c.userId !== candidate.userId),
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
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4">
      <div className="grid gap-1">
        <h3 id={`${id}-title`} className="font-semibold">
          {t("members.add.title")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("members.add.description")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-2">
          <Label htmlFor={searchId}>{t("members.add.searchLabel")}</Label>
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
              placeholder={t("members.add.searchPlaceholder")}
              aria-controls={resultsId}
              className="pl-8"
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={roleId}>{t("members.add.roleLabel")}</Label>
          <RoleSelect
            id={roleId}
            value={role}
            roles={MEMBER_ROLES}
            onChange={setRole}
            label={t("members.add.roleLabel")}
          />
        </div>
      </div>
      <div id={resultsId} aria-live="polite" aria-busy={search.status === "loading"}>
        {search.status === "loading" && (
          <p className="text-sm text-muted-foreground">{t("members.add.searching")}</p>
        )}
        {search.status === "error" && <p className="text-sm text-destructive">{search.message}</p>}
        {search.status === "done" && search.candidates.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("members.add.noResults")}</p>
        )}
        {search.status === "done" && search.candidates.length > 0 && (
          <ul className="divide-y rounded-lg border" aria-label={t("members.add.results")}>
            {search.candidates.map((candidate) => {
              const name = memberDisplayName(candidate) ?? candidate.email;
              return (
                <li key={candidate.userId} className="flex items-center gap-3 p-3">
                  <MemberAvatar member={candidate} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{name}</p>
                    {candidate.fullName && (
                      <p className="truncate text-sm text-muted-foreground">{candidate.email}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onAdd(candidate)}
                    disabled={adding !== null}
                    aria-label={t("members.add.addMember", { name })}
                  >
                    <UserPlusIcon aria-hidden />
                    {t("members.add.submit")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
