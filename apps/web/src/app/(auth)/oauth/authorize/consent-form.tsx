"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { ScopeChoice } from "@/components/settings/ai-connections-section";
import { Button } from "@/components/ui/button";
import type { McpScope } from "@/server/mcp/constants";
import { approveAuthorizationAction, denyAuthorizationAction } from "@/server/mcp/actions";

/**
 * Allow / Deny on the consent screen. The action returns the client's redirect URL and the
 * browser goes there itself (a cross-origin redirect after a form POST would hit CSP form-action).
 */
export function ConsentForm({
  clientId,
  redirectUri,
  redirectHost,
  codeChallenge,
  state,
  defaultScope,
}: {
  clientId: string;
  redirectUri: string;
  redirectHost: string;
  codeChallenge: string;
  state: string | null;
  defaultScope: McpScope;
}) {
  const t = useTranslations();
  const scopeId = useId();
  const [scope, setScope] = useState<McpScope>(defaultScope);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<"allow" | "deny" | null>(null);

  const decide = (allow: boolean) => {
    setChoice(allow ? "allow" : "deny");
    startTransition(async () => {
      const result = allow
        ? await approveAuthorizationAction({ clientId, redirectUri, codeChallenge, state, scope })
        : await denyAuthorizationAction({ clientId, redirectUri, state });
      if (!result.ok) {
        setError(t(`errors.${result.error}`));
        setChoice(null);
        return;
      }
      window.location.assign(result.data.redirectTo);
    });
  };

  const busy = pending || choice !== null;
  return (
    <div className="flex flex-col gap-5">
      <ScopeChoice id={scopeId} value={scope} onChange={setScope} />
      <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        {t("mcp.consent.warning")}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button type="button" className="sm:flex-1" disabled={busy} onClick={() => decide(true)}>
          {choice === "allow" ? t("mcp.consent.allowing") : t("mcp.consent.allow")}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="sm:flex-1"
          disabled={busy}
          onClick={() => decide(false)}
        >
          {t("mcp.consent.deny")}
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {t("mcp.consent.redirect", { host: redirectHost })}
      </p>
    </div>
  );
}
