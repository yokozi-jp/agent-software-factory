import { describe, expect, it } from "vite-plus/test";
import {
  extensionProblems,
  frontmatterProblems,
  indexProblems,
  lengthWarnings,
  stagedProblems,
  statsProblems,
} from "./rules.ts";

const docs = (files: Record<string, string>): Map<string, string> => new Map(Object.entries(files));
const frontmatter = (...lines: string[]): string =>
  ["---", ...lines, "---", "", "# t", ""].join("\n");

describe("frontmatterProblems", () => {
  it("names an unquoted value with a colon and a space, which YAML reads as a new key", () => {
    expect(
      frontmatterProblems(
        docs({ "a/b.md": frontmatter("type: Reference", "description: javascript: x") }),
      ),
    ).toEqual([
      "a/b.md:3: the value of description has a colon followed by a space, or a space and #, and is not quoted; wrap it in double quotes",
    ]);
  });

  it("names an unquoted value with a space and #, which YAML reads as a comment", () => {
    expect(frontmatterProblems(docs({ "b.md": frontmatter("title: C #1") }))).toHaveLength(1);
    expect(frontmatterProblems(docs({ "b.md": frontmatter("title:  a:\tb") }))).toHaveLength(1);
    expect(frontmatterProblems(docs({ "b.md": frontmatter("title: a\t#b") }))).toHaveLength(1);
  });

  it("passes quoted, flow, block and other YAML values", () => {
    const values = [
      'description: "javascript: x"',
      "description: 'javascript: x'",
      "tags: [a: b]",
      "map: {a: b}",
      "text: | a: b",
      "text: > a: b",
      "ref: &a a: b",
      "ref: *a a: b",
      "tag: !t a: b",
      "comment: # a: b",
      "url: https://example.com/a#b",
      "plain: a:b",
      "plain: C#",
      'spaced:  "a: b"',
    ];
    expect(frontmatterProblems(docs({ "a.md": frontmatter(...values) }))).toEqual([]);
  });

  it("reads only top-level keys in the frontmatter", () => {
    const text = [
      "---",
      "sources:",
      "  - resource: https://x: y",
      "-bad: a: b",
      "1key: a: b",
      "key:a: b",
      "---",
      "description: a: b",
      "",
    ].join("\n");
    expect(frontmatterProblems(docs({ "a.md": text }))).toEqual([]);
  });

  it("accepts keys with underscores, digits and hyphens", () => {
    expect(
      frontmatterProblems(docs({ "a.md": frontmatter("_okf-version2: a: b", "Key: a: b") })),
    ).toEqual([
      "a.md:2: the value of _okf-version2 has a colon followed by a space, or a space and #, and is not quoted; wrap it in double quotes",
      "a.md:3: the value of Key has a colon followed by a space, or a space and #, and is not quoted; wrap it in double quotes",
    ]);
  });

  it("reads to the end of a frontmatter that does not close, and nothing after an empty one", () => {
    expect(frontmatterProblems(docs({ "a.md": "---\ndescription: a: b" }))).toEqual([
      "a.md:2: the value of description has a colon followed by a space, or a space and #, and is not quoted; wrap it in double quotes",
    ]);
    expect(frontmatterProblems(docs({ "a.md": "---\n---\ndescription: a: b\n" }))).toEqual([]);
  });

  it("does not read a line that ends in a carriage return, as before", () => {
    expect(frontmatterProblems(docs({ "a.md": "---\ndescription: a: b\r\n---\n" }))).toEqual([]);
  });

  it("skips a file without frontmatter", () => {
    expect(frontmatterProblems(docs({ "a.md": "# a\ndescription: a: b\n" }))).toEqual([]);
  });
});

describe("statsProblems", () => {
  it("reports broken links inside docs/ and orphans from iwe stats", () => {
    const stats = JSON.stringify({
      brokenLinks: [
        { sourceKey: "tooling/a", targetKey: "tooling/missing" },
        { sourceKey: "knowledge/x", targetKey: "../CODING_STANDARDS" },
      ],
      orphans: ["tooling/stray"],
    });
    expect(statsProblems(stats)).toEqual([
      "broken link: tooling/a -> tooling/missing",
      "orphan (link it from an index.md): tooling/stray",
    ]);
  });

  it("passes when iwe reports neither", () => {
    expect(statsProblems("{}")).toEqual([]);
    expect(statsProblems("null")).toEqual([]);
    expect(statsProblems("[]")).toEqual([]);
    expect(statsProblems('{"brokenLinks": [null, "x"], "orphans": "x"}')).toEqual([]);
    expect(statsProblems('{"brokenLinks": [], "orphans": []}')).toEqual([]);
  });
});

