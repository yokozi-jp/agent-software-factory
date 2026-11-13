// The rules of retry-web-test (#523, docs/adr/0058): when a failed `nx affected` run is run once more, and what the
// notice says. Pure functions; cli.ts runs the command, reads the environment and prints what these return.
import { stripVTControlCharacters } from "node:util";
import { annotationText, type Env } from "../output.ts";

// The only task that is run again. A failure of any other task (check, build, another project's test) is real.
export const retriedTask = "web:test";

// What the Vitest browser mode prints when the page of a test file does not load. Both are about loading the
// file, not about a test: `retry` of Vitest does not cover them, and the tests of the file never ran.
const loadFailures: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  {
    name: "iframe did not become ready",
    pattern: /The iframe ".*" did not become ready within \d+ms/,
  },
  { name: "dynamic import failed", pattern: /Failed to fetch dynamically imported module/ },
];

// The tasks that Nx lists under "Failed tasks:", one per line as "- project:target". Nx colors the output.
export function failedTasks(output: string): string[] {
  const lines = stripVTControlCharacters(output)
    .split("\n")
    .map((line) => line.trim());
  const start = lines.indexOf("Failed tasks:");
  if (start === -1) return [];
  const tasks: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line === "") continue;
    const task = /^- (\S+)$/.exec(line)?.[1];
    if (task === undefined) break;
    tasks.push(task);
  }
  return tasks;
}

// The name of the first load failure in the output, or undefined.
export function loadFailure(output: string): string | undefined {
  const text = stripVTControlCharacters(output);
  return loadFailures.find(({ pattern }) => pattern.test(text))?.name;
}

// Run again only when the one failed task is web:test and it failed to load a file. Returns why, or undefined.
export function retryReason(output: string): string | undefined {
  const tasks = failedTasks(output);
  if (tasks.length !== 1 || tasks[0] !== retriedTask) return undefined;
  return loadFailure(output);
}

// "Failed tasks:" is printed but no task could be read under it: Nx changed its format, and no run is retried
// until this file is fixed. Returns the warning, or undefined.
export function unreadableFailedTasksNotice(output: string, env: Env): string | undefined {
  const printed = stripVTControlCharacters(output)
    .split("\n")
    .some((line) => line.trim() === "Failed tasks:");
  if (!printed || failedTasks(output).length > 0) return undefined;
  const message =
    'retry-web-test could not read the tasks under "Failed tasks:" of Nx, so it does not run again. ' +
    "The format of Nx may have changed; fix failedTasks in tools/scripts/src/checks/retry-web-test/rules.ts.";
  return env.GITHUB_ACTIONS === "true"
    ? `::warning title=web-test-flaky::${annotationText(message)}\n`
    : `warning: ${message}\n`;
}

// The notice that a run is run again. In GitHub Actions it is a ::warning:: annotation, which stays on the run
// and can be counted afterwards (docs/tooling/ci.md ("web:test が不安定に落ちるとき")).
export function retryNotice(reason: string, env: Env): string {
  const message =
    `${retriedTask} failed to load a test file (${reason}). Running the failed tasks once more; ` +
    "the tasks that passed come from the Nx cache. This is the flaky failure of #523.";
  return env.GITHUB_ACTIONS === "true"
    ? `::warning title=web-test-flaky::${annotationText(message)}\n`
    : `warning: ${message}\n`;
}

// What it says when the second run fails as well: the failure is not the flaky one, or it is not gone.
export function secondFailureNotice(status: number): string {
  return `The second run failed too (exit ${status}). It is not run a third time.\n`;
}
