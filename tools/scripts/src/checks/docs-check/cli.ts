// Validate docs/ as an OKF v0.2 bundle (docs/knowledge/documentation-authoring.md):
//   node tools/scripts/src/checks/docs-check/cli.ts          the working tree (CI)
//   node tools/scripts/src/checks/docs-check/cli.ts staged   also: a staged change to an imported area
//                                                            stages its about.md (pre-commit hook)
// In order: unquoted frontmatter values that break YAML, the OKF schemas in docs/.iwe/schemas
// (`iwe schema validate`), broken links and orphans (`iwe stats`), heading anchors and links to the site
// of an imported guideline (links.ts), the "when to read" note of index.md, the .md of links, and a
// warning for documents over 250 lines. docs/ is the one of the repository that holds the working
// directory. Exit 1 when there is any problem; warnings leave the status 0.
// The rules are in rules.ts and links.ts; this file runs iwe, reads the files and git, and prints.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { linkProblems } from "./links.ts";
import {
  extensionProblems,
  frontmatterProblems,
  indexProblems,
  lengthWarnings,
  stagedProblems,
  statsProblems,
} from "./rules.ts";

// The iwe that pnpm-workspace.yaml pins, from the node_modules of this checkout, called directly. `pnpm
// exec` would fall back to a global iwe of another version when node_modules is missing, and runs pnpm's
// dependency check on every call.
const iwe = join(import.meta.dirname, "../../../../../node_modules/.bin/iwe");

const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const docsDir = join(top, "docs");
let status = 0;
const fail = (lines: readonly string[]): void => {
  for (const line of lines) process.stderr.write(`docs-check: ${line}\n`);
  if (lines.length > 0) status = 1;
};

if (!existsSync(iwe)) {
  fail([`${iwe} not found. Run \`pnpm install\` first.`]);
  process.exit(1);
}

const docs = new Map(
  readdirSync(docsDir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".md") && !file.split("/").includes("node_modules"))
    .sort()
    .map((file) => [file, readFileSync(join(docsDir, file), "utf8")]),
);

fail(frontmatterProblems(docs));
if (spawnSync(iwe, ["schema", "validate"], { cwd: docsDir, stdio: "inherit" }).status !== 0) {
  fail(["OKF schema validation failed (see above)."]);
}
fail(statsProblems(execFileSync(iwe, ["stats", "-f", "json"], { cwd: docsDir, encoding: "utf8" })));
fail(linkProblems(docs));
fail(indexProblems(docs));
fail(extensionProblems(docs));
for (const line of lengthWarnings(docs)) process.stderr.write(`docs-check: ${line}\n`);

if (process.argv[2] === "staged") {
  const staged = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--relative", "--diff-filter=ACDMR", "-z", "--", "."],
    { cwd: docsDir, encoding: "utf8" },
  )
    .split("\0")
    .filter((file) => file !== "");
  fail(stagedProblems(docs, staged));
}

if (status === 0) process.stdout.write("docs-check: OK\n");
process.exitCode = status;
