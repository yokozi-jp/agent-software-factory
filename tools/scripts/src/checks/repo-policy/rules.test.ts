// violations runs every rule of repo-policy. The cases of each rule are in the test file of its theme (tooling.test.ts,
// modules.test.ts ...), which calls the rule alone. Reading git and the working tree (and the staged mode) is in
// cli.test.ts.
import { describe, expect, it } from "vite-plus/test";
import { repo } from "./fixtures/repo.ts";
import { readPaths, violations } from "./rules.ts";

describe("violations", () => {
  it("finds nothing in a repository that keeps every rule", () => {
    expect(violations(repo())).toEqual([]);
  });

  it("reports the files that do not parse first, then the failures of the rules", () => {
    expect(violations(repo({ "mise.toml": "[tools\n", ".vite-hooks/pre-commit": "x\n" }))).toEqual([
      expect.stringMatching(/^mise\.toml is not valid TOML/),
      ".vite-hooks exists. Git hooks are managed by lefthook.yml (docs/adr/0001).",
      "mise.toml must pin betterleaks to an exact version (docs/adr/0009).",
    ]);
  });
});

describe("readPaths", () => {
  it("lists the paths the rules read from the repository, sorted", () => {
    const paths = readPaths(repo());
    expect(paths).toContain("compose.local.yaml");
    expect(paths).toContain("package.json");
    expect(paths).toEqual([...paths].sort());
  });
});
