// Detection-power fixture (#43) for the override of packages/db/src in the root vite.config.ts (docs/adr/0038). db
// imports the modules by `import type` only, may use Node.js modules, and still imports a package by its name only.
// The first import is a value import of a module, which the rule must report. The other two carry no disable comment: if
// the override stops allowing them (a type import, a Node.js module), Oxlint reports them and `vp check` fails.
// oxlint-disable-next-line no-restricted-imports -- fixture: a value import of a module (db knows its types, not its code)
import "@agent-software-factory/claim";
import type { ClaimDatabase } from "@agent-software-factory/claim";
import { execFile } from "node:child_process";

export type Imported = ClaimDatabase;
export const run = execFile;