describe("indexProblems", () => {
  it("needs a note after a full-width colon on every link line of an index.md", () => {
    const index = [
      "# Tooling",
      "",
      "- [A](a.md)：when to read",
      "- [B](b.md)",
      "- [C](c.md): half-width",
      "- [D](d.md)：  ",
      "  * [E](e.md)",
      "- text without a link",
      "## [Heading](h.md)",
      "",
    ].join("\n");
    expect(
      indexProblems(docs({ "tooling/index.md": index, "tooling/a.md": "- [B](b.md)\n" })),
    ).toEqual([
      'tooling/index.md:4: link line needs a "：when to read" note: - [B](b.md)',
      'tooling/index.md:5: link line needs a "：when to read" note: - [C](c.md): half-width',
      'tooling/index.md:6: link line needs a "：when to read" note: - [D](d.md)：',
    ]);
  });

  it("reads only lines that start with the bullet, and not a line that ends in a carriage return", () => {
    const index = "text - [Title](a.md)\n- [Title](a.md)\r\n- [Long title](b.md)\n";
    expect(indexProblems(docs({ "index.md": index }))).toEqual([
      'index.md:3: link line needs a "：when to read" note: - [Long title](b.md)',
    ]);
  });

  it("checks an indented link line", () => {
    expect(indexProblems(docs({ "index.md": "  -  [A](a.md)\n" }))).toEqual([
      'index.md:1: link line needs a "：when to read" note: -  [A](a.md)',
    ]);
  });

  it("reads only files named index.md", () => {
    expect(indexProblems(docs({ "my-index.md": "- [A](a.md)\n" }))).toEqual([]);
  });
});

describe("extensionProblems", () => {
  it("needs the .md of a link to a document, with or without a heading", () => {
    const text = 'See [b](b) and [c](c#見出し).\nAnd [d](dir/d "title").\n';
    expect(extensionProblems(docs({ "tooling/a.md": text }))).toEqual([
      "tooling/a.md:1: link to b needs the file extension (.md)",
      "tooling/a.md:1: link to c#見出し needs the file extension (.md)",
      "tooling/a.md:2: link to dir/d needs the file extension (.md)",
    ]);
  });

  it("passes links with an extension, URLs, anchors and autolinks", () => {
    const text = [
      "[a](a.md) [b](../b.md#x) [i](img.PNG) [u](https://example.com/x) [m](mailto:a@b)",
      "[h](#heading) [x](<a>) [s](Http://x) [p](a+b.c-d:x)",
      "",
    ].join("\n");
    expect(extensionProblems(docs({ "a.md": text }))).toEqual([]);
  });

  it("reads the target as the pattern did: code joined into a link, a title after spaces, a dot in a folder", () => {
    const text = '[a]`x`(b)\n[d](dir/d  "title")\n[p](dir.v2/page)\n';
    expect(extensionProblems(docs({ "a.md": text }))).toEqual([
      "a.md:1: link to b needs the file extension (.md)",
      "a.md:2: link to dir/d needs the file extension (.md)",
      "a.md:3: link to dir.v2/page needs the file extension (.md)",
    ]);
  });

  it("toggles code only on a line that starts with a fence", () => {
    expect(extensionProblems(docs({ "a.md": "Use ``` here\n[d](d)\n" }))).toEqual([
      "a.md:2: link to d needs the file extension (.md)",
    ]);
  });

  it("skips code: fenced blocks and inline code", () => {
    const text = [
      "Use `[b](b)` like this:",
      "",
      "```md",
      "[b](b)",
      "```",
      "  ~~~",
      "[c](c)",
      "~~~",
      "[d](d)",
      "",
    ].join("\n");
    expect(extensionProblems(docs({ "a.md": text }))).toEqual([
      "a.md:9: link to d needs the file extension (.md)",
    ]);
  });
});

describe("lengthWarnings", () => {
  it("warns about a document over 250 lines, and not at 250", () => {
    const lines = (n: number): string => "x\n".repeat(n);
    expect(lengthWarnings(docs({ "a.md": lines(250), "b.md": lines(251) }))).toEqual([
      "b.md is 251 lines (over 250): check it answers one question (its description); split by responsibility, not to hit a line count",
    ]);
  });

  it("counts newlines, as wc -l does", () => {
    expect(lengthWarnings(docs({ "a.md": `${"x\n".repeat(250)}tail` }))).toEqual([]);
  });
});

describe("stagedProblems", () => {
  const imported = [
    "---",
    "type: Reference",
    "sources:",
    "  - resource: https://future-architect.github.io/arch-guidelines/documents/forLog/",
    "---",
    "",
    "# About",
    "",
  ].join("\n");
  const tree = docs({
    "guide/about.md": imported,
    "guide/page.md": "p",
    "tooling/about.md": frontmatter("type: Reference"),
    "tooling/a.md": "a",
    "plain/about.md":
      "# About\n\nhttps://future-architect.github.io/arch-guidelines/documents/forLog/\n",
    "index.md": "x",
  });

  it("needs the about.md of an imported area staged with a change to that area", () => {
    expect(stagedProblems(tree, ["guide/page.md"])).toEqual([
      "guide/page.md is in an imported guideline. Record the change under 原文からの変更点 in guide/about.md and stage it (AGENTS.md).",
    ]);
    expect(stagedProblems(tree, ["guide/gone.md", "guide/page.md"])).toHaveLength(2);
  });

  it("passes once about.md is staged too", () => {
    expect(stagedProblems(tree, ["guide/page.md", "guide/about.md"])).toEqual([]);
    expect(stagedProblems(tree, ["guide/about.md"])).toEqual([]);
  });

  it("passes changes outside imported areas", () => {
    expect(
      stagedProblems(tree, ["tooling/a.md", "plain/x.md", "index.md", "none/x.md", "other.md"]),
    ).toEqual([]);
  });
});
