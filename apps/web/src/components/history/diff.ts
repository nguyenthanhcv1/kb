/**
 * Block-level comparison of two page documents (task T6.2). Top-level blocks are matched with a
 * longest-common-subsequence over their content; an unmatched removed/added pair that shares a
 * stable block ID (or sits in the same slot of a replaced run) is reported as `changed`.
 */

export type DocLike = { type?: string; content?: unknown[] } | null | undefined;

export type DiffBlock = {
  /** Stable block ID (`attrs.id`) when assigned. */
  id: string | null;
  /** Node type, e.g. `paragraph`, `heading`, `table` (labels: `history.blockTypes.<type>`). */
  type: string;
  /** Plain text; table cells joined by ` | `, rows by newline. */
  text: string;
  /** Full serialisation, to detect formatting-only changes. */
  signature: string;
};

export type DiffRow =
  | { status: "same"; after: DiffBlock; before: DiffBlock }
  | { status: "added"; after: DiffBlock }
  | { status: "removed"; before: DiffBlock }
  | { status: "changed"; before: DiffBlock; after: DiffBlock };

export type DiffSummary = { added: number; removed: number; changed: number };

type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
};

const CELL_TYPES = new Set(["tableCell", "tableHeader"]);

function nodeText(node: Node): string {
  if (typeof node.text === "string") return node.text;
  if (node.type === "hardBreak") return "\n";
  const children = node.content ?? [];
  if (node.type === "table") return children.map(nodeText).join("\n");
  if (node.type === "tableRow") {
    return children
      .filter((c) => CELL_TYPES.has(c.type ?? ""))
      .map(nodeText)
      .join(" | ");
  }
  const separator = children.some((c) => c.content || c.type === "paragraph") ? "\n" : "";
  return children.map(nodeText).join(separator);
}

function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== "id")
        .map(([key, v]) => [key, stripIds(v)]),
    );
  }
  return value;
}

/** Top-level blocks of a document. */
export function toBlocks(doc: DocLike): DiffBlock[] {
  return ((doc?.content ?? []) as Node[]).map((node) => {
    const id = typeof node.attrs?.id === "string" ? node.attrs.id : null;
    return {
      id,
      type: node.type ?? "paragraph",
      text: nodeText(node).normalize("NFC"),
      signature: JSON.stringify(stripIds(node)),
    };
  });
}

/** LCS table lengths for blocks compared by signature (ids ignored). */
function matchPairs(a: DiffBlock[], b: DiffBlock[]): Array<[number, number]> {
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] =
        a[i]!.signature === b[j]!.signature
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i]!.signature === b[j]!.signature) {
      pairs.push([i++, j++]);
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/** Rows describing how to get from `before` to `after`, in `after` order (removals in place). */
export function diffDocuments(before: DocLike, after: DocLike): DiffRow[] {
  const a = toBlocks(before);
  const b = toBlocks(after);
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;

  function flush(removed: DiffBlock[], added: DiffBlock[]) {
    const unusedAdded = new Set(added.keys());
    const pairedWith = new Map<number, number>();
    removed.forEach((old, index) => {
      // Same stable ID wins; otherwise the same slot in the replaced run.
      let target = old.id ? added.findIndex((n, k) => unusedAdded.has(k) && n.id === old.id) : -1;
      if (
        target < 0 &&
        index < added.length &&
        unusedAdded.has(index) &&
        !old.id &&
        !added[index]!.id
      ) {
        target = index;
      }
      if (target >= 0) {
        unusedAdded.delete(target);
        pairedWith.set(target, index);
      }
    });
    const removedPaired = new Set(pairedWith.values());
    let nextRemoved = 0;
    const emitRemovedUpTo = (limit: number) => {
      for (; nextRemoved < limit; nextRemoved++) {
        if (!removedPaired.has(nextRemoved)) {
          rows.push({ status: "removed", before: removed[nextRemoved]! });
        }
      }
    };
    added.forEach((next, k) => {
      const from = pairedWith.get(k);
      if (from === undefined) {
        // Replaced run: removals come before the additions that follow them.
        let limit = removed.length;
        for (let later = k + 1; later < added.length; later++) {
          const laterFrom = pairedWith.get(later);
          if (laterFrom !== undefined) {
            limit = laterFrom;
            break;
          }
        }
        emitRemovedUpTo(limit);
        rows.push({ status: "added", after: next });
        return;
      }
      emitRemovedUpTo(from);
      nextRemoved = Math.max(nextRemoved, from + 1);
      rows.push({ status: "changed", before: removed[from]!, after: next });
    });
    emitRemovedUpTo(removed.length);
  }

  for (const [pi, pj] of [...matchPairs(a, b), [a.length, b.length] as [number, number]]) {
    flush(a.slice(i, pi), b.slice(j, pj));
    if (pi < a.length) rows.push({ status: "same", before: a[pi]!, after: b[pj]! });
    i = pi + 1;
    j = pj + 1;
  }
  return rows;
}

export function summarizeDiff(rows: DiffRow[]): DiffSummary {
  const summary: DiffSummary = { added: 0, removed: 0, changed: 0 };
  for (const row of rows) {
    if (row.status !== "same") summary[row.status] += 1;
  }
  return summary;
}

/** Word-level segments of a changed block, for highlighting inside the row. */
export type TextSegment = { text: string; kind: "same" | "added" | "removed" };

export function diffWords(before: string, after: string): TextSegment[] {
  const split = (s: string) => s.split(/(\s+)/).filter((part) => part !== "");
  const a = split(before);
  const b = split(after);
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] =
        a[i] === b[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const segments: TextSegment[] = [];
  const push = (text: string, kind: TextSegment["kind"]) => {
    const last = segments[segments.length - 1];
    if (last?.kind === kind) last.text += text;
    else segments.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push(a[i]!, "same");
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && lengths[i + 1]![j]! >= lengths[i]![j + 1]!)) {
      push(a[i++]!, "removed");
    } else {
      push(b[j++]!, "added");
    }
  }
  return segments;
}
