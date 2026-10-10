import { useTranslations } from "next-intl";

import { QuickSwitcher } from "@/components/search/quick-switcher";
import type { RecentPage } from "@/server/pages";
import type { SpaceSummary } from "@/server/space";

import { RecentPages } from "./recent-pages";
import { SpaceList } from "./space-list";

type HomeViewProps = {
  spaces: SpaceSummary[];
  /** Pages the user can read, newest edit first ({@link RecentPage} from `listRecentPages`). */
  recent: RecentPage[];
  /** Internal users only (`canCreateSpace`). */
  canCreate: boolean;
};

/**
 * Home (KA Atlas): a large search box that opens the quick switcher, the Spaces the user can view
 * and the pages edited most recently. Everything shown is already filtered by RLS.
 */
export function HomeView({ spaces, recent, canCreate }: HomeViewProps) {
  const tApp = useTranslations("common.app");
  const t = useTranslations("space.dashboard");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 pt-10 pb-14 sm:px-6">
      <section className="flex flex-col gap-3.5">
        <p className="text-[11px] leading-4 font-semibold tracking-[0.08em] text-highlight uppercase">
          {tApp("tagline")}
        </p>
        <h1 className="text-[32px] leading-10 font-bold tracking-[-0.02em]">{t("heroTitle")}</h1>
        <QuickSwitcher variant="hero" globalShortcut={false} />
      </section>
      <SpaceList spaces={spaces} canCreate={canCreate} />
      {spaces.length > 0 && <RecentPages pages={recent} />}
    </div>
  );
}
