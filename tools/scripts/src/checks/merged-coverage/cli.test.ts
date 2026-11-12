// Process tests for the merged coverage entry point: a real git repository in the sandbox with coverage records on
// disk, to exit code and output. What the minimum counts is in rules.test.ts.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";
import { stubDir, withPath } from "../../test/stubs.ts";

const cli = join(import.meta.dirname, "cli.ts");
const kernelFile = "packages/shared-kernel/src/tenant-db/db-call.ts";
const apiFile = "apps/api/src/app.ts";
const policy = {
  minimum: { lines: 90, branches: 90 },
  exceptions: { "apps/api/src/server.ts": "entry" },
};

let box: Sandbox;
let repo: string;

const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};
// A record of coverage-final.json: per file, ten lines. A number is how many of the first lines ran; `{ from }` is the
// lines from that one on.
const record = (project: string, files: Record<string, number | { from: number }>): void => {
  const at = (line: number) => ({ start: { line, column: 0 }, end: { line, column: 5 } });
  const lines = Array.from({ length: 10 }, (_, index) => index + 1);
  const ran = (line: number, how: number | { from: number }) =>
    typeof how === "number" ? line <= how : line >= how.from;
  write(
    `${project}/coverage/coverage-final.json`,
    JSON.stringify(
      Object.fromEntries(
        // Istanbul keys a file by its absolute path.
        Object.entries(files).map(([file, how]) => [
          join(repo, file),
          {
            statementMap: Object.fromEntries(lines.map((line) => [String(line), at(line)])),
            s: Object.fromEntries(lines.map((line) => [String(line), ran(line, how) ? 1 : 0])),
            branchMap: {},
            b: {},
          },
        ]),
      ),
    ),
  );
};
// The stand-in for `pnpm exec nx ...`, as nx 24 answers it: `nx show projects` with `--projects` prints the projects that
// write a record whether or not they are affected (it ignores `--affected`); with `--affected` alone it prints
// `affected` (one project per line), which can include tools/scripts; `nx graph --print` prints the project graph, whose
// nodes have the root (the names do not follow the directories); it exits 1 when `nxFails`, and `graph` can be made
// to fail or to print what is not a graph.
const roots: Record<string, string> = {
  api: "apps/api",
  web: "apps/web",
  claim: "packages/claim",
  "shared-kernel": "packages/shared-kernel",
  "claim-events": "packages/claim/events",
  scripts: "tools/scripts",
};
const graphJson = (without?: string): string =>
  JSON.stringify({
    graph: {
      nodes: Object.fromEntries(
        Object.entries(roots)
          .filter(([name]) => name !== without)
          .map(([name, root]) => [name, { name, data: { root } }]),
      ),
    },
  });
const filters = "--projects apps/* --projects packages/* --projects packages/*/events";
const check = (
  nx: {
    affected?: readonly string[];
    nxFails?: boolean;
    graph?: "fails" | "not a graph" | "without api";
    github?: boolean;
  } = {},
) => {
  const names = (nx.affected ?? []).map((name) => `"${name}"`).join(" ");
  const printed = {
    undefined: graphJson(),
    "not a graph": "[]",
    "without api": graphJson("api"),
  };
  const graph = nx.graph === "fails" ? "exit 1" : `printf '%s' '${printed[`${nx.graph}`]}'`;
  const stubs = stubDir(box.root, "stubs", {
    pnpm:
      nx.nxFails === true
        ? "exit 1"
        : `case "$*" in *"${filters}"*) printf '%s\\n' api web claim shared-kernel claim-events;; *"graph --print"*) ${graph};; *--affected*) printf '%s\\n' ${names};; esac`,
  });
  return runIn(repo, process.execPath, [cli], {
    env: { GITHUB_ACTIONS: nx.github === true ? "true" : "", PATH: withPath(stubs) },
  });
};

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
});
afterAll(() => {
  box.remove();
});
beforeEach(() => {
  for (const dir of ["apps", "packages"]) rmSync(join(repo, dir), { recursive: true, force: true });
  write("coverage-policy.json", JSON.stringify(policy));
  write(apiFile, "export const app = 1;\n");
  write("apps/api/src/server.ts", "export const server = 1;\n");
  write(kernelFile, "export const call = 1;\n");
});

