// Process tests for sh/renovate.sh in a sandboxed repository. A stub `pnpm` stands in for `pnpm dlx`, so
// these cases need no network. The real validator is in renovate.tools.test.ts, the preview output in
// checks/renovate-preview/.
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";
import { stubDir, withPath } from "../test/stubs.ts";

const project = join(import.meta.dirname, "../..");
const script = join(project, "sh/renovate.sh");

let box: Sandbox;
let repo: string;
let record: string;
beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  record = join(box.root, "record");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  // `preview` hands the log to this entry with node, from the root of the repository.
  for (const file of [
    "checks/renovate-preview/cli.ts",
    "checks/renovate-preview/rules.ts",
    "checks/json.ts",
  ])
    cpSync(join(project, "src", file), join(repo, "tools/scripts/src", file));
});
afterAll(() => {
  box.remove();
});

// Runs the script with a `pnpm` that records its arguments and the variables Renovate reads, prints `output`
// and exits with `code`, and a `gh` that prints a token.
const renovate = (args: string[], code: number, env: Record<string, string> = {}, output = "") => {
  const stubs = stubDir(box.root, `pnpm-${code}`, {
    pnpm: `{ echo "$@"; echo "$LOG_LEVEL $LOG_FORMAT $GITHUB_COM_TOKEN"; } > "${record}"\necho '${output}'\nexit ${code}`,
    gh: "echo token-from-gh",
  });
  return runIn(repo, "sh", [script, ...args], {
    env: { GITHUB_COM_TOKEN: "", PATH: withPath(stubs), ...env },
  });
};

describe("renovate.sh", () => {
  it("ない、または未知のサブコマンドを終了コード 2 で拒否すること", () => {
    for (const args of [[], ["apply"]]) {
      const result = renovate(args, 0);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("usage: tools/scripts/sh/renovate.sh validate|preview");
    }
  });

  it("validate: 固定した renovate-config-validator --strict を実行し、その終了コードを渡すこと", () => {
    expect(renovate(["validate"], 0).status).toBe(0);
    expect(readFileSync(record, "utf8")).toMatch(
      /^dlx --allow-build=re2 --package=renovate@\d+\.\d+\.\d+ renovate-config-validator --strict\n/,
    );
    expect(renovate(["validate"], 1).status).toBe(1);
  });

  it("preview: gh の token で、Renovate を trace レベルの local モードで実行すること", () => {
    renovate(["preview"], 0);
    expect(readFileSync(record, "utf8")).toMatch(
      /renovate --platform=local\ntrace json token-from-gh\n$/,
    );
  });

  it("preview: 設定されている token を残すこと", () => {
    renovate(["preview"], 0, { GITHUB_COM_TOKEN: "mine" });
    expect(readFileSync(record, "utf8")).toMatch(/\ntrace json mine\n$/);
  });

  it("preview: Renovate が失敗したとき、ログの終わりとともにそう述べること", () => {
    const result = renovate(["preview"], 3, {}, "boom");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("boom");
    expect(result.stderr).toContain("renovate: Renovate failed (see above).");
  });

  it("preview: ログを renovate-preview に渡し、ブランチの一覧のないログで失敗すること", () => {
    const result = renovate(["preview"], 0, {}, "not a branch list");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("renovate-preview: no branch list in the log");
  });
});
