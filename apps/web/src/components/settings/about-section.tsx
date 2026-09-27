import { SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { AboutInfo } from "@/server/release";

/** Commits are shown short (7 characters, like GitHub); the full sha is in the tooltip. */
function shortSha(sha: string): string {
  return /^[0-9a-f]{8,}$/i.test(sha) ? sha.slice(0, 7) : sha;
}

/** Settings › About: running version of kb-web and kb-collab, commit, environment. */
export function AboutSection({ about }: { about: AboutInfo }) {
  const t = useTranslations("settings.about");

  return (
    <section
      aria-labelledby="settings-about"
      className="rounded-xl border bg-card p-4 text-card-foreground shadow-xs sm:p-6"
    >
      <h2 id="settings-about" className="text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>

      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
        <Row label={t("web")}>{t("version", { version: about.version })}</Row>
        <Row label={t("commit")}>
          <code className="font-mono" title={about.sha}>
            {shortSha(about.sha)}
          </code>
        </Row>
        <Row label={t("environment")}>{t(`environments.${about.env}`)}</Row>
        <Row label={t("collab")}>
          {about.collab ? (
            t("collabVersion", {
              version: about.collab.version,
              schemaVersion: about.collab.schemaVersion,
            })
          ) : (
            <span className="text-muted-foreground">{t("collabUnavailable")}</span>
          )}
        </Row>
      </dl>

      <Link
        href="/whats-new"
        className="mt-4 inline-flex items-center gap-2 rounded-sm text-sm font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <SparklesIcon className="size-4" aria-hidden />
        {t("whatsNew")}
      </Link>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
