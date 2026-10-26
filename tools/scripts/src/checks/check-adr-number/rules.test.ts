import { describe, expect, it } from "vite-plus/test";
import { checkNumbers, ghFailed, parsePrs, type OpenPr } from "./rules.ts";

// Built from parts, so that the repo-policy check of docs/ references does not read these made-up ADRs.
const adr = (name: string): string => `docs/adr/${name}.md`;
const pr = (number: number, headRefName: string, ...paths: string[]): OpenPr => ({
  number,
  headRefName,
  files: paths.map((path) => ({ path })),
});
const main = [adr("0001-a"), "docs/adr/index.md", "docs/adr/README.txt"];
const base = { branch: "docs/mine", main, prs: [] as OpenPr[], branchFiles: main };

describe("checkNumbers", () => {
  it("passes and prints the next number when the branch adds no ADR", () => {
    expect(checkNumbers(base)).toEqual({
      status: 0,
      stdout: "next free ADR number: 0002\n",
      stderr: "",
    });
  });

  it("passes an added ADR with a free number and counts it for the next number", () => {
    expect(checkNumbers({ ...base, branchFiles: [...main, adr("0002-mine")] })).toEqual({
      status: 0,
      stdout: "next free ADR number: 0003\n",
      stderr: "",
    });
  });

  it("fails when another open PR adds the same number, and names the PR", () => {
    const result = checkNumbers({
      ...base,
      prs: [pr(7, "docs/other", adr("0002-other"))],
      branchFiles: [...main, adr("0002-mine")],
    });
    expect(result).toEqual({
      status: 1,
      stdout: "next free ADR number: 0003\n",
      stderr:
        "check-adr-number: ADR 0002 is also used by PR #7. Renumber this branch's ADR and the places that cite it.\n",
    });
  });

  it("ignores the files of this branch's own PR", () => {
    const result = checkNumbers({
      ...base,
      prs: [pr(8, "docs/mine", adr("0002-mine"))],
      branchFiles: [...main, adr("0002-mine")],
    });
    expect(result.status).toBe(0);
  });

  it("fails when origin/main has the number under another name", () => {
    const result = checkNumbers({ ...base, branchFiles: [...main, adr("0001-again")] });
    expect(result).toEqual({
      status: 1,
      stdout: "next free ADR number: 0002\n",
      stderr:
        "check-adr-number: ADR 0001 is also used by origin/main. Renumber this branch's ADR and the places that cite it.\n",
    });
  });

  it("lists every user of a number once, sorted, and reports each taken number", () => {
    const result = checkNumbers({
      ...base,
      prs: [
        pr(7, "a", adr("0001-x"), adr("0003-x")),
        pr(10, "b", adr("0001-y"), adr("0001-z")),
        pr(12, "c", "src/docs/adr/0009-x.md", "docs/adr/0010-x.txt"),
      ],
      branchFiles: [...main, adr("0001-mine"), adr("0003-mine")],
    });
    expect(result).toEqual({
      status: 1,
      stdout: "next free ADR number: 0004\n",
      stderr: [
        "check-adr-number: ADR 0001 is also used by PR #10, PR #7, origin/main. Renumber this branch's ADR and the places that cite it.",
        "check-adr-number: ADR 0003 is also used by PR #7. Renumber this branch's ADR and the places that cite it.",
        "",
      ].join("\n"),
    });
  });

  it("takes the next number after the highest one anywhere, compared as numbers", () => {
    const result = checkNumbers({
      ...base,
      main: [adr("0009-a"), adr("0010-b")],
      branchFiles: [adr("0009-a"), adr("0010-b")],
      prs: [pr(3, "x", adr("0099-c"))],
    });
    expect(result.stdout).toBe("next free ADR number: 0100\n");
  });

  it("counts only docs/adr/NNNN-*.md files, not files in subdirectories or other names", () => {
    const result = checkNumbers({
      ...base,
      main: [],
      branchFiles: [
        adr("12-short"),
        adr("00012-long"),
        "docs/adr/0005-x.txt",
        adr("0011-x") + ".bak",
        "x/docs/adr/0006-y.md",
        adr("0007"),
        adr("0008-ok"),
      ],
    });
    expect(result.stdout).toBe("next free ADR number: 0009\n");
  });

  it("starts at 0001 when there is no ADR at all", () => {
    expect(checkNumbers({ ...base, main: [], branchFiles: [] }).stdout).toBe(
      "next free ADR number: 0001\n",
    );
  });
});

describe("parsePrs", () => {
  it("reads the JSON that `gh pr list --json number,headRefName,files` prints", () => {
    const json = JSON.stringify([
      { number: 7, headRefName: "docs/other", files: [{ path: "a.md", additions: 1 }] },
    ]);
    expect(parsePrs(json)).toEqual([pr(7, "docs/other", "a.md")]);
  });

  it("reads a PR without files", () => {
    expect(parsePrs('[{"number":1,"headRefName":"x","files":[]}]')).toEqual([pr(1, "x")]);
  });

  it.each([
    ["empty output", ""],
    ["not JSON", "Post: EOF"],
  ])("throws on %s, which gh does not print on success", (_name, json) => {
    expect(() => parsePrs(json)).toThrow(SyntaxError);
  });

  it.each([
    ["not a list", "{}"],
    ["a list of non-objects", "[1]"],
    ["a list with null", "[null]"],
    ["a number that is a string", '[{"number":"1","headRefName":"x","files":[]}]'],
    ["no head ref", '[{"number":1,"files":[]}]'],
    ["files that is not a list", '[{"number":1,"headRefName":"x","files":{}}]'],
    ["a file without a path", '[{"number":1,"headRefName":"x","files":[{}]}]'],
    ["a file that is null", '[{"number":1,"headRefName":"x","files":[null]}]'],
  ])("rejects %s, which gh does not print on success", (_name, json) => {
    expect(parsePrs(json)).toBeUndefined();
  });
});

describe("ghFailed", () => {
  it("says what to check, on stderr", () => {
    expect(ghFailed).toEqual({
      status: 2,
      stdout: "",
      stderr:
        "check-adr-number: could not list the open PRs with gh. Check `gh auth status` and try again.\n",
    });
  });
});
