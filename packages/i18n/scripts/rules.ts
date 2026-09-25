import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";

import { defaultLocale, isNamespace, locales, type Locale } from "../src/config";
import { compareKeys, isTree, serialize, sortTree, type Catalog } from "./catalog";

export interface Issue {
  file: string;
  /** Dotted key inside the file, when the issue is about one message. */
  key?: string;
  message: string;
}

export interface CheckOptions {
  /** Codes from `packages/shared/src/errors.ts`; each needs `errors.<CODE>`. */
  errorCodes?: readonly string[];
}

/**
 * Validates the whole catalog (docs/PLAN.md §5.4):
 * same files and keys in every locale, matching ICU arguments/tags, valid ICU syntax,
 * only string leaves, no empty/TODO values, known namespaces, sorted keys, and a key for
 * every error code.
 */
export function checkCatalog(catalog: Catalog, options: CheckOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const reference = catalog.get(defaultLocale) ?? new Map();
  const allNamespaces = new Set<string>();
  for (const files of catalog.values()) for (const ns of files.keys()) allNamespaces.add(ns);

  for (const namespace of [...allNamespaces].sort(compareKeys)) {
    const perLocale = new Map<Locale, Map<string, string>>();

    for (const locale of locales) {
      const file = catalog.get(locale)?.get(namespace);
      if (!file) {
        const other = locales.map((l) => catalog.get(l)?.get(namespace)).find(Boolean);
        issues.push({
          file: other ? other.file.replace(`/${other.locale}/`, `/${locale}/`) : namespace,
          message: `missing file (exists for ${other?.locale ?? "another locale"})`,
        });
        continue;
      }
      if (!isNamespace(namespace)) {
        issues.push({
          file: file.file,
          message: `unknown namespace "${namespace}" (add it to namespaces in packages/i18n/src/config.ts)`,
        });
      }
      if (file.parseError !== undefined) {
        issues.push({ file: file.file, message: `invalid JSON: ${file.parseError}` });
        continue;
      }
      if (!isTree(file.data)) {
        issues.push({ file: file.file, message: "top level must be a JSON object" });
        continue;
      }
      if (file.raw !== serialize(sortTree(file.data))) {
        issues.push({
          file: file.file,
          message: "keys are not sorted / not canonically formatted (run `pnpm i18n:sort`)",
        });
      }
      const flat = new Map<string, string>();
      flatten(file.data, "", flat, (key, message) =>
        issues.push({ file: file.file, key, message }),
      );
      perLocale.set(locale, flat);
    }

    const ref = perLocale.get(defaultLocale);
    for (const [locale, flat] of perLocale) {
      const file = catalog.get(locale)!.get(namespace)!;
      if (ref && locale !== defaultLocale) {
        for (const key of ref.keys()) {
          if (!flat.has(key))
            issues.push({
              file: file.file,
              key,
              message: `missing key (present in ${defaultLocale})`,
            });
        }
        for (const key of flat.keys()) {
          if (!ref.has(key))
            issues.push({
              file: file.file,
              key,
              message: `extra key (absent in ${defaultLocale})`,
            });
        }
      }
      for (const [key, value] of flat) {
        let signature: string[];
        try {
          signature = icuSignature(value);
        } catch (error) {
          issues.push({ file: file.file, key, message: `invalid ICU message: ${describe(error)}` });
          continue;
        }
        if (!ref || locale === defaultLocale || !ref.has(key)) continue;
        let refSignature: string[];
        try {
          refSignature = icuSignature(ref.get(key)!);
        } catch {
          continue; // reported on the reference file
        }
        if (signature.join() !== refSignature.join()) {
          issues.push({
            file: file.file,
            key,
            message: `ICU arguments/tags differ from ${defaultLocale}: [${signature.join(", ")}] vs [${refSignature.join(", ")}]`,
          });
        }
      }
    }
  }

  if (options.errorCodes?.length) {
    const errors = reference.get("errors");
    const tree = errors && isTree(errors.data) ? errors.data : {};
    for (const code of options.errorCodes) {
      if (typeof tree[code] !== "string") {
        issues.push({
          file: errors?.file ?? `packages/i18n/messages/${defaultLocale}/errors.json`,
          key: code,
          message: "error code from packages/shared/src/errors.ts has no translation",
        });
      }
    }
  }

  return issues;
}

function flatten(
  tree: Record<string, unknown>,
  prefix: string,
  out: Map<string, string>,
  report: (key: string, message: string) => void,
): void {
  for (const [name, value] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (name === "" || name.includes("."))
      report(key, "key segments must be non-empty and contain no dots");
    if (isTree(value)) {
      if (Object.keys(value).length === 0) report(key, "empty object");
      flatten(value, key, out, report);
    } else if (typeof value !== "string") {
      report(
        key,
        `value must be a string or object, got ${Array.isArray(value) ? "array" : typeof value}`,
      );
    } else if (value.trim() === "") {
      report(key, "empty value");
    } else if (/\bTODO\b/i.test(value)) {
      report(key, "value still contains TODO");
    } else {
      out.set(key, value);
    }
  }
}

/** Sorted list of `arg:<name>:<kind>` and `tag:<name>` used by an ICU message. */
export function icuSignature(message: string): string[] {
  const found = new Set<string>();
  walk(parse(message), found);
  return [...found].sort(compareKeys);
}

function walk(elements: MessageFormatElement[], found: Set<string>): void {
  for (const el of elements) {
    switch (el.type) {
      case TYPE.argument:
        found.add(`arg:${el.value}:string`);
        break;
      case TYPE.number:
      case TYPE.date:
      case TYPE.time:
        found.add(`arg:${el.value}:${TYPE[el.type]}`);
        break;
      case TYPE.plural:
      case TYPE.select:
        found.add(`arg:${el.value}:${el.type === TYPE.plural ? "plural" : "select"}`);
        for (const option of Object.values(el.options)) walk(option.value, found);
        break;
      case TYPE.tag:
        found.add(`tag:${el.value}`);
        walk(el.children, found);
        break;
      default:
        break;
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
