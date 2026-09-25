import { BookOpenIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

/** App name linking home; used in the sidebar and in the mobile header. */
export function Brand() {
  const t = useTranslations("common.app");
  return (
    <Link
      href="/"
      className="flex items-center gap-2 rounded-md px-1 font-semibold focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <BookOpenIcon className="size-5" aria-hidden />
      <span>{t("name")}</span>
    </Link>
  );
}
