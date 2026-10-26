// Mechanical checks for decisions recorded in docs/adr/. Run by the pre-commit hook and CI.
//   node tools/scripts/src/checks/repo-policy/cli.ts          check the working tree (CI, and by hand)
//   node tools/scripts/src/checks/repo-policy/cli.ts staged   check what is staged (pre-commit). Unstaged edits
//                                                              to other files, such as a doc someone is still
//                                                              rewriting, cannot fail a commit.
// The rules are in rules.ts; this file reads git and the files, and prints what the rules return.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { violations } from "./rules.ts";

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const nulSeparated = (output: string): string[] => output.split("\0").filter((path) => path !== "");

// The text of <root>/<path>, or undefined when it is not a readable file.
function readIn(root: string, path: string): string | undefined {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return undefined;
  }
}

function check(top: string, staged: boolean): string[] {
  // `git ls-files -s` prints "<mode> <object> <stage>\t<path>" for each path in the index (git-ls-files(1)).
  const tracked = new Map(
    nulSeparated(git(top, ["ls-files", "-s", "-z"])).map((entry) => {
      const tab = entry.indexOf("\t");
      return [entry.slice(tab + 1), entry.slice(0, entry.indexOf(" "))] as const;
    }),
  );
  // Kiro loads untracked steering files too, so they are checked even when not staged.
  const untrackedSteering = nulSeparated(
    git(top, ["ls-files", "-z", "--others", "--exclude-standard", "--", ".kiro/steering/*.md"]),
  );
  // `vp` creates .vite-hooks without staging it, so look at the real tree in both modes.
  const viteHooks = existsSync(join(top, ".vite-hooks"));
  if (!staged)
    return violations({
      tracked,
      untrackedSteering,
      viteHooks,
      read: (path) => readIn(top, path),
    });
  // Write the index into a temporary tree and read the files there.
  const tree = mkdtempSync(join(tmpdir(), "repo-policy-"));
  try {
    git(top, ["checkout-index", "--all", `--prefix=${tree}/`]);
    for (const path of untrackedSteering) cpSync(join(top, path), join(tree, path));
    return violations({
      tracked,
      untrackedSteering,
      viteHooks,
      read: (path) => readIn(tree, path),
    });
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
}

const [mode, ...rest] = process.argv.slice(2);
if ((mode !== undefined && mode !== "staged") || rest.length > 0) {
  process.stderr.write(
    `repo-policy: unknown argument \`${[mode, ...rest].join(" ")}\`. Usage: cli.ts [staged]\n`,
  );
  process.exit(2);
}
const top = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
const failures = check(top, mode === "staged");
for (const failure of failures) process.stderr.write(`repo-policy: ${failure}\n`);
process.exitCode = failures.length === 0 ? 0 : 1;
