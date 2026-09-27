import { cn } from "@/components/ui/utils";

const SIZES = {
  sm: "size-6 text-sm",
  md: "size-9 text-lg",
  lg: "size-12 text-2xl",
} as const;

/**
 * The Space's emoji icon, or the first letter of its name on a muted tile. Decorative: the name
 * is always rendered next to it, so the tile is hidden from assistive technology.
 */
export function SpaceIcon({
  icon,
  name,
  size = "md",
  className,
}: {
  icon: string | null;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const trimmed = icon?.trim();
  const letter = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground select-none",
        SIZES[size],
        className,
      )}
    >
      {trimmed || letter}
    </span>
  );
}
