# Paste and import Markdown

Pages understand Markdown: Markdown you paste or import from a `.md` file shows up as headings, lists, tables, quotes, code blocks… instead of `#` and `**` characters or one code block.

## Paste Markdown

Paste (`Ctrl/⌘ + V`) Markdown text, for example copied from VS Code, a terminal, a `README.md` file or an AI assistant's answer. The page recognises Markdown when:

- it was copied from a Markdown file in VS Code, or
- the text has a heading (`#`), a table, a code fence (` ``` `), an alert (`> [!NOTE]`), or at least two other Markdown signs (lists, quotes, **bold**, links…).

Nothing changes when:

- you paste from a web page, Google Docs, Word… (the source's own formatting is kept);
- you paste into a code block (the text is kept as is);
- the text is ordinary prose without Markdown syntax.

To paste Markdown source without formatting it, use `Ctrl/⌘ + Shift + V`, or create a code block first and paste into it.

## Import a `.md` file

- Type `/` and choose **Import Markdown** (type `markdown` or `import` to filter), then pick one or more `.md` files. Their content is inserted at the cursor.
- Or drag and drop a `.md` file onto the page.

Files can be up to 2 MB. Images with relative paths in the file (e.g. `./img/a.png`) cannot be shown; upload the images to the page and insert them again. To attach a `.md` file as a download instead of inserting its content, use `/` › **File attachment**.
