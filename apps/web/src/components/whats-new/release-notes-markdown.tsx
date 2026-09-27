import type { ComponentProps } from "react";
import Markdown, { type Components } from "react-markdown";

/**
 * Renders release notes (CHANGELOG.md / changelog/vi) — markdown written by release-please or by
 * the release manager. Raw HTML is not rendered (react-markdown default), so notes cannot inject
 * markup. Headings are shifted under the page's `h2` per version.
 */
const components: Components = {
  h1: (props) => <h3 className="mt-4 text-base font-semibold first:mt-0" {...strip(props)} />,
  h2: (props) => <h3 className="mt-4 text-base font-semibold first:mt-0" {...strip(props)} />,
  h3: (props) => <h3 className="mt-4 text-base font-semibold first:mt-0" {...strip(props)} />,
  h4: (props) => <h4 className="mt-3 text-sm font-semibold first:mt-0" {...strip(props)} />,
  p: (props) => <p className="mt-2 leading-relaxed first:mt-0" {...strip(props)} />,
  ul: (props) => <ul className="mt-2 list-disc space-y-1 pl-6" {...strip(props)} />,
  ol: (props) => <ol className="mt-2 list-decimal space-y-1 pl-6" {...strip(props)} />,
  li: (props) => <li className="leading-relaxed" {...strip(props)} />,
  a: (props) => (
    <a
      className="font-medium text-primary underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      rel="noreferrer"
      {...strip(props)}
    />
  ),
  code: (props) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]" {...strip(props)} />
  ),
};

/** Drops react-markdown's `node` prop so it does not reach the DOM. */
function strip<T extends { node?: unknown }>({ node: _node, ...rest }: T): Omit<T, "node"> {
  return rest;
}

export function ReleaseNotesMarkdown({
  children,
  ...props
}: { children: string } & Omit<ComponentProps<"div">, "children">) {
  return (
    <div {...props}>
      <Markdown components={components}>{children}</Markdown>
    </div>
  );
}
