// git for the checks that read the repository (adr-check, test-weakening, migration-compat): a failed git command is an
// answer ("cannot compare"), and the check says what it could not do. git's stderr is not kept.
import { spawnSync } from "node:child_process";

// git <args> in <cwd> (the current directory when undefined); undefined when git fails or cannot start. Reading
// a large diff needs more than the default buffer; output over it fails the command, as any other failure does.
export function tryGit(cwd: string | undefined, args: readonly string[]): string | undefined {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : undefined;
}
