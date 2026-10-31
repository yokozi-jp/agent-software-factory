// Detection-power fixture (#43) of `db-imports` in lint-restrictions.json (docs/adr/0038): db imports the modules by
// `import type` only, may use Node.js modules, and still imports a package by its name only. The first import is a
// value import of a module, which the rule must report; the other two are ones that the override must let through. A
// line below a disable comment is one that the rule must report: if the rule is turned off, drops the value, or its
// `files` stop reaching this file, the comment is unused and `vp check` fails (reportUnusedDisableDirectives). A line
// of the table with no comment above is one that the rule must let through: if it stops it, `vp check` fails.
// repo-policy checks that every line here is a row of the table, and every row a line (docs/tooling/ci.md ("禁止の表")).
// Knip and jscpd skip __fixtures__/, and nothing imports this file.
// oxlint-disable-next-line no-restricted-imports -- fixture: a value import of a module (db knows its types, not its code)
import "@agent-software-factory/claim";
import type { ClaimDatabase } from "@agent-software-factory/claim";
import { execFile } from "node:child_process";

export type Imported = ClaimDatabase;
export const run = execFile;
