// Process tests for sh/openapi-lint.sh in a sandboxed repository. A stub `mise` records how Spectral is called and
// returns the exit code chosen. The real Spectral, with the ruleset of this repository, is in openapi-gate.tools.test.ts.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";
import { onlyCommands, stubDir, withPath } from "../test/stubs.ts";

const script = join(import.meta.dirname, "../../sh/openapi-lint.sh");

let box: Sandbox;
let repo: string;
let record: string;
// The script, with a `mise` that appends its arguments to the record and exits with `code`.
const lint = (args: string[], code = 0) => {
  writeFileSync(record, "");
  const mise = `echo "$@" >> "${record}"\nexit ${code}`;
  return runIn(repo, "sh", [script, ...args], {
    env: { PATH: withPath(stubDir(box.root, `mise-${code}`, { mise })) },
  });
};
const calls = (): string => readFileSync(record, "utf8").trimEnd();

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  record = join(box.root, "record");
  gitIn(repo, ["init", "-q", "-b", "main"]);
});
afterAll(() => {
  box.remove();
});

describe("openapi-lint.sh", () => {
  it("lints apps/api/openapi.json with .spectral.yaml, failing on warnings too", () => {
    expect(lint([]).status).toBe(0);
    expect(calls()).toBe(
      "exec -- spectral lint apps/api/openapi.json --ruleset .spectral.yaml --fail-severity=warn",
    );
  });

  it("takes the spec and the ruleset as arguments", () => {
    expect(lint(["other.json", "other.yaml"]).status).toBe(0);
    expect(calls()).toBe(
      "exec -- spectral lint other.json --ruleset other.yaml --fail-severity=warn",
    );
  });

  it("fails when Spectral reports a finding", () => {
    expect(lint([], 1).status).toBe(1);
  });

  it("fails, instead of skipping the check, without mise", () => {
    const path = onlyCommands(box.root, "no-mise", ["git", "sh"]);
    const result = runIn(repo, "sh", [script], { env: { PATH: path } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("openapi-lint: mise is not installed");
  });
});
