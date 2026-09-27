import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { canCreateSpace } from "@/components/space/permissions";
import { SpaceNav } from "@/components/space/space-nav";
import { appInfo } from "@/lib/env";

import { loadSpaces, requireUser } from "./_lib/data";

/**
 * Signed-in area: app shell with the Spaces the user can view in the sidebar and the running
 * version in its footer. Pages under `(app)` render only their content (no own AppShell).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const spaces = await loadSpaces();
  return (
    <AppShell
      user={user}
      version={appInfo().version}
      sidebar={<SpaceNav spaces={spaces} canCreate={canCreateSpace(user)} />}
    >
      {children}
    </AppShell>
  );
}
