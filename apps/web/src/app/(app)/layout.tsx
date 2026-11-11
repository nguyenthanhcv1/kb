import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { parseSidebarWidth, SIDEBAR_WIDTH_COOKIE } from "@/components/layout/sidebar-width";
import { canCreateSpace } from "@/components/space/permissions";
import { SharedPagesNav } from "@/components/space/shared-pages-nav";
import { SpaceNav } from "@/components/space/space-nav";
import { appInfo } from "@/lib/env";

import { loadSharedPages, loadSpaces, requireUser } from "./_lib/data";

/**
 * Signed-in area: app shell with the Spaces the user can view (and the pages shared with them) in
 * the sidebar and the running version in its footer. Pages under `(app)` render only their content (no own AppShell).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const [spaces, sharedPages, cookieStore] = await Promise.all([
    loadSpaces(),
    loadSharedPages(),
    cookies(),
  ]);
  return (
    <AppShell
      user={user}
      version={appInfo().version}
      sidebarWidth={parseSidebarWidth(cookieStore.get(SIDEBAR_WIDTH_COOKIE)?.value)}
      sidebar={
        <div className="flex flex-col gap-4">
          <SpaceNav spaces={spaces} canCreate={canCreateSpace(user)} />
          <SharedPagesNav pages={sharedPages} />
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
