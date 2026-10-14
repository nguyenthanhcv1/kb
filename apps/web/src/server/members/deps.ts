/** Side effects of sending invitations/share emails, shared by the members and page-shares actions. */
import { headers } from "next/headers";

import { webEnv } from "@/lib/env";
import { mailerFromEnv, type Mailer } from "@/server/email/mailer";

import type { InvitationDeps } from "./index";

let cachedMailer: Mailer | null | undefined;

/** `APP_URL` (required when deployed), else the request origin (local dev). */
export async function invitationDeps(): Promise<InvitationDeps> {
  const env = webEnv();
  cachedMailer ??= mailerFromEnv(env);
  let appUrl = env.APP_URL;
  if (!appUrl) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    const proto = h.get("x-forwarded-proto") ?? "http";
    appUrl = h.get("origin") ?? `${proto}://${host}`;
  }
  return { appUrl, mailer: cachedMailer };
}
