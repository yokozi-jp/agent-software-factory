// violations runs every rule of repo-policy. The cases of each rule are in the test file of its theme (tooling.test.ts,
// modules.test.ts ...), which calls the rule alone. Reading git and the working tree (and the staged mode) is in
// cli.test.ts.
import { describe, expect, it } from "vite-plus/test";
import { repo } from "./fixtures/repo.ts";
import { violations } from "./rules.ts";

describe("violations", () => {
  it("すべての規則を守るリポジトリでは、何も見つけないこと", () => {
    expect(violations(repo())).toEqual([]);
  });

  it("parse できないファイルを先に、次に規則の失敗を報告すること", () => {
    expect(violations(repo({ "mise.toml": "[tools\n", ".vite-hooks/pre-commit": "x\n" }))).toEqual([
      expect.stringMatching(/^mise\.toml is not valid TOML/),
      ".vite-hooks exists. Git hooks are managed by lefthook.yml (docs/adr/0001).",
      "mise.toml must pin betterleaks to an exact version (docs/adr/0009).",
    ]);
  });
});
