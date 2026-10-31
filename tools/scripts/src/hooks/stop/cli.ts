// Kiro Stop hook (.kiro/hooks/stop.json): warns when the agent is about to end its turn with unfinished
// work in the working tree (../unfinished-work.ts). In Kiro 2.34.0 (acp-server.js) a Stop hook that exits
// 1 makes the agent continue, with its stderr as the reason; exit 0 lets it stop.
// Each state is reported once per session (a marker file in the git directory). Without that, an agent that
// must not commit (the user said so) would be sent back every time it tries to stop.
//   node tools/scripts/src/hooks/stop/cli.ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { unfinishedWork, unfinishedWorkWarning } from "../unfinished-work.ts";

// git in this directory; "" when it fails or takes longer than 5 seconds.
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

function sessionId(): string {
  try {
    const event: unknown = JSON.parse(readFileSync(0, "utf8"));
    return typeof event === "object" &&
      event !== null &&
      "session_id" in event &&
      typeof event.session_id === "string"
      ? event.session_id
      : "";
  } catch {
    return "";
  }
}

try {
  const work = unfinishedWork(git);
  if (work !== undefined) {
    const here = git(["rev-parse", "--show-toplevel"]).trim() || process.cwd();
    const marker = resolve(
      git(["rev-parse", "--path-format=absolute", "--git-path", "kiro-stop-warned"]).trim(),
    );
    const reported = `${sessionId()}\n${work.key}`;
    if (!(existsSync(marker) && readFileSync(marker, "utf8") === reported)) {
      writeFileSync(marker, reported);
      process.stderr.write(unfinishedWorkWarning(work, here));
      process.exitCode = 1;
    }
  }
} catch (error) {
  // A broken check must not hold the agent: exit 0.
  process.stderr.write(
    `stop hook: unexpected error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}
