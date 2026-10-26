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
  it("is origin/main outside a pull request", () => {
    expect(baseRef({})).toBe("origin/main");
    expect(baseRef({ GITHUB_BASE_REF: "" })).toBe("origin/main");
  });

  it("is the base branch of the pull request", () => {
    expect(baseRef({ GITHUB_BASE_REF: "release" })).toBe("origin/release");
  });
});

describe("semgrep", () => {
  it("scans with the Registry rulesets, only for new ERROR findings, and sends no metrics", () => {
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

  it("scans with the rules in SEMGREP_RULES instead, when it is set", () => {
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
