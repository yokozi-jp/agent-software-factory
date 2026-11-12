// When does `nx affected -t test-isolation` select the scripts project? ci.yml and the pre-push hook both run it, so
// the `inputs` of the test-isolation target (tools/scripts/package.json) are the one place that says when the
// isolation test runs (docs/adr/0024, "隔離"). This test runs the real Nx on a sandbox workspace that holds a copy of
// that package.json: a change to the isolation files selects the project, any other change does not (#477).
// The same sandbox shows that `nx affected -t mutation-dry-run`, which ci.yml and the pre-push hook run too, selects
// the project for any change to it and to the hooks that its tests read, and not for another project (#570).
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

// The projects that `nx affected -t <target>` selects when only <file> changed.
function selected(file: string, target = "test-isolation"): string[] {
  const result = runIn(
    repo,
    process.execPath,
    [
      join(repo, "node_modules/nx", relative(nxPackage, nxBin)),
      "show",
      "projects",
      "--affected",
      "-t",
      target,
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

describe("test-isolation の target の inputs", () => {
  it("src/test/ の下のファイルと Vitest の設定で、scripts project を選ぶこと", () => {
    expect(selected("tools/scripts/src/test/sandbox.ts")).toEqual(["scripts"]);
    expect(selected("tools/scripts/src/test/fixtures/focus-and-skip.test.ts")).toEqual(["scripts"]);
    expect(selected("tools/scripts/vite.config.ts")).toEqual(["scripts"]);
  });

  it("project のほかのファイルや別の project のファイルでは選ばないこと", () => {
    expect(selected("tools/scripts/src/checks/ci.ts")).toEqual([]);
    expect(selected("tools/scripts/src/test-helpers/a.ts")).toEqual([]);
    expect(selected("apps/api/src/app.ts")).toEqual([]);
  });
});

describe("mutation-dry-run の target の inputs", () => {
  it("scripts のどのファイルと、そのテストが読む Kiro の hook でも、scripts project を選ぶこと", () => {
    expect(selected("tools/scripts/src/checks/ci.ts", "mutation-dry-run")).toEqual(["scripts"]);
    expect(selected("tools/scripts/stryker.config.mjs", "mutation-dry-run")).toEqual(["scripts"]);
    expect(selected(".kiro/hooks/block-force-push.json", "mutation-dry-run")).toEqual(["scripts"]);
  });

  it("別の project のファイルでは選ばないこと", () => {
    expect(selected("apps/api/src/app.ts", "mutation-dry-run")).toEqual([]);
  });
});
