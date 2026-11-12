// The role of each package under packages/ (./roles.ts, docs/adr/0026), each check called alone on a small repository held
// in memory: a case breaks the tags of one package of a repository that passes, and expects the message that names it.
import { describe, expect, it } from "vite-plus/test";
import { packageFiles } from "./fixtures/passing-repo.ts";
import { failuresOf, repo } from "./fixtures/repo.ts";
import { namesWithRole, packagesHaveOneRole, roleOf, roles, tagOf, typeTagsOf } from "./roles.ts";
import { Tree } from "./tree.ts";

const withTags = (name: string, tags: unknown) =>
  packageFiles(name, { nx: { name, ...(tags === undefined ? {} : { tags }) } });
const treeOf = (files: Record<string, string>) => new Tree(repo(files));
const allowed = roles.map(tagOf).join(", ");
const guide = "docs/adr/0026, docs/domain-model/add-package.md";

describe("ADR 0026: packages/ の下のすべての package が、役割をちょうど 1 つ持つこと", () => {
  const violations = failuresOf(packagesHaveOneRole);

  it("通る repository の package を、それぞれの役割の tag で通すこと", () => {
    expect(violations(repo())).toEqual([]);
  });

  it.each(roles.map(tagOf))("tag %s を持つ package を通すこと", (tag) => {
    expect(violations(repo(withTags("any", [tag])))).toEqual([]);
  });

  it.each([
    ["nx がない", packageFiles("any", { nx: undefined })],
    ["tags がない", withTags("any", undefined)],
    ["type: の次元の tag がない", withTags("any", ["scope:x"])],
    ["配列でない tags", withTags("any", "type:module")],
    ["文字列でない tags", withTags("any", [1, null, { tag: "type:module" }])],
    ["空の tags", withTags("any", [])],
  ])("%s の package を拒否すること", (_, files) => {
    expect(violations(repo(files))).toEqual([
      `packages/any/package.json has no tag of the dimension type: in nx.tags. A package names its role with exactly one of ${allowed} (${guide}).`,
    ]);
  });

  it("type: の次元の tag が 2 つあれば、どちらも役割の値でなくても拒否すること", () => {
    expect(violations(repo(withTags("any", ["type:module", "type:ui"])))).toEqual([
      `packages/any/package.json has the tags type:module, type:ui of the dimension type: in nx.tags. A package has exactly one role, one of ${allowed} (${guide}).`,
    ]);
    expect(violations(repo(withTags("any", ["type:ui", "type:ui"])))).toEqual([
      `packages/any/package.json has the tags type:ui, type:ui of the dimension type: in nx.tags. A package has exactly one role, one of ${allowed} (${guide}).`,
    ]);
  });

  it.each(["type:modul", "type:util", "type:db", "type:"])(
    "役割の値でない tag %s を拒否すること",
    (tag) => {
      expect(violations(repo(withTags("any", [tag])))).toEqual([
        `packages/any/package.json has the tag ${tag}, which names no role. A package names its role with exactly one of ${allowed} (${guide}).`,
      ]);
    },
  );

  it("別の次元の tag を数えないこと", () => {
    expect(violations(repo(withTags("any", ["scope:x", "type:ui", "scope:y"])))).toEqual([]);
  });

  it("役割のない package を、path の順にすべて挙げること", () => {
    expect(
      violations(repo({ ...withTags("b", ["scope:x"]), ...withTags("a", undefined) })),
    ).toEqual([
      `packages/a/package.json has no tag of the dimension type: in nx.tags. A package names its role with exactly one of ${allowed} (${guide}).`,
      `packages/b/package.json has no tag of the dimension type: in nx.tags. A package names its role with exactly one of ${allowed} (${guide}).`,
    ]);
  });

  it("packages/<name>/package.json の下にない events package には問わないこと", () => {
    expect(violations(repo({ "packages/other/events/package.json": "{}" }))).toEqual([]);
  });
});

describe("ADR 0026: package の役割", () => {
  it("別の次元の tag があっても、type: の tag 1 つであること", () => {
    const tree = treeOf({
      ...withTags("a", ["scope:x", "type:driver"]),
      ...withTags("b", ["type:shared-kernel"]),
    });
    expect(roleOf(tree, "a")).toBe("driver");
    expect(roleOf(tree, "b")).toBe("shared-kernel");
  });

  it("tag がない、2 つある、役割の値でない、のどれでも役割なしになること", () => {
    const tree = treeOf({
      ...withTags("none", undefined),
      ...withTags("two", ["type:module", "type:module"]),
      ...withTags("unknown", ["type:util"]),
      "packages/missing/package.json": "{}",
    });
    expect(
      ["none", "two", "unknown", "missing", "absent"].map((name) => roleOf(tree, name)),
    ).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("いずれかの役割を持つ package の名前を、path の順に返すこと", () => {
    const tree = treeOf({
      ...withTags("z", ["type:ui"]),
      ...withTags("y", ["type:driver"]),
      ...withTags("x", ["type:module"]),
      ...withTags("w", ["type:fixtures"]),
      ...withTags("v", undefined),
    });
    // The passing repository has the modules approval, claim and closing.
    expect(namesWithRole(tree, "ui", "module")).toEqual(["approval", "claim", "closing", "x", "z"]);
    expect(namesWithRole(tree, "driver")).toEqual(["y"]);
    expect(namesWithRole(tree)).toEqual([]);
  });

  it("type: の次元の文字列の tag だけを読むこと", () => {
    const tree = treeOf(withTags("a", ["type:ui", "scope:x", 3, "typo:ui"]));
    expect(typeTagsOf(tree, "packages/a/package.json")).toEqual(["type:ui"]);
    expect(typeTagsOf(tree, "packages/none/package.json")).toEqual([]);
  });
});
