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
// `affected` (one project per line), which can include tools/scripts; `nx show project <name> --json` prints the root
// (the names do not follow the directories); it exits 1 when `nxFails`.
const roots: Record<string, string> = {
  api: "apps/api",
  web: "apps/web",
  claim: "packages/claim",
  "shared-kernel": "packages/shared-kernel",
  "claim-events": "packages/claim/events",
  scripts: "tools/scripts",
};
const filters = "--projects apps/* --projects packages/* --projects packages/*/events";
const check = (nx: { affected?: readonly string[]; nxFails?: boolean; github?: boolean } = {}) => {
  const names = (nx.affected ?? []).map((name) => `"${name}"`).join(" ");
  const rootCases = Object.entries(roots)
    .map(([name, root]) => `*"show project ${name} --json"*) printf '{"root":"${root}"}';;`)
    .join(" ");
  const stubs = stubDir(box.root, "stubs", {
    pnpm:
      nx.nxFails === true
        ? "exit 1"
        : `case "$*" in *"${filters}"*) printf '%s\\n' api web claim shared-kernel claim-events;; ${rootCases} *--affected*) printf '%s\\n' ${names};; esac`,
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
  it("passes when the records of the projects add up to the minimum, and says how many files it read", () => {
    // Neither project reaches 90% alone: the API ran lines 1-6 and the kernel lines 5-10 of the same file.
    record("apps/api", { [kernelFile]: 6, [apiFile]: 10 });
    record("packages/shared-kernel", { [kernelFile]: { from: 5 } });

    const result = check({ affected: ["api", "shared-kernel"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("merged-coverage: 2 files from the records of 2 projects.\n");
  });

  it("exits 1 and names the file that is under the minimum", () => {
    record("apps/api", { [apiFile]: 5 });
    record("packages/shared-kernel", { [kernelFile]: 10 });

    const result = check({ affected: ["api", "shared-kernel"] });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "apps/api/src/app.ts: lines 50% (minimum 90%), branches 100% (minimum 90%).",
    );
    expect(result.stderr).not.toContain("shared-kernel");
  });

  it("exits 1 for a file of a project with a record that no record has", () => {
    record("apps/api", { [apiFile]: 10 });
    write("apps/api/src/new-file.ts", "export const added = 1;\n");

    const result = check({ affected: ["api"] });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("apps/api/src/new-file.ts: no test of any project ran it");
  });

  it("leaves out the projects that have no record, as the projects that are not affected have none", () => {
    record("apps/api", { [apiFile]: 10 });

    expect(check({ affected: ["api", "shared-kernel"] }).status).toBe(0);
  });

  it("marks the failure as an error annotation in GitHub Actions", () => {
    record("apps/api", { [apiFile]: 1 });

    const result = check({ affected: ["api"], github: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^::error::apps\/api\/src\/app\.ts: lines 10%/u);
  });

  it("exits 2 when tests were affected but no project wrote a record", () => {
    const result = check({ affected: ["api"] });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no coverage-final.json");
  });

  it("exits 2 when nx cannot say which projects are affected, though a record is there", () => {
    record("apps/api", { [apiFile]: 10 });

    const result = check({ nxFails: true });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("nx could not say which projects are affected");
  });

  it("ignores the record of a project that is not affected, and names it", () => {
    // The web record is left by an earlier run: it would fail the minimum if it were read.
    record("apps/api", { [apiFile]: 10 });
    record("apps/web", { "apps/web/src/main.tsx": 1 });
    write("apps/web/src/main.tsx", "export const main = 1;\n");

    const result = check({ affected: ["api"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      "merged-coverage: ignored the records of 1 projects that are not affected (left by an earlier run): apps/web.\n" +
        "merged-coverage: 1 files from the records of 1 projects.\n",
    );
  });

  it("passes without reading the records left in coverage/ when no project that writes a record is affected", () => {
    record("apps/api", { [apiFile]: 1 });

    const result = check({ affected: ["scripts"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ignored the records of 1 projects that are not affected");
    expect(result.stdout).toContain("nothing to check");
  });

  it("exits 2 when the only record is of a project that is not affected, though another one is", () => {
    record("apps/web", { "apps/web/src/main.tsx": 10 });

    const result = check({ affected: ["api"] });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no coverage-final.json");
    expect(result.stderr).toContain("affected projects (apps/api)");
  });

  it("finds the record of an events package by its directory, not by its name", () => {
    record("packages/claim/events", { "packages/claim/events/src/event.ts": 10 });
    write("packages/claim/events/src/event.ts", "export const event = 1;\n");

    const result = check({ affected: ["claim-events"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("merged-coverage: 1 files from the records of 1 projects.\n");
  });

  it("passes without a record when only tools/scripts is affected, though nx lists every project with --projects", () => {
    const result = check({ affected: ["scripts"] });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nothing to check");
  });

  it("passes without a record when no affected project has a test target (a docs-only change)", () => {
    const result = check();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nothing to check");
  });

  it("exits 2 when the policy is not valid", () => {
    record("apps/api", { [apiFile]: 10 });
    write("coverage-policy.json", JSON.stringify({ minimum: {}, exceptions: {} }));

    const result = check();

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("coverage-policy.json: minimum");
  });

  it("exits 2 when a record is not in Istanbul's format", () => {
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
