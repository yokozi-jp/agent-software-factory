// When does `nx affected -t test-isolation` select the scripts project? ci.yml and the pre-push hook both run it, so
// the `inputs` of the test-isolation target (tools/scripts/package.json) are the one place that says when the
// isolation test runs (docs/adr/0024, "隔離"). This test runs the real Nx on a sandbox workspace that holds a copy of
// that package.json: a change to the isolation files selects the project, any other change does not (#477).
// Reads tools/scripts/package.json of the workspace, which is part of the project and so an input of test-tools.
import { copyFileSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const workspace = join(import.meta.dirname, "../../../..");
// <nx package>/dist/bin/nx.js, and the package it belongs to.
const nxBin = createRequire(import.meta.url).resolve("nx/bin/nx.js");
const nxPackage = dirname(dirname(dirname(nxBin)));

let box: Sandbox;
let repo: string;

// The projects that `nx affected -t test-isolation` selects when only <file> changed.
function selected(file: string): string[] {
  const result = runIn(
    repo,
    process.execPath,
    [
      join(repo, "node_modules/nx", relative(nxPackage, nxBin)),
      "show",
      "projects",
      "--affected",
      "-t",
      "test-isolation",
      `--files=${file}`,
    ],
    { env: { NX_DAEMON: "false", NX_NO_CLOUD: "true" } },
  );
  expect({ status: result.status, stderr: result.stderr }).toMatchObject({ status: 0 });
  return result.stdout.split("\n").filter((line) => line !== "");
}

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  mkdirSync(join(repo, "tools/scripts"), { recursive: true });
  mkdirSync(join(repo, "apps/api"), { recursive: true });
  copyFileSync(
    join(workspace, "tools/scripts/package.json"),
    join(repo, "tools/scripts/package.json"),
  );
  writeFileSync(join(repo, "apps/api/package.json"), '{"name":"api","nx":{"name":"api"}}\n');
  writeFileSync(
    join(repo, "package.json"),
    '{"name":"root","private":true,"workspaces":["tools/*","apps/*"]}\n',
  );
  writeFileSync(join(repo, "nx.json"), "{}\n");
  mkdirSync(join(repo, "node_modules"));
  symlinkSync(nxPackage, join(repo, "node_modules/nx"));
  // Nx reads the files of the workspace from git.
  writeFileSync(join(repo, ".gitignore"), "node_modules\n");
  gitIn(repo, ["add", "-A"]);
  gitIn(repo, [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=test",
    "commit",
    "-qm",
    "base",
  ]);
}, 60_000);
afterAll(() => {
  box.remove();
});

describe("the inputs of the test-isolation target", () => {
  it("select the scripts project for a file under src/test/ and for the Vitest config", () => {
    expect(selected("tools/scripts/src/test/sandbox.ts")).toEqual(["scripts"]);
    expect(selected("tools/scripts/src/test/fixtures/focus-and-skip.test.ts")).toEqual(["scripts"]);
    expect(selected("tools/scripts/vite.config.ts")).toEqual(["scripts"]);
  });

  it("do not select it for other files of the project or of another project", () => {
    expect(selected("tools/scripts/src/checks/ci.ts")).toEqual([]);
    expect(selected("tools/scripts/src/test-helpers/a.ts")).toEqual([]);
    expect(selected("apps/api/src/app.ts")).toEqual([]);
  });
});
