// Whether a pid from a Kiro session record is a live Kiro process. A lock of a session that has ended
// keeps its pid, and the pid may since belong to another program, so the command line must name kiro.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// The command line from <proc>/<pid>/cmdline (Linux; the arguments are NUL-separated), or from ps where
// there is no /proc (macOS). ps prints nothing for a pid that is not running. Reading /proc saves
// starting ps: 0.08 ms against 18 ms per pid on the machine #163 was measured on (Linux, loaded).
function commandLine(pid: number, proc: string): string {
  try {
    return String(readFileSync(`${proc}/${pid}/cmdline`));
  } catch {
    return String(spawnSync("ps", ["-p", String(pid), "-o", "command="]).stdout);
  }
}

// <proc> is for tests.
// Stryker disable next-line StringLiteral: without /proc, ps gives the same answer, only slower.
export function isLiveKiro(pid: number, proc = "/proc"): boolean {
  // Signal 0 checks that the process exists and may be signalled, as `kill -0` does. Most locks are
  // stale, so this saves reading the command line for them; it also refuses what is not a pid (NaN).
  // Stryker disable BlockStatement,CallExpression: without it, the command line of a dead pid is empty too.
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // Stryker restore BlockStatement,CallExpression
  return commandLine(pid, proc).includes("kiro");
}
