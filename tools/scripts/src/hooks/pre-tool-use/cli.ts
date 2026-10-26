// Kiro PreToolUse hook (.kiro/hooks/pre-tool-use.json): every check before a tool call, in one process.
//   node tools/scripts/src/hooks/pre-tool-use/cli.ts < <event JSON>
// The decisions are in rules.ts; this file reads stdin, the environment, git and the session records,
// and prints. Anything it cannot read is allowed (fail-open); an unexpected error exits 1, which Kiro
// treats as a failed hook that does not refuse the call (acp-server.js of Kiro 2.34.0).
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import {
  askedBefore,
  concurrentSessions,
  concurrentSessionsAsk,
  sessionsEnv,
  stateDirectory,
} from "../concurrent-sessions.ts";
import { writeTarget } from "../generated-writes.ts";
import { isLiveKiro } from "../kiro-process.ts";
import { preToolUse } from "./rules.ts";

const env = process.env;

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

try {
  const event = parse(readFileSync(0, "utf8"));
  // Kiro sets the event's cwd to the first workspace root, which the file tools resolve paths against
  // (acp-server.js of Kiro 2.34.0, as in generated-writes.ts).
  const given: unknown =
    typeof event === "object" && event !== null ? Reflect.get(event, "cwd") : undefined;
  const cwd =
    typeof given === "string" && statSync(given, { throwIfNoEntry: false })?.isDirectory() === true
      ? given
      : process.cwd();
  let top: string | undefined | null = null;
  const toplevel = (): string | undefined => {
    if (top === null) {
      try {
        top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      } catch {
        top = undefined;
      }
    }
    return top;
  };
  const decision = preToolUse(event, env, {
    writeTarget(tool, input) {
      const root = toplevel();
      return root === undefined ? undefined : writeTarget(tool, input, cwd, realpathSync(root));
    },
    concurrentSessionsAsk() {
      const here = toplevel() ?? cwd;
      const sessions = sessionsEnv(env, homedir(), here);
      const finding = concurrentSessions(sessions, isLiveKiro);
      return finding && concurrentSessionsAsk(finding, sessions.self, here);
    },
    askedBefore: (key) => askedBefore(stateDirectory(env), key),
  });
  process.stdout.write(decision.stdout);
  process.stderr.write(decision.stderr);
  process.exitCode = decision.status;
} catch (error) {
  process.stderr.write(
    `pre-tool-use hook: unexpected error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
