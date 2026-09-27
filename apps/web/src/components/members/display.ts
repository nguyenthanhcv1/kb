import type { SpaceMember } from "@/server/members";

/** Name shown for a member: full name, else email, else `null` (profile hidden by RLS). */
export function memberDisplayName(member: Pick<SpaceMember, "fullName" | "email">): string | null {
  return member.fullName?.trim() || member.email || null;
}

/** Up to two initials from the name, else the first letter of the email, else "?". */
export function memberInitials(member: Pick<SpaceMember, "fullName" | "email">): string {
  const words = member.fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length > 0) {
    const letters = words.length === 1 ? [words[0]!] : [words[0]!, words[words.length - 1]!];
    return letters.map((word) => word[0]!.toLocaleUpperCase()).join("");
  }
  return member.email?.[0]?.toLocaleUpperCase() ?? "?";
}

/** Admins first, then by name/email (locale-aware, accent-insensitive). */
export function sortMembers<T extends Pick<SpaceMember, "role" | "fullName" | "email">>(
  members: readonly T[],
  locale: string,
): T[] {
  const rank = { admin: 0, editor: 1, viewer: 2 } as const;
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  return [...members].sort(
    (a, b) =>
      rank[a.role] - rank[b.role] ||
      collator.compare(memberDisplayName(a) ?? "", memberDisplayName(b) ?? ""),
  );
}

/** Loose client-side email check (the server validates with zod). */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
