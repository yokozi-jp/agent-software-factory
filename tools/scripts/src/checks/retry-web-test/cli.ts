// Runs a command, and runs it once more if it failed only because web:test could not load a test file (#523,
// docs/adr/0058). CI runs `nx affected -t check test build` through it:
//   node tools/scripts/src/checks/retry-web-test/cli.ts pnpm exec nx affected -t check test build
// The output of the command is passed through as it comes. The second run is the same command, so Nx reads the
// tasks that passed from its cache and runs the failed one again. The exit code is the one of the last run:
// 0 if the first run passed or the second did; the code of the first run if it is not the flaky failure;
// 2 if there is no command. The rules are in rules.ts; this file runs the command and prints.
import { spawn } from "node:child_process";
import { retryNotice, retryReason, secondFailureNotice } from "./rules.ts";

interface Run {
  readonly status: number;
  readonly output: string;
}

// The command with its output passed through to ours, and kept to be read. stdin is passed through as well.
function run(command: string, args: readonly string[]): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"] });
    const chunks: string[] = [];
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      process.stdout.write(chunk);
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      process.stderr.write(chunk);
      chunks.push(chunk);
    });
    // A command that cannot start (not found) fails like the shell does.
    child.on("error", (error) => {
      process.stderr.write(`${command}: ${error.message}\n`);
      resolve({ status: 127, output: "" });
    });
    // A command ended by a signal has no exit code.
    child.on("close", (code) => resolve({ status: code ?? 1, output: chunks.join("") }));
  });
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined) {
    process.stderr.write("usage: node cli.ts <command> [args...]\n");
    return 2;
  }
  const first = await run(command, args);
  if (first.status === 0) return 0;
  const reason = retryReason(first.output);
  if (reason === undefined) return first.status;

  process.stdout.write(retryNotice(reason, process.env));
  const second = await run(command, args);
  if (second.status !== 0) process.stdout.write(secondFailureNotice(second.status));
  return second.status;
}

process.exitCode = await main();
