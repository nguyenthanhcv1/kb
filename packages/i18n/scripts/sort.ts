/**
 * `pnpm i18n:sort` — rewrites every messages file with keys sorted recursively.
 * Usage: tsx scripts/sort.ts [--messages <dir>]
 */
import path from "node:path";

import { messagesDir, readCatalog, serialize, sortTree, writeCatalogFile } from "./catalog";

const flag = process.argv.indexOf("--messages");
const catalog = await readCatalog(
  flag > -1 ? path.resolve(process.argv[flag + 1] ?? "") : messagesDir,
);
let changed = 0;
for (const files of catalog.values()) {
  for (const file of files.values()) {
    if (file.parseError !== undefined) {
      console.error(`skip ${file.file}: invalid JSON (${file.parseError})`);
      process.exitCode = 1;
      continue;
    }
    const sorted = sortTree(file.data);
    if (serialize(sorted) === file.raw) continue;
    await writeCatalogFile(file, sorted);
    console.log(`sorted ${file.file}`);
    changed += 1;
  }
}
console.log(`i18n:sort done (${changed} file(s) changed)`);
