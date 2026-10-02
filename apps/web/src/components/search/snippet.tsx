/**
 * Renders the sanitized snippet of a search result (`SearchResult.snippetHtml`, T5.2): text is
 * HTML-escaped and only `<mark>…</mark>` is allowed. Parsed into React nodes, so no
 * `dangerouslySetInnerHTML`.
 */
export type SnippetPart = { text: string; mark: boolean };

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function decode(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

export function parseSnippet(html: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  const pattern = /<mark>([\s\S]*?)<\/mark>/g;
  let last = 0;
  for (const match of html.matchAll(pattern)) {
    if (match.index > last)
      parts.push({ text: decode(html.slice(last, match.index)), mark: false });
    parts.push({ text: decode(match[1] ?? ""), mark: true });
    last = match.index + match[0].length;
  }
  if (last < html.length) parts.push({ text: decode(html.slice(last)), mark: false });
  return parts;
}

export function Snippet({ html, className }: { html: string; className?: string }) {
  return (
    <span className={className}>
      {parseSnippet(html).map((part, index) =>
        part.mark ? (
          <mark key={index} className="rounded-sm bg-primary/20 px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </span>
  );
}
