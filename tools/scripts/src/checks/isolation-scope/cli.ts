// Does the isolation test of the scripts tests need to run for this change? Prints `run` or `skip`.
//   node tools/scripts/src/checks/isolation-scope/cli.ts <base> <head>
// It compares <head> with the merge base of <base> and <head>, so a branch behind main is not
// blamed for what main changed. The paths are in rules.ts; ci.yml and lefthook.yml call this and do not
// list them (docs/adr/0024, "隔離").
//   exit 0  printed `run` or `skip`
//   exit 2  wrong arguments, or git failed (it says why on stderr). Nothing is printed, so a caller that
//           reads the output does not mistake the failure for `skip`.
import { execFileSync } from "node:child_process";
import { isolationPaths, scopeOf } from "./rules.ts";

const [base, head, ...rest] = process.argv.slice(2);
if (base === undefined || head === undefined || rest.length > 0) {
  process.stderr.write("usage: isolation-scope <base> <head>\n");
  process.exitCode = 2;
} else {
  try {
    const changed = execFileSync(
      "git",
      ["diff", "--name-only", `${base}...${head}`, "--", ...isolationPaths],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    )
      .split("\n")
      .filter((line) => line !== "");
    process.stdout.write(`${scopeOf(changed)}\n`);
  } catch {
    process.exitCode = 2;
  }
}
