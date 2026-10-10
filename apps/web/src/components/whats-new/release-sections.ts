/** Kind of a release-notes section, from its `###` heading (release-please English or `changelog/vi`). */
export const SECTION_KINDS = ["features", "improvements", "fixes", "other"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export type ReleaseSection = { kind: SectionKind; markdown: string };

const FEATURE = /^(added|features?|thêm|tính năng mới)$/i;
const IMPROVEMENT = /^(changed|improvements?|thay đổi|cải thiện)$/i;
const FIX = /^(fixed|bug fixes|sửa lỗi)$/i;

/** Maps a section heading to its kind; anything else (Removed, Security, …) is `other`. */
export function kindOfHeading(heading: string): SectionKind {
  const text = heading.trim();
  if (FEATURE.test(text)) return "features";
  if (IMPROVEMENT.test(text)) return "improvements";
  if (FIX.test(text)) return "fixes";
  return "other";
}

/**
 * Splits release notes at their `###` headings. Text before the first heading is `other`. Each
 * section keeps its heading line, so joining the sections gives back the original notes.
 *
 * ```ts
 * splitReleaseSections("### Added\n\n- A\n\n### Fixed\n\n- B");
 * // [{ kind: "features", markdown: "### Added\n\n- A\n" }, { kind: "fixes", markdown: "### Fixed\n\n- B" }]
 * ```
 */
export function splitReleaseSections(markdown: string): ReleaseSection[] {
  const sections: ReleaseSection[] = [];
  let current: { kind: SectionKind; lines: string[] } | null = null;
  let inFence = false;
  const flush = () => {
    if (current && current.lines.join("\n").trim()) {
      sections.push({ kind: current.kind, markdown: current.lines.join("\n") });
    }
  };
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = !inFence ? /^###\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (heading) {
      flush();
      current = { kind: kindOfHeading(heading[1]!), lines: [line] };
    } else {
      current ??= { kind: "other", lines: [] };
      current.lines.push(line);
    }
  }
  flush();
  return sections;
}
