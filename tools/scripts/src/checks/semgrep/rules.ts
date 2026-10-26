// The rules of the Semgrep check (docs/adr/0021): what the findings are compared with, and the one
// Semgrep command line. Pure functions; cli.ts runs git and Semgrep.

type Env = Readonly<Record<string, string | undefined>>;

// origin/$GITHUB_BASE_REF in a pull request, and origin/main elsewhere.
export function baseRef(env: Env): string {
  return `origin/${env.GITHUB_BASE_REF || "main"}`;
}

// The arguments of `mise` for the Semgrep run: the version pinned in mise.toml and mise.lock (docs/adr/0009).
// The rules are the Semgrep Registry rulesets, fetched on every run (their license does not allow copying
// them into this repository, docs/adr/0021). SEMGREP_RULES replaces them (the tests use local rules).
// --baseline-commit: only findings that the merge base does not have. --severity ERROR: CodeQL covers the
// rest (docs/adr/0021). --error: exit 1 on a finding. --metrics off: send no usage data.
export function semgrep(mergeBase: string, env: Env): string[] {
  const config = env.SEMGREP_RULES
    ? ["--config", env.SEMGREP_RULES]
    : ["--config", "p/typescript", "--config", "p/react"];
  return [
    "exec",
    "--",
    "semgrep",
    "scan",
    ...config,
    "--baseline-commit",
    mergeBase,
    "--severity",
    "ERROR",
    "--error",
    "--metrics",
    "off",
    "--disable-version-check",
    "--quiet",
  ];
}
