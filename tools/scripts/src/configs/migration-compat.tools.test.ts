// The files of the base that migration-compat looks for (src/checks/migration-compat/rules.ts) exist in this
// repository. Without this, renaming the variable or moving the harness would make every pull request pass with a
// notice. It reads the real workspace, so it is a tools test: Stryker runs the unit tests in a copy of this project
// where the workspace root is out of reach (#570). Each file it reads is an input of test-tools in package.json.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  harnessEntry,
  harnessMarker,
  migrationsDirectory,
  seedEntry,
} from "../checks/migration-compat/rules.ts";

const root = join(import.meta.dirname, "../../../..");

describe("the files of the base that the migration-compat rules look for", () => {
  it("exist in this repository, and the harness reads the variable that cli.ts passes", () => {
    expect(readFileSync(join(root, seedEntry), "utf8")).not.toBe("");
    expect(readFileSync(join(root, harnessEntry), "utf8")).toContain(harnessMarker);
  });

  it("include a migrations directory that has migrations", () => {
    expect(readdirSync(join(root, migrationsDirectory)).length).toBeGreaterThan(0);
  });
});