describe("merged-coverage", () => {
  it("project の記録の合計が下限に達するとき通し、読んだファイル数を述べること", () => {
    // Neither project reaches 90% alone: the API ran lines 1-6 and the kernel lines 5-10 of the same file.
    record("apps/api", { [kernelFile]: 6, [apiFile]: 10 });
    record("packages/shared-kernel", { [kernelFile]: { from: 5 } });

    const result = check({ affected: ["api", "shared-kernel"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("merged-coverage: 2 files from the records of 2 projects.\n");
  });

  it("下限に達しないファイルを挙げて 1 で終了すること", () => {
    record("apps/api", { [apiFile]: 5 });
    record("packages/shared-kernel", { [kernelFile]: 10 });

    const result = check({ affected: ["api", "shared-kernel"] });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "apps/api/src/app.ts: lines 50% (minimum 90%), branches 100% (minimum 90%).",
    );
    expect(result.stderr).not.toContain("shared-kernel");
  });

  it("どの記録にもない記録を持つ project のファイルで、1 で終了すること", () => {
    record("apps/api", { [apiFile]: 10 });
    write("apps/api/src/new-file.ts", "export const added = 1;\n");

    const result = check({ affected: ["api"] });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("apps/api/src/new-file.ts: no test of any project ran it");
  });

  it("影響を受けない project に記録がないのと同じく、記録のない project を除くこと", () => {
    record("apps/api", { [apiFile]: 10 });

    expect(check({ affected: ["api", "shared-kernel"] }).status).toBe(0);
  });

  it("GitHub Actions では、失敗を error annotation にすること", () => {
    record("apps/api", { [apiFile]: 1 });

    const result = check({ affected: ["api"], github: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^::error::apps\/api\/src\/app\.ts: lines 10%/u);
  });

  it("テストが影響を受けたのにどの project も記録を書かなかったとき、2 で終了すること", () => {
    const result = check({ affected: ["api"] });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no coverage-final.json");
  });

  it("記録があっても nx が影響を受ける project を言えないとき、2 で終了すること", () => {
    record("apps/api", { [apiFile]: 10 });

    const result = check({ nxFails: true });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nx could not say which projects are affected");
  });

  it.each([
    ["fails", "fails" as const],
    ["is not a graph", "not a graph" as const],
  ])("nx の project graph が %s のとき、2 で終了すること", (_, graph) => {
    record("apps/api", { [apiFile]: 10 });

    const result = check({ affected: ["api"], graph });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nx could not say which projects are affected");
  });

  it("影響を受ける project が project graph にないとき、2 で終了すること", () => {
    record("apps/api", { [apiFile]: 10 });

    const result = check({ affected: ["api"], graph: "without api" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nx could not say which projects are affected");
  });

  it("影響を受けない project の記録を無視し、それを挙げること", () => {
    // The web record is left by an earlier run: it would fail the minimum if it were read.
    record("apps/api", { [apiFile]: 10 });
    record("apps/web", { "apps/web/src/main.tsx": 1 });
    write("apps/web/src/main.tsx", "export const main = 1;\n");

    const result = check({ affected: ["api"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      "merged-coverage: ignored the records of 1 project(s) that are not affected (left by an earlier run): apps/web.\n" +
        "merged-coverage: 1 files from the records of 1 projects.\n",
    );
  });

  it("記録を書く project が影響を受けないとき、coverage/ に残った記録を読まずに通すこと", () => {
    record("apps/api", { [apiFile]: 1 });

    const result = check({ affected: ["scripts"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ignored the records of 1 project(s) that are not affected");
    expect(result.stdout).toContain("nothing to check");
  });

  it("唯一の記録が影響を受けない project のもので、別の project が影響を受けるとき、2 で終了すること", () => {
    record("apps/web", { "apps/web/src/main.tsx": 10 });

    const result = check({ affected: ["api"] });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no coverage-final.json");
    expect(result.stderr).toContain("affected projects (apps/api)");
  });

  it("events package の記録を、名前ではなく directory で見つけること", () => {
    record("packages/claim/events", { "packages/claim/events/src/event.ts": 10 });
    write("packages/claim/events/src/event.ts", "export const event = 1;\n");

    const result = check({ affected: ["claim-events"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("merged-coverage: 1 files from the records of 1 projects.\n");
  });

  it("nx が --projects ですべての project を挙げても、tools/scripts だけが影響を受けるときは記録なしで通すこと", () => {
    const result = check({ affected: ["scripts"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nothing to check");
  });

  it("影響を受ける project にテストの target がないとき (docs だけの変更)、記録なしで通すこと", () => {
    const result = check();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nothing to check");
  });

  it("policy が有効でないとき、2 で終了すること", () => {
    record("apps/api", { [apiFile]: 10 });
    write("coverage-policy.json", JSON.stringify({ minimum: {}, exceptions: {} }));

    const result = check();

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("coverage-policy.json: minimum");
  });

  it("記録が JSON でないとき、スタックトレースの代わりに 2 で終了すること", () => {
    write("apps/api/coverage/coverage-final.json", "{ not json");

    const result = check({ affected: ["api"] });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("apps/api/coverage/coverage-final.json: not valid JSON.");
  });

  it("記録が Istanbul の形式でないとき、2 で終了すること", () => {
    write(
      "apps/api/coverage/coverage-final.json",
      JSON.stringify({ [join(repo, apiFile)]: { statementMap: 1 } }),
    );

    const result = check({ affected: ["api"] });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "apps/api: the record of apps/api/src/app.ts is not in Istanbul's format.",
    );
  });
});
