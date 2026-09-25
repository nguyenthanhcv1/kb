import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { locales, type Locale } from "../src/config";

export const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repoDir = path.resolve(packageDir, "../..");
export const messagesDir = path.join(packageDir, "messages");

export type MessageTree = { [key: string]: unknown };

/** Parsed JSON (or a parse error) of one `messages/<locale>/<namespace>.json` file. */
export interface CatalogFile {
  locale: Locale;
  namespace: string;
  /** Path relative to the repo root, for readable reports. */
  file: string;
  absolute: string;
  raw: string;
  data?: unknown;
  parseError?: string;
}

/** Locale → namespace → file. Locales without a directory get an empty map. */
export type Catalog = Map<Locale, Map<string, CatalogFile>>;

export async function readCatalog(dir = messagesDir): Promise<Catalog> {
  const catalog: Catalog = new Map();
  for (const locale of locales) {
    const files = new Map<string, CatalogFile>();
    catalog.set(locale, files);
    const localeDir = path.join(dir, locale);
    let names: string[];
    try {
      names = (await readdir(localeDir)).filter((name) => name.endsWith(".json")).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const absolute = path.join(localeDir, name);
      const raw = await readFile(absolute, "utf8");
      const entry: CatalogFile = {
        locale,
        namespace: name.slice(0, -".json".length),
        file: path.relative(repoDir, absolute),
        absolute,
        raw,
      };
      try {
        entry.data = JSON.parse(raw);
      } catch (error) {
        entry.parseError = error instanceof Error ? error.message : String(error);
      }
      files.set(entry.namespace, entry);
    }
  }
  return catalog;
}

export function isTree(value: unknown): value is MessageTree {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Deterministic key order: plain UTF-16 code-unit comparison, independent of the machine's ICU. */
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Returns a copy with object keys sorted recursively. */
export function sortTree(value: unknown): unknown {
  if (!isTree(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareKeys)
      .map((key) => [key, sortTree(value[key])]),
  );
}

/** Canonical file content: 2-space JSON + trailing newline (what Prettier produces too). */
export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeCatalogFile(file: CatalogFile, value: unknown): Promise<void> {
  await writeFile(file.absolute, serialize(value), "utf8");
}
