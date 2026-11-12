// These read the real workspace, so they are tools tests: Stryker runs the unit tests in a copy of this project
// where the paths up to the workspace root lead nowhere, and a unit test that reads them fails its first run
// (#570). Each file read here is an input of `test-tools` in package.json.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { harnessEntry, harnessMarker, migrationsDirectory, seedEntry } from "./rules.ts";

describe("規則が探す base のファイル", () => {
  // Without this, renaming the variable or moving the harness would make every pull request pass with a notice.
  const root = join(import.meta.dirname, "../../../../..");

  it("このリポジトリにあり、harness が cli.ts の渡す変数を読むこと", () => {
    expect(readFileSync(join(root, seedEntry), "utf8")).not.toBe("");
    expect(readFileSync(join(root, harnessEntry), "utf8")).toContain(harnessMarker);
  });

  it("migration のある migrations ディレクトリを含むこと", () => {
    expect(readdirSync(join(root, migrationsDirectory)).length).toBeGreaterThan(0);
  });
});
