// The one place that says when the isolation test of the scripts tests runs (docs/adr/0024, "隔離"):
// only when a file that makes the isolation changes. ci.yml and the pre-push hook ask cli.ts instead of
// listing the paths themselves, so they cannot drift apart. Pure; cli.ts runs git.

// Git pathspecs (relative to the repository root): a directory matches everything under it.
export const isolationPaths: readonly string[] = [
  "tools/scripts/src/test",
  "tools/scripts/vite.config.ts",
];

export type Scope = "run" | "skip";

// `run` when at least one changed file is under an isolation path.
export function scopeOf(changedFiles: readonly string[]): Scope {
  const under = (file: string): boolean =>
    isolationPaths.some((path) => file === path || file.startsWith(`${path}/`));
  return changedFiles.some(under) ? "run" : "skip";
}
