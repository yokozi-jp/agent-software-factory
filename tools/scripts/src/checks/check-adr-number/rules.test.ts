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
  it("ブランチが ADR を足していないとき、通して次の番号を出力すること", () => {
    expect(checkNumbers(base)).toEqual({
      status: 0,
      stdout: "next free ADR number: 0002\n",
      stderr: "",
    });
  });

  it("空いている番号で足した ADR を通し、次の番号に数えること", () => {
    expect(checkNumbers({ ...base, branchFiles: [...main, adr("0002-mine")] })).toEqual({
      status: 0,
      stdout: "next free ADR number: 0003\n",
      stderr: "",
    });
  });

  it("ほかの open な PR が同じ番号を足すとき、その PR を挙げて失敗すること", () => {
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

  it("このブランチ自身の PR のファイルを無視すること", () => {
    const result = checkNumbers({
      ...base,
      prs: [pr(8, "docs/mine", adr("0002-mine"))],
      branchFiles: [...main, adr("0002-mine")],
    });
    expect(result.status).toBe(0);
  });

  it("origin/main が別の名前で同じ番号を持つとき失敗すること", () => {
    const result = checkNumbers({ ...base, branchFiles: [...main, adr("0001-again")] });
    expect(result).toEqual({
      status: 1,
      stdout: "next free ADR number: 0002\n",
      stderr:
        "check-adr-number: ADR 0001 is also used by origin/main. Renumber this branch's ADR and the places that cite it.\n",
    });
  });

  it("番号の使い手を 1 回ずつ並べ替えて一覧にし、使われた番号を報告すること", () => {
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

  it("どこかにある最大の番号の次を、数値として比べて採ること", () => {
    const result = checkNumbers({
      ...base,
      main: [adr("0009-a"), adr("0010-b")],
      branchFiles: [adr("0009-a"), adr("0010-b")],
      prs: [pr(3, "x", adr("0099-c"))],
    });
    expect(result.stdout).toBe("next free ADR number: 0100\n");
  });

  it("docs/adr/NNNN-*.md のファイルだけを数え、サブディレクトリや別の名前を数えないこと", () => {
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

  it("ADR が 1 つもないとき 0001 から始めること", () => {
    expect(checkNumbers({ ...base, main: [], branchFiles: [] }).stdout).toBe(
      "next free ADR number: 0001\n",
    );
  });
});

describe("parsePrs", () => {
  it("`gh pr list --json number,headRefName,files` が出力する JSON を読むこと", () => {
    const json = JSON.stringify([
      { number: 7, headRefName: "docs/other", files: [{ path: "a.md", additions: 1 }] },
    ]);
    expect(parsePrs(json)).toEqual([pr(7, "docs/other", "a.md")]);
  });

  it("ファイルのない PR を読むこと", () => {
    expect(parsePrs('[{"number":1,"headRefName":"x","files":[]}]')).toEqual([pr(1, "x")]);
  });

  it.each([
    ["empty output", ""],
    ["not JSON", "Post: EOF"],
  ])("gh が成功時に出力しない %s で throw すること", (_name, json) => {
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
  ])("gh が成功時に出力しない %s を拒否すること", (_name, json) => {
    expect(parsePrs(json)).toBeUndefined();
  });
});

describe("ghFailed", () => {
  it("確かめることを stderr に述べること", () => {
    expect(ghFailed).toEqual({
      status: 2,
      stdout: "",
      stderr:
        "check-adr-number: could not list the open PRs with gh. Check `gh auth status` and try again.\n",
    });
  });
});
