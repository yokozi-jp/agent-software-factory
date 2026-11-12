// The tree the rules read: a file that does not parse is reported once and reads as empty.
import { describe, expect, it } from "vite-plus/test";
import { repo } from "./fixtures/repo.ts";
import { Tree } from "./tree.ts";

describe("parse できない設定ファイル", () => {
  const errorsOf = (path: string, text: string): string[] => {
    const tree = new Tree(repo({ [path]: text }));
    tree.parsed(path);
    return tree.parseErrors;
  };

  it.each([
    [".github/workflows/ci.yml", "jobs: [\n", "YAML"],
    ["pnpm-workspace.yaml", "catalog: [\n", "YAML"],
    ["mise.toml", "[tools\n", "TOML"],
    [".betterleaks.toml", "betterleaksMinVersion = \n", "TOML"],
  ])("%s と parser のエラーを挙げること", (path, text, format) => {
    const errors = errorsOf(path, text);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      new RegExp(`^${path.replaceAll(".", String.raw`\.`)} is not valid ${format} \\(`),
    );
  });

  it("コメント行は tsconfig.json でだけ読み、ほかの JSON ファイルではエラーとすること", () => {
    expect(errorsOf("apps/api/package.json", '// comment\n{"name": "x"}\n')[0]).toMatch(
      /^apps\/api\/package\.json is not valid JSON \(.+\)$/,
    );
    expect(errorsOf("apps/api/tsconfig.json", '// comment\n{"name": "x"}\n')).toEqual([]);
  });

  it("JSON でない package.json を挙げること", () => {
    expect(errorsOf("apps/api/package.json", "{\n")[0]).toMatch(
      /^apps\/api\/package\.json is not valid JSON \(.+\)$/,
    );
  });
});

describe("parse できない設定ファイル: メッセージ", () => {
  it.each([
    [
      ".github/workflows/ci.yml",
      "jobs: [\n",
      "YAML (YAMLParseError: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 1)",
    ],
    ["mise.toml", "[tools\n", "TOML (Error: Invalid TOML document: illegal character in key)"],
    [
      "apps/api/package.json",
      "{\n",
      "JSON (SyntaxError: Expected property name or '}' in JSON at position 2 (line 2 column 1))",
    ],
  ])("%s と parser のエラーの最初の行を挙げること", (path, text, error) => {
    const tree = new Tree(repo({ [path]: text }));
    tree.parsed(path);
    expect(tree.parseErrors).toEqual([`${path} is not valid ${error}`]);
  });

  it("いくつの検査が読んでも、ファイルを 1 回だけ報告すること", () => {
    const tree = new Tree(repo({ "package.json": "{\n" }));
    tree.parsed("package.json");
    tree.parsed("package.json");
    expect(tree.parseErrors).toEqual([
      "package.json is not valid JSON (SyntaxError: Expected property name or '}' in JSON at position 2 (line 2 column 1))",
    ]);
  });
});

describe("ツリーにないファイル", () => {
  it("ツリーにないファイルを、空または undefined として読むこと", () => {
    const tree = new Tree(repo());
    expect(tree.read("missing.txt")).toBe("");
    expect(tree.maybe("missing.txt")).toBeUndefined();
  });
});
