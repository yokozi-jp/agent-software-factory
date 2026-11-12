import { describe, expect, it } from "vite-plus/test";
import { baseRef, semgrep } from "./rules.ts";

const fixed = [
  "--baseline-commit",
  "abc",
  "--severity",
  "ERROR",
  "--error",
  "--metrics",
  "off",
  "--disable-version-check",
  "--quiet",
];

describe("baseRef", () => {
  it("pull request の外では origin/main であること", () => {
    expect(baseRef({})).toBe("origin/main");
    expect(baseRef({ GITHUB_BASE_REF: "" })).toBe("origin/main");
  });

  it("pull request の base ブランチであること", () => {
    expect(baseRef({ GITHUB_BASE_REF: "release" })).toBe("origin/release");
  });
});

describe("semgrep", () => {
  it("Registry の規則集合で、新しい ERROR の指摘だけを検査し、metrics を送らないこと", () => {
    expect(semgrep("abc", {})).toEqual([
      "exec",
      "--",
      "semgrep",
      "scan",
      "--config",
      "p/typescript",
      "--config",
      "p/react",
      ...fixed,
    ]);
  });

  it("SEMGREP_RULES が設定されているときは、代わりにその規則で検査すること", () => {
    expect(semgrep("abc", { SEMGREP_RULES: "/tmp/rules.yml" })).toEqual([
      "exec",
      "--",
      "semgrep",
      "scan",
      "--config",
      "/tmp/rules.yml",
      ...fixed,
    ]);
    expect(semgrep("abc", { SEMGREP_RULES: "" }).slice(4, 8)).toEqual([
      "--config",
      "p/typescript",
      "--config",
      "p/react",
    ]);
  });
});
