// Kiro SessionStart hook (.kiro/hooks/session-start.json): the warnings at the start of a session, in
// one process. stdout of a SessionStart hook is added to the agent's context (acp-server.js of Kiro
// 2.34.0). It only informs: an unexpected error exits 1, which Kiro treats as a failed hook.
//   node tools/scripts/src/hooks/session-start/cli.ts
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import {
  concurrentSessions,
  concurrentSessionsWarning,
  sessionsEnv,
} from "../concurrent-sessions.ts";
import { isLiveKiro } from "../kiro-process.ts";
import { staleCheckoutWarning } from "../stale-checkout.ts";

const env = process.env;

// git in this directory; "" when it fails or takes longer than 5 seconds (a fetch with no network).
function git(args: readonly string[]): string {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
  } catch {
    return "";
  }
}

try {
  const here = git(["rev-parse", "--show-toplevel"]).trim() || process.cwd();
  const finding = concurrentSessions(sessionsEnv(env, homedir(), here), isLiveKiro);
  process.stdout.write(
    (finding === undefined ? "" : concurrentSessionsWarning(finding, here)) +
      (staleCheckoutWarning(git, env.KIRO_STALE_CHECKOUT_BASE, here) ?? ""),
  );
} catch (error) {
  process.stderr.write(
    `session-start hook: unexpected error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
