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

describe("ADR 0026: every package under packages/ has exactly one role", () => {
  const violations = failuresOf(packagesHaveOneRole);

  it("passes the packages of the passing repository, each with the tag of its role", () => {
    expect(violations(repo())).toEqual([]);
  });

  it.each(roles.map(tagOf))("passes a package with the tag %s", (tag) => {
    expect(violations(repo(withTags("any", [tag])))).toEqual([]);
  });

  it.each([
    ["no nx", packageFiles("any", { nx: undefined })],
    ["no tags", withTags("any", undefined)],
    ["no tag of the dimension type:", withTags("any", ["scope:x"])],
    ["tags that are not a list", withTags("any", "type:module")],
    ["tags that are not strings", withTags("any", [1, null, { tag: "type:module" }])],
    ["an empty list", withTags("any", [])],
  ])("refuses a package with %s", (_, files) => {
    expect(violations(repo(files))).toEqual([
      `packages/any/package.json has no tag of the dimension type: in nx.tags. A package names its role with exactly one of ${allowed} (${guide}).`,
    ]);
  });

  it("refuses two tags of the dimension type:, whether or not both name a role", () => {
    expect(violations(repo(withTags("any", ["type:module", "type:ui"])))).toEqual([
      `packages/any/package.json has the tags type:module, type:ui of the dimension type: in nx.tags. A package has exactly one role, one of ${allowed} (${guide}).`,
    ]);
    expect(violations(repo(withTags("any", ["type:ui", "type:ui"])))).toEqual([
      `packages/any/package.json has the tags type:ui, type:ui of the dimension type: in nx.tags. A package has exactly one role, one of ${allowed} (${guide}).`,
    ]);
  });

  it.each(["type:modul", "type:util", "type:db", "type:"])(
    "refuses the tag %s, which names no role",
    (tag) => {
      expect(violations(repo(withTags("any", [tag])))).toEqual([
        `packages/any/package.json has the tag ${tag}, which names no role. A package names its role with exactly one of ${allowed} (${guide}).`,
      ]);
    },
  );

  it("does not count the tags of another dimension", () => {
    expect(violations(repo(withTags("any", ["scope:x", "type:ui", "scope:y"])))).toEqual([]);
  });

  it("names every package that has no role, in the order of the paths", () => {
    expect(
      violations(repo({ ...withTags("b", ["scope:x"]), ...withTags("a", undefined) })),
    ).toEqual([
      `packages/a/package.json has no tag of the dimension type: in nx.tags. A package names its role with exactly one of ${allowed} (${guide}).`,
      `packages/b/package.json has no tag of the dimension type: in nx.tags. A package names its role with exactly one of ${allowed} (${guide}).`,
    ]);
  });

  it("does not ask the events packages, which are not under packages/<name>/package.json", () => {
    expect(violations(repo({ "packages/other/events/package.json": "{}" }))).toEqual([]);
  });
});

describe("ADR 0026: the role of a package", () => {
  it("is the one type: tag, whatever the tags of other dimensions are", () => {
    const tree = treeOf({
      ...withTags("a", ["scope:x", "type:driver"]),
      ...withTags("b", ["type:shared-kernel"]),
    });
    expect(roleOf(tree, "a")).toBe("driver");
    expect(roleOf(tree, "b")).toBe("shared-kernel");
  });

  it("is none for no tag, for two tags and for a tag that names no role", () => {
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

  it("gives the names of the packages with one of the roles, in the order of the paths", () => {
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

  it("reads only the tags that are strings of the dimension type:", () => {
    const tree = treeOf(withTags("a", ["type:ui", "scope:x", 3, "typo:ui"]));
    expect(typeTagsOf(tree, "packages/a/package.json")).toEqual(["type:ui"]);
    expect(typeTagsOf(tree, "packages/none/package.json")).toEqual([]);
  });
});
