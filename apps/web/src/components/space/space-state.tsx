import type { ReactNode } from "react";

/** In-shell message (not found, forbidden…) with optional actions, centered in the content area. */
export function SpaceState({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
      {actions && <div className="flex flex-wrap justify-center gap-2 pt-2">{actions}</div>}
    </div>
  );
}
