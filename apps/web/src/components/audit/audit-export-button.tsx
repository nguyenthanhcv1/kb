"use client";

import { DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type State =
  | { status: "idle" | "busy" }
  | { status: "done"; truncated: boolean }
  | { status: "error"; code: ErrorCode };

const ERROR_CODES = [
  "AUDIT_QUERY_FAILED",
  "FORBIDDEN",
  "UNAUTHORIZED",
  "VALIDATION_FAILED",
] as const;
type ErrorCode = (typeof ERROR_CODES)[number];

function toErrorCode(value: unknown): ErrorCode {
  return ERROR_CODES.find((code) => code === value) ?? "AUDIT_QUERY_FAILED";
}

/**
 * Downloads the audit log as CSV (T6.4a `GET /api/audit/export`) with the filters currently
 * applied. Uses `fetch` so a failure shows a translated message instead of a JSON page.
 */
export function AuditExportButton({ href }: { href: string }) {
  const t = useTranslations();
  const [state, setState] = useState<State>({ status: "idle" });

  async function download() {
    setState({ status: "busy" });
    try {
      const response = await fetch(href, { credentials: "same-origin" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        setState({ status: "error", code: toErrorCode(body?.error) });
        return;
      }
      const filename =
        /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ??
        "audit.csv";
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setState({ status: "done", truncated: response.headers.get("x-audit-truncated") === "1" });
    } catch {
      setState({ status: "error", code: "AUDIT_QUERY_FAILED" });
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={download}
        disabled={state.status === "busy"}
        aria-busy={state.status === "busy" || undefined}
      >
        <DownloadIcon aria-hidden />
        {state.status === "busy" ? t("audit.export.busy") : t("audit.export.button")}
      </Button>
      <div role="status" className="text-sm text-muted-foreground">
        {state.status === "done" &&
          (state.truncated ? t("audit.export.truncated") : t("audit.export.done"))}
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${state.code}`)}
        </p>
      )}
    </div>
  );
}
