import { BotIcon, CircleAlertIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/server/auth";
import { authorizeErrorRedirect, validateAuthorizeRequest } from "@/server/mcp/oauth";
import { mcpRequestOrigin } from "@/server/mcp/origin";

import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mcp.consent");
  return { title: t("metaTitle") };
}

/**
 * OAuth consent screen of the MCP connector (`authorization_endpoint`). claude.ai / ChatGPT send
 * the user here; the middleware makes them sign in first (and come back with the same query).
 * Bad requests from a known client go back to it with an `error`; an unknown client or redirect
 * URI is explained here instead (never redirect to an unverified address).
 */
export default async function AuthorizePage({ searchParams }: Props) {
  const raw = await searchParams;
  const params = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  const user = await getCurrentUser();
  if (!user) {
    const query = new URLSearchParams(params as Record<string, string>).toString();
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
  }

  const t = await getTranslations("mcp.consent");
  const validation = await validateAuthorizeRequest(createAdminClient(), params);
  if (!validation.ok) {
    if (validation.redirectUri) {
      redirect(
        authorizeErrorRedirect(
          validation.redirectUri,
          validation.error,
          validation.state,
          await mcpRequestOrigin(),
        ),
      );
    }
    return (
      <div className="flex flex-col items-center gap-3 text-center" role="alert">
        <CircleAlertIcon className="size-8 text-destructive" aria-hidden />
        <h1 className="text-xl font-semibold">{t("errorTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("errorDescription")}</p>
      </div>
    );
  }

  const { request } = validation;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <BotIcon className="size-8 text-primary" aria-hidden />
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm break-words text-muted-foreground">
          {t("description", { client: request.client.name })}
        </p>
        <p className="text-xs text-muted-foreground">{t("account", { email: user.email })}</p>
      </div>
      <ConsentForm
        clientId={request.client.id}
        redirectUri={request.redirectUri}
        redirectHost={new URL(request.redirectUri).host}
        codeChallenge={request.codeChallenge}
        state={request.state}
        defaultScope={request.scope}
      />
    </div>
  );
}
