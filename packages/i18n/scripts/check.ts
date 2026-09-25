/**
 * `pnpm i18n:check` — fails (exit 1) when translation files break the rules in docs/PLAN.md §5.4.
 * Usage: tsx scripts/check.ts [--messages <dir>]
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { messagesDir, readCatalog, repoDir } from "./catalog";
import { checkCatalog, type Issue } from "./rules";

const errorsModule = path.join(repoDir, "packages/shared/src/errors.ts");

/**
 * Reads error codes from `packages/shared/src/errors.ts` once it exists (owned by codex-1).
 * Accepts `export const ERROR_CODES = [...]` or an `ErrorCode` enum / const object.
 */
async function loadErrorCodes(): Promise<string[]> {
  if (!existsSync(errorsModule)) return [];
  const mod = (await import(pathToFileURL(errorsModule).href)) as Record<string, unknown>;
  const source = mod.ERROR_CODES ?? mod.ErrorCode;
  const values = Array.isArray(source)
    ? source
    : source && typeof source === "object"
      ? Object.values(source)
      : [];
  return values.filter((value): value is string => typeof value === "string");
}

function format(issue: Issue): string {
  return `  ${issue.file}${issue.key ? ` › ${issue.key}` : ""}: ${issue.message}`;
}

async function main(): Promise<void> {
  const flag = process.argv.indexOf("--messages");
  const dir = flag > -1 ? path.resolve(process.argv[flag + 1] ?? "") : messagesDir;
  const catalog = await readCatalog(dir);
  const issues = checkCatalog(catalog, { errorCodes: await loadErrorCodes() });
  const fileCount = [...catalog.values()].reduce((sum, files) => sum + files.size, 0);

  if (issues.length > 0) {
    console.error(
      `i18n:check found ${issues.length} problem(s):\n${issues.map(format).join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`i18n:check OK (${fileCount} file(s))`);
}

await main();
