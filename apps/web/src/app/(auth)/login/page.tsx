import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentUser } from "@/server/auth/mock";
import { signInWithGoogle } from "@/server/auth/mock-actions";

import { safeNextPath } from "../_lib/safe-next";
import { GoogleSignInButton } from "./google-sign-in-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");
  return { title: t("title") };
}

type LoginSearchParams = {
  /** Path to return to after sign-in (set by the middleware). */
  next?: string | string[];
  /** Error code from the OAuth callback or the middleware, e.g. `AUTH_SESSION_EXPIRED`. */
  error?: string | string[];
  /** Set by sign-out. */
  signedOut?: string | string[];
};

/** Error codes the login page explains; anything else shows the generic message. */
const LOGIN_ERRORS = [
  "AUTH_ACCESS_REVOKED",
  "AUTH_CALLBACK_FAILED",
  "AUTH_SESSION_EXPIRED",
] as const;
type LoginError = (typeof LOGIN_ERRORS)[number];
const isLoginError = (code: string): code is LoginError =>
  (LOGIN_ERRORS as readonly string[]).includes(code);

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<LoginSearchParams>;
}) {
  const params = await searchParams;
  const next = safeNextPath(first(params.next));
  const error = first(params.error);

  if (error === "AUTH_NOT_ALLOWED") redirect("/access-denied");
  if (await getCurrentUser()) redirect(next);

  const t = await getTranslations("auth.login");
  const errorKey = error && isLoginError(error) ? error : "unknown";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t(`errors.${errorKey}`)}
        </p>
      )}
      {!error && first(params.signedOut) && (
        <p role="status" className="flex items-start gap-2 rounded-md border bg-muted p-3 text-sm">
          <CircleCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("signedOut")}
        </p>
      )}

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <GoogleSignInButton />
      </form>

      <p className="text-center text-xs text-muted-foreground">{t("note")}</p>
    </div>
  );
}
