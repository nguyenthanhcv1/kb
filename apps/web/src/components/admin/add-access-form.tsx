"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ACCESS_BULK_MAX, type AddAccessEntriesOutput } from "@/server/admin";
import { addAccessEntries } from "@/server/admin/actions";

import {
  accessInputProblem,
  notAddedResults,
  summarizeAccessInput,
  type AccessInputProblem,
} from "./access-input";
import { adminErrorKey } from "./errors";

/**
 * Bulk "add emails or domains" form of `/admin/access`: a live preview with the server's parser,
 * the public-domain warning + confirmation, then a per-token report of what was (not) added and
 * how many registered users the new entries cover.
 */
export function AddAccessForm() {
  const t = useTranslations();
  const router = useRouter();
  const id = useId();
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [publicConfirmed, setPublicConfirmed] = useState(false);
  const [problem, setProblem] = useState<AccessInputProblem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AddAccessEntriesOutput | null>(null);
  const [pending, startTransition] = useTransition();

  const summary = useMemo(() => summarizeAccessInput(input), [input]);
  const notAdded = result ? notAddedResults(result.results) : [];
  const problemMessage =
    problem === "tooMany"
      ? t("admin.access.add.tooMany", { max: ACCESS_BULK_MAX })
      : problem
        ? t(`admin.access.add.${problem}`)
        : null;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    const blocking = accessInputProblem(summary, publicConfirmed);
    setProblem(blocking);
    if (blocking) return;
    startTransition(async () => {
      const response = await addAccessEntries({
        input,
        note: note.trim() || null,
        allowPublicDomains: publicConfirmed,
      });
      if (!response.ok) {
        setError(t(adminErrorKey(response.error)));
        return;
      }
      setResult(response.data);
      setInput("");
      setPublicConfirmed(false);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-4 rounded-lg border bg-card p-4">
      <div className="grid gap-1">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {t("admin.access.add.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("admin.access.add.description")}</p>
      </div>

      <form onSubmit={onSubmit} noValidate className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-input`}>{t("admin.access.add.inputLabel")}</Label>
          <Textarea
            id={`${id}-input`}
            name="entries"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setProblem(null);
            }}
            rows={4}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={pending}
            aria-invalid={problem !== null}
            aria-describedby={`${id}-hint ${id}-preview${problem ? ` ${id}-problem` : ""}`}
          />
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {t("admin.access.add.inputHint")}
          </p>
          <p id={`${id}-preview`} aria-live="polite" className="text-sm text-muted-foreground">
            {summary.tokens.length > 0
              ? t("admin.access.add.preview", {
                  valid: summary.valid,
                  emails: summary.emails,
                  domains: summary.domains,
                  invalid: summary.invalid,
                  duplicate: summary.duplicate,
                })
              : null}
          </p>
        </div>

        {summary.publicDomains.length > 0 && (
          <div
            role="alert"
            className="grid gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
          >
            {summary.publicDomains.map((domain) => (
              <p key={domain} className="flex gap-2">
                <TriangleAlertIcon
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                  aria-hidden
                />
                <span>{t("admin.access.publicDomainWarning", { domain })}</span>
              </p>
            ))}
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-confirm-public`}
                checked={publicConfirmed}
                onCheckedChange={(checked) => {
                  setPublicConfirmed(checked === true);
                  setProblem(null);
                }}
                disabled={pending}
              />
              <Label htmlFor={`${id}-confirm-public`} className="leading-snug">
                {t("admin.access.add.confirmPublic")}
              </Label>
            </div>
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor={`${id}-note`}>{t("admin.access.add.noteLabel")}</Label>
          <Input
            id={`${id}-note`}
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={200}
            placeholder={t("admin.access.add.notePlaceholder")}
            autoComplete="off"
            disabled={pending}
          />
        </div>

        {problemMessage && (
          <p id={`${id}-problem`} role="alert" className="text-sm text-destructive">
            {problemMessage}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? t("admin.access.add.submitting") : t("admin.access.add.submit")}
          </Button>
        </div>
      </form>

      <div role="status" className="text-sm empty:hidden">
        {result && (
          <div className="grid gap-2 rounded-md bg-muted p-3">
            <p className="font-medium">
              {t("admin.access.add.resultAdded", { count: result.added.length })}{" "}
              {result.added.length > 0 &&
                t("admin.access.add.resultMatched", { count: result.matchedUsers })}
            </p>
            {notAdded.length > 0 && (
              <>
                <p>{t("admin.access.add.notAdded", { count: notAdded.length })}</p>
                <ul className="grid gap-1 pl-4 text-muted-foreground">
                  {notAdded.map((row, index) => (
                    <li key={`${row.raw}-${index}`} className="list-disc break-all">
                      {t("admin.access.add.resultRow", {
                        value: row.value ?? row.raw,
                        status: t(`admin.access.addStatus.${row.status}`),
                      })}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
