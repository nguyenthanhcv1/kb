"use client";

import { ChevronRightIcon, FileTextIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { cn } from "@/components/ui/utils";
import { pageHref } from "@/lib/page-href";
import type { PageTreeNode } from "@/server/pages";
import { listChildPagesAction } from "@/server/pages/actions";
import type { SharedPage } from "@/server/page-shares";

type Item = Pick<PageTreeNode, "id" | "spaceId" | "shortId" | "slug" | "title" | "icon"> & {
  hasChildren: boolean;
};

/**
 * Sidebar "Shared with me": pages shared directly with the user (`list_shared_with_me`), each
 * with its Space name, expandable to its subpages (loaded on demand through RLS, which shares
 * already cover). Hidden when nothing is shared.
 */
export function SharedPagesNav({ pages }: { pages: readonly SharedPage[] }) {
  const t = useTranslations("nav");
  const headingId = "shared-pages-nav-heading";
  if (pages.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2
        id={headingId}
        className="px-2.5 pb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase"
      >
        {t("shared.heading")}
      </h2>
      <ul className="flex flex-col gap-0.5">
        {pages.map((page) => (
          <SharedPageItem
            key={page.pageId}
            spaceSlug={page.spaceSlug}
            subtitle={page.spaceName}
            item={{
              id: page.pageId,
              spaceId: page.spaceId,
              shortId: page.shortId,
              slug: page.slug,
              title: page.title,
              icon: page.icon,
              hasChildren: page.hasChildren,
            }}
          />
        ))}
      </ul>
    </section>
  );
}

function SharedPageItem({
  item,
  spaceSlug,
  subtitle,
}: {
  item: Item;
  spaceSlug: string;
  subtitle?: string;
}) {
  const t = useTranslations("tree");
  const tNav = useTranslations("nav.shared");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);
  const href = pageHref(spaceSlug, item);
  const active = pathname === href;
  const title = item.title || t("untitled");

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && children === null) {
      const result = await listChildPagesAction({ spaceId: item.spaceId, parentId: item.id });
      if (result.ok) setChildren(result.data);
      else setFailed(true);
    }
  }

  return (
    <li>
      <div className="flex items-center gap-0.5">
        {item.hasChildren ? (
          <button
            type="button"
            onClick={() => void toggle()}
            aria-expanded={open}
            aria-label={open ? tNav("collapse", { title }) : tNav("expand", { title })}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <ChevronRightIcon
              className={cn("size-4 transition-transform", open && "rotate-90")}
              aria-hidden
            />
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden />
        )}
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-sm outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
            active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
          )}
        >
          {item.icon ? (
            <span aria-hidden className="shrink-0">
              {item.icon}
            </span>
          ) : (
            <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{title}</span>
            {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
          </span>
        </Link>
      </div>
      {open && (
        <div className="pl-4">
          {failed ? (
            <p role="alert" className="px-2 py-1 text-xs text-destructive">
              {tNav("loadError")}
            </p>
          ) : children === null ? (
            <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
              {t("loading")}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {children.map((child) => (
                <SharedPageItem key={child.id} item={child} spaceSlug={spaceSlug} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
