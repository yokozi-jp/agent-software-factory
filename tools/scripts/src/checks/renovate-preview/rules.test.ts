import { describe, expect, it } from "vite-plus/test";
import { isBranchListLine, preview } from "./rules.ts";

// One trace-level "branches" entry, in the shape `renovate --platform=local` logs it (LOG_FORMAT=json).
const branches = (value: unknown): string => JSON.stringify({ msg: "branches", branches: value });

describe("preview", () => {
  it("各ブランチを PR の title と upgrade つきで一覧にし、ブランチを数えること", () => {
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
        "  automerge: no",
        "    betterleaks: 1.8.0 -> 1.9.0 (minor)",
        "",
        "1 branch(es)",
        "",
      ].join("\n"),
    );
  });

  it("ログの最後のブランチの一覧を読むこと", () => {
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
    expect(preview(log)).toBe("a\n  A\n  automerge: no\nb\n  B\n  automerge: no\n\n2 branch(es)\n");
  });

  it("current と new の値、次に ? へフォールバックし、依存を 1 回だけ一覧にすること", () => {
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
        "  automerge: no",
        "    node: 24 -> 26 (major)",
        "    x: ? -> ? (pin)",
        "",
        "1 branch(es)",
        "",
      ].join("\n"),
    );
  });

  it("文字列ではない version と、名前のない upgrade を読み飛ばすこと", () => {
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
    expect(preview(log)).toBe("7\n  t\n  automerge: no\n    d: 1 -> 2 (major)\n\n1 branch(es)\n");
  });

  it("リストではないとき、upgrade を一覧にしないこと", () => {
    const log = branches([{ branchName: "b", prTitle: "t", upgrades: { depName: "d" } }]);
    expect(preview(log)).toBe("b\n  t\n  automerge: no\n\n1 branch(es)\n");
  });

  it("value より version を優先すること", () => {
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

  it("Renovate が PR を自分で merge するかと、待つリリースからの経過時間を示すこと", () => {
    const upgrade = (minimumReleaseAge?: string) => ({ depName: "d", minimumReleaseAge });
    const log = branches([
      { branchName: "a", prTitle: "A", automerge: true, upgrades: [upgrade("3 days")] },
      { branchName: "b", prTitle: "B", automerge: true, upgrades: [upgrade()] },
      { branchName: "c", prTitle: "C", automerge: "true", upgrades: [upgrade("3 days")] },
      {
        branchName: "d",
        prTitle: "D",
        automerge: true,
        upgrades: [upgrade("3 days"), upgrade("7 days"), upgrade("3 days")],
      },
    ]);
    const lines = preview(log)
      ?.split("\n")
      .filter((line) => line.includes("automerge"));
    expect(lines).toEqual([
      "  automerge: yes (minimumReleaseAge 3 days)",
      "  automerge: yes",
      "  automerge: no",
      "  automerge: yes (minimumReleaseAge 3 days, 7 days)",
    ]);
  });

  it("ブランチの一覧として記録される行を認識し、ほかの行を認識しないこと", () => {
    expect(isBranchListLine(branches([]))).toBe(true);
    expect(isBranchListLine(JSON.stringify({ msg: "other", branches: [] }))).toBe(false);
    expect(isBranchListLine("not json")).toBe(false);
  });

  it("ログにブランチの一覧がないとき、undefined を返すこと", () => {
    expect(preview('not json\n{"msg":"other"}\n')).toBeUndefined();
    expect(preview(JSON.stringify({ msg: "branches" }))).toBeUndefined();
    expect(preview("")).toBeUndefined();
  });
});
