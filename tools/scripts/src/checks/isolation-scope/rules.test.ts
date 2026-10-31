// scopeOf decides from the changed files. The second describe keeps the paths in one place: ci.yml and
// lefthook.yml must call cli.ts instead of listing them, and the docs must name every path the rule has.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { isolationPaths, scopeOf } from "./rules.ts";

const root = join(import.meta.dirname, "../../../../..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

describe("scopeOf", () => {
  it("runs for a file under src/test/ and for the Vitest config", () => {
    expect(scopeOf(["tools/scripts/src/test/sandbox.ts"])).toBe("run");
    expect(scopeOf(["tools/scripts/src/test/fixtures/a/b.test.ts"])).toBe("run");
    expect(scopeOf(["tools/scripts/vite.config.ts"])).toBe("run");
  });

  it("runs when only one of several changed files is an isolation file", () => {
    expect(scopeOf(["README.md", "tools/scripts/vite.config.ts"])).toBe("run");
  });

  it("skips when nothing changed or the changed files are elsewhere", () => {
    expect(scopeOf([])).toBe("skip");
    expect(scopeOf(["tools/scripts/src/checks/ci.ts", "apps/api/src/app.ts"])).toBe("skip");
  });

  it("does not match a sibling whose name starts with an isolation path", () => {
    expect(scopeOf(["tools/scripts/src/test-helpers/a.ts"])).toBe("skip");
    expect(scopeOf(["tools/scripts/vite.config.tsx"])).toBe("skip");
  });
});

describe("the places that use the isolation paths", () => {
  it("ci.yml and lefthook.yml ask cli.ts and do not list the paths", () => {
    for (const file of [".github/workflows/ci.yml", "lefthook.yml"]) {
      const text = read(file);
      expect({ file, uses: text.includes("checks/isolation-scope/cli.ts") }).toEqual({
        file,
        uses: true,
      });
      const listed = isolationPaths.filter((path) => text.includes(path));
      expect({ file, listed }).toEqual({ file, listed: [] });
    }
  });

  it("the docs name every path of the rule", () => {
    for (const file of [
      "docs/tooling/ci.md",
      "docs/tooling/git-hooks.md",
      "docs/tooling/assurance-catalog.md",
      "docs/adr/0024-scripts-and-hooks-in-typescript.md",
    ]) {
      const text = read(file);
      const wanted = [
        "isolation-scope",
        ...isolationPaths.map((p) => p.replace("tools/scripts/", "")),
      ];
      const missing = wanted.filter((word) => !text.includes(word));
      expect({ file, missing }).toEqual({ file, missing: [] });
    }
  });
});
