import { describe, expect, it } from "vite-plus/test";
import { preview } from "./rules.ts";

// One trace-level "branches" entry, in the shape `renovate --platform=local` logs it (LOG_FORMAT=json).
const branches = (value: unknown): string => JSON.stringify({ msg: "branches", branches: value });

describe("preview", () => {
  it("lists each branch with its PR title and upgrades, and counts the branches", () => {
    const log = [
      "not json",
      branches([
        {
          branchName: "renovate/betterleaks",
          prTitle: "chore(deps): update betterleaks to v1.9.0",
          upgrades: [
            {
              depName: "betterleaks",
              currentVersion: "1.8.0",
              newVersion: "1.9.0",
              updateType: "minor",
            },
          ],
        },
      ]),
    ].join("\n");
    expect(preview(log)).toBe(
      [
        "renovate/betterleaks",
        "  chore(deps): update betterleaks to v1.9.0",
        "    betterleaks: 1.8.0 -> 1.9.0 (minor)",
        "",
        "1 branch(es)",
        "",
      ].join("\n"),
    );
  });

  it("reads the last branch list of the log", () => {
    const log = [
      branches([{ branchName: "old", prTitle: "old" }]),
      JSON.stringify({ msg: "other", branches: [] }),
      branches([
        { branchName: "a", prTitle: "A" },
        { branchName: "b", prTitle: "B" },
      ]),
      JSON.stringify({ msg: "other", branches: [{ branchName: "later", prTitle: "later" }] }),
      "5",
      "null",
      "[1]",
    ].join("\n");
    expect(preview(log)).toBe("a\n  A\nb\n  B\n\n2 branch(es)\n");
  });

  it("falls back to the current and new values, then to ?, and lists a dependency once", () => {
    const upgrade = { depName: "node", currentValue: "24", newValue: "26", updateType: "major" };
    const log = branches([
      {
        branchName: "renovate/node",
        prTitle: "Update node",
        upgrades: [upgrade, upgrade, { depName: "x", updateType: "pin" }, { newValue: "1" }],
      },
    ]);
    expect(preview(log)).toBe(
      [
        "renovate/node",
        "  Update node",
        "    node: 24 -> 26 (major)",
        "    x: ? -> ? (pin)",
        "",
        "1 branch(es)",
        "",
      ].join("\n"),
    );
  });

  it("skips a version that is not a string, and an upgrade without a name", () => {
    const log = branches([
      {
        branchName: 7,
        prTitle: "t",
        upgrades: [
          null,
          "x",
          { depName: "", newValue: "1" },
          { depName: 5, newValue: "1" },
          {
            depName: "d",
            currentVersion: 1,
            currentValue: "1",
            newValue: "2",
            updateType: "major",
          },
        ],
      },
    ]);
    expect(preview(log)).toBe("7\n  t\n    d: 1 -> 2 (major)\n\n1 branch(es)\n");
  });

  it("lists no upgrades when they are not a list", () => {
    const log = branches([{ branchName: "b", prTitle: "t", upgrades: { depName: "d" } }]);
    expect(preview(log)).toBe("b\n  t\n\n1 branch(es)\n");
  });

  it("prefers the version to the value", () => {
    const log = branches([
      {
        branchName: "b",
        prTitle: "t",
        upgrades: [
          {
            depName: "d",
            currentVersion: "1.0.0",
            currentValue: "^1",
            newVersion: "2.0.0",
            newValue: "^2",
            updateType: "major",
          },
        ],
      },
    ]);
    expect(preview(log)).toContain("    d: 1.0.0 -> 2.0.0 (major)\n");
  });

  it("returns undefined when the log has no branch list", () => {
    expect(preview('not json\n{"msg":"other"}\n')).toBeUndefined();
    expect(preview(JSON.stringify({ msg: "branches" }))).toBeUndefined();
    expect(preview("")).toBeUndefined();
  });
});
