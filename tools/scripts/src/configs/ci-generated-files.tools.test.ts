// The "Generated files are committed" step of the nx job in .github/workflows/ci.yml, run as GitHub runs a
// step (`bash -e`) in a sandbox repository: it must stop when the build leaves a change, and pass otherwise.
// Reads .github/workflows/ci.yml of the workspace, an input of the test-tools target (tools/scripts/package.json).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const workspace = join(import.meta.dirname, "../../../..");

// The entries of an object, or none for any other value.
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};

// The `run` of the step named "Generated files are committed" in the nx job.
function stepScript(): string {
  const ci: unknown = parse(readFileSync(join(workspace, ".github/workflows/ci.yml"), "utf8"));
  const steps = record(record(record(ci).jobs).nx).steps;
  const step = (Array.isArray(steps) ? steps : [])
    .map(record)
    .find((candidate) => candidate.name === "Generated files are committed");
  expect(step?.run).toBeTypeOf("string");
  return String(step?.run);
}

let box: Sandbox;
let repo: string;
const git = (...args: string[]): string => gitIn(repo, args).trim();
const put = (path: string, text: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};
let script: string;
const step = () => runIn(repo, "bash", ["-e", "-c", script]);

beforeAll(() => {
  script = stepScript();
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  put(".gitignore", "dist\n");
  put("apps/web/src/routeTree.gen.ts", "export const routes = [];\n");
  git("add", "-A");
  git("commit", "-qm", "base");
});
afterAll(() => {
  box.remove();
});

describe("the step Generated files are committed", () => {
  it("passes when the build changed nothing, and ignores the files that git ignores", () => {
    put("apps/web/dist/index.js", "built\n");
    expect(step()).toMatchObject({ status: 0, stdout: "", stderr: "" });
  });

  it("fails, showing the change, when the build changed a tracked file", () => {
    put("apps/web/src/routeTree.gen.ts", "export const routes = [1];\n");
    const result = step();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(" M apps/web/src/routeTree.gen.ts");
    expect(result.stdout).toContain("+export const routes = [1];");
    expect(result.stdout).toContain("::error::The build changed tracked files.");
    git("checkout", "--", "apps/web/src/routeTree.gen.ts");
  });

  it("fails when the build wrote a file that is not committed", () => {
    put("apps/web/src/new.gen.ts", "export {};\n");
    const result = step();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("?? apps/web/src/new.gen.ts");
  });
});
