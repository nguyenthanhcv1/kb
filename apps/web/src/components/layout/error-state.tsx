import type { ReactNode } from "react";

type ErrorStateProps = {
  /** Short visual code such as "404"; decorative, the title carries the meaning. */
  code?: string;
  title: string;
  description: string;
  /** Extra line, e.g. the error digest to report. */
  detail?: string;
  actions?: ReactNode;
};

/** Centered full-page message used by the 404 and error pages. */
export function ErrorState({ code, title, description, detail, actions }: ErrorStateProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        {code && (
          <p className="text-6xl font-bold tracking-tight text-muted-foreground" aria-hidden>
            {code}
          </p>
        )}
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
        {detail && <p className="font-mono text-sm text-muted-foreground">{detail}</p>}
        {actions && <div className="flex flex-wrap justify-center gap-2 pt-2">{actions}</div>}
      </div>
    </div>
  );
}
