import { isLocale, namespaces, type Locale, type Namespace } from "./config";
import type { Messages } from "./messages";

/** Loads one namespace file; must reject (or resolve `undefined`) when the file does not exist. */
export type NamespaceImporter = (locale: Locale, namespace: Namespace) => Promise<unknown>;

/**
 * Builds a loader that merges the requested namespaces into one messages object,
 * shaped `{ [namespace]: {...} }` as next-intl expects. A namespace file that does not
 * exist yet contributes nothing; `pnpm i18n:check` guarantees vi and en have the same files.
 */
export function createMessageLoader(importNamespace: NamespaceImporter) {
  return async function loadMessages(
    locale: Locale,
    only: readonly Namespace[] = namespaces,
  ): Promise<Messages> {
    if (!isLocale(locale)) throw new Error(`Unsupported locale: ${String(locale)}`);
    const entries = await Promise.all(
      only.map(async (namespace) => {
        try {
          const mod = await importNamespace(locale, namespace);
          const value = unwrapDefault(mod);
          return value === undefined ? undefined : ([namespace, value] as const);
        } catch (error) {
          if (isModuleNotFound(error)) return undefined;
          throw error;
        }
      }),
    );
    return Object.fromEntries(entries.filter((entry) => entry !== undefined)) as Messages;
  };
}

/**
 * Loads messages for server components / `i18n/request.ts`. The template-literal import lets
 * the bundler (Next.js) include every JSON file under `messages/`.
 */
export const loadMessages = createMessageLoader(
  (locale, namespace) => import(`../messages/${locale}/${namespace}.json`),
);

function unwrapDefault(mod: unknown): unknown {
  if (mod !== null && typeof mod === "object" && "default" in mod) {
    return (mod as { default: unknown }).default;
  }
  return mod;
}

function isModuleNotFound(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === "MODULE_NOT_FOUND" ||
    code === "ERR_MODULE_NOT_FOUND" ||
    (typeof message === "string" && /cannot find module|failed to (load|resolve)/i.test(message))
  );
}
