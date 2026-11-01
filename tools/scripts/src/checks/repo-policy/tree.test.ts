// The tree the rules read: a file that does not parse is reported once and reads as empty, and the paths asked for
// are recorded (lefthook-inputs.tools.test.ts compares them with the glob of the pre-commit job).
import { describe, expect, it } from "vite-plus/test";
import { repo } from "./fixtures/repo.ts";
import { Tree } from "./tree.ts";

describe("configuration files that cannot be parsed", () => {
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
  ])("names %s and the parser error", (path, text, format) => {
    const errors = errorsOf(path, text);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      new RegExp(`^${path.replaceAll(".", String.raw`\.`)} is not valid ${format} \\(`),
    );
  });

  it("reads a comment line only in a tsconfig.json: in any other JSON file it is an error", () => {
    expect(errorsOf("apps/api/package.json", '// comment\n{"name": "x"}\n')[0]).toMatch(
      /^apps\/api\/package\.json is not valid JSON \(.+\)$/,
    );
    expect(errorsOf("apps/api/tsconfig.json", '// comment\n{"name": "x"}\n')).toEqual([]);
  });

  it("names a package.json that is not JSON", () => {
    expect(errorsOf("apps/api/package.json", "{\n")[0]).toMatch(
      /^apps\/api\/package\.json is not valid JSON \(.+\)$/,
    );
  });
});

describe("configuration files that cannot be parsed: the messages", () => {
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
  ])("names %s and the first line of the parser error", (path, text, error) => {
    const tree = new Tree(repo({ [path]: text }));
    tree.parsed(path);
    expect(tree.parseErrors).toEqual([`${path} is not valid ${error}`]);
  });

  it("reports a file once, however many checks read it", () => {
    const tree = new Tree(repo({ "package.json": "{\n" }));
    tree.parsed("package.json");
    tree.parsed("package.json");
    expect(tree.parseErrors).toEqual([
      "package.json is not valid JSON (SyntaxError: Expected property name or '}' in JSON at position 2 (line 2 column 1))",
    ]);
  });
});

describe("the paths asked for", () => {
  it("records the path of read, maybe and parsed, and the name of named, whether the tree has the file or not", () => {
    const tree = new Tree(repo());
    tree.named("package.json");
    tree.parsed("c.json");
    tree.maybe("b.txt");
    tree.read("a.txt");
    expect(tree.readPaths).toEqual(["a.txt", "b.txt", "c.json", "package.json"]);
  });

  it("reads a file that the tree lacks as empty, or as undefined", () => {
    const tree = new Tree(repo());
    expect(tree.read("missing.txt")).toBe("");
    expect(tree.maybe("missing.txt")).toBeUndefined();
  });
});
