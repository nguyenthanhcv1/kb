import Link from "next/link";
import { useTranslations } from "next-intl";

import { cn } from "@/components/ui/utils";

/**
 * KA Atlas mark: two blocks on an ink tile. Colours come from the sidebar tokens so the tile
 * reads on the ink sidebar and on the light top bar alike.
 */
function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar ring-1 ring-sidebar-border",
        className,
      )}
    >
      <svg viewBox="0 0 32 32" className="size-[18px]" fill="none">
        <path d="M6 6h8v20H6z" className="fill-sidebar-accent-foreground" />
        <path d="M17 6h9l-6 10 6 10h-9l-5-10z" className="fill-sidebar-primary" />
      </svg>
    </span>
  );
}

/**
 * App name linking home; used in the sidebar (with the tagline) and in the mobile header.
 * `common.app.name` stays the plain page-title name; the lockup uses `common.app.brand`.
 */
export function Brand({
  showTagline = false,
  compact = false,
}: {
  showTagline?: boolean;
  /** Mark only below `sm` (the mobile header is tight); the name still reads to screen readers. */
  compact?: boolean;
}) {
  const t = useTranslations("common.app");
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 rounded-md px-1 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <BrandMark />
      <span className={cn("flex min-w-0 flex-col", compact && "max-sm:sr-only")}>
        <span className="text-[15px] leading-5 font-bold whitespace-nowrap">{t("brand")}</span>
        {showTagline && (
          <span className="truncate text-xs leading-4 text-muted-foreground">{t("tagline")}</span>
        )}
      </span>
    </Link>
  );
}
