import { describe, expect, it } from "vite-plus/test";
import { linkProblems } from "./links.ts";

const docs = (files: Record<string, string>): Map<string, string> => new Map(Object.entries(files));
const site = "https://future-architect.github.io/arch-guidelines/documents";
const about = (area: string): string =>
  [
    "---",
    "sources:",
    `  - resource: ${site}/${area}/`,
    "---",
    "",
    `[原文](${site}/${area}/)`,
    "",
  ].join("\n");

describe("linkProblems: headings of other documents", () => {
  // GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens, -1, -2 for duplicates.
  const target = [
    "# Title",
    "## 見出し",
    "## Hello, World!",
    "## Use `vp check` *now*",
    "## [Link](x.md) and ![img](i.png)",
    "## <span>Tagged</span> text",
    "## Closed ##",
    "## snake_case-name",
    "## Dup",
    "## Dup",
    "## Dup",
    "```",
    "## In code",
    "~~~",
    "## Still code",
    "```",
    "~~~~",
    "## Tilde code",
    "~~~~",
    "####### Seven",
    "#NoSpace",
    "## Text <br>",
    "  ```",
    "## Indented code",
    "```",
    "Use ``` in a sentence",
    "~/not/a/fence",
    "`` not a fence",
    "````",
    "## Long fence",
    "```",
    "## After code",
    "",
  ].join("\n");
  const check = (link: string) =>
    linkProblems(docs({ "tooling/a.md": `See ${link}.\n`, "tooling/b.md": target }));

  it.each([
    "[b](b.md#title)",
    "[b](b.md#見出し)",
    "[b](b.md#hello-world)",
    "[b](b.md#use-vp-check-now)",
    "[b](b.md#link-and-img)",
    "[b](b.md#tagged-text)",
    "[b](b.md#closed)",
    // `_` is dropped with the emphasis marks, as scripts/docs-links.mjs did (GitHub keeps it).
    "[b](b.md#snakecase-name)",
    "[b](b.md#dup)",
    "[b](b.md#dup-1)",
    "[b](b.md#dup-2)",
    "[b](b.md#Title)",
    "[b](b.md#%E8%A6%8B%E5%87%BA%E3%81%97)",
    '[b](b.md#title "with a title")',
    "[b](./b.md#title)",
    "[b](../tooling/b.md#title)",
    "[b](b.md#text)",
    "[b](b.md#after-code)",
  ])("passes %s", (link) => {
    expect(check(link)).toEqual([]);
  });

  it.each([
    ["[b](b.md#no-such-heading)", "no-such-heading"],
    ["[b](b.md#dup-3)", "dup-3"],
    ["[b](b.md#in-code)", "in-code"],
    ["[b](b.md#still-code)", "still-code"],
    ["[b](b.md#tilde-code)", "tilde-code"],
    ["[b](b.md#seven)", "seven"],
    ["[b](b.md#indented-code)", "indented-code"],
    // A fence closes at the next fence line of the same character, whatever its length.
    ["[b](b.md#long-fence)", "long-fence"],
    ['[b](b.md#none  "two spaces before the title")', "none"],
    ['[b](b.md#none "title")', "none"],
    ["[b](b.md#no:colon)", "no:colon"],
    ["[a]`code`(b.md#joined)", "joined"],
    ["[b](b.md#nospace)", "nospace"],
    ["[b](b.md#hello,-world)", "hello,-world"],
    ["[b](b.md#%E0%A4%A)", "%E0%A4%A"],
  ])("fails %s", (link, fragment) => {
    expect(check(link)).toEqual([`tooling/a.md:1: tooling/b.md has no heading for #${fragment}`]);
  });

  it("reads a target whose path is URL-encoded", () => {
    const files = docs({ "a.md": "[b](my%20b.md#x)\n[c](my%20b.md#y)\n", "my b.md": "# X\n" });
    expect(linkProblems(files)).toEqual(["a.md:2: my b.md has no heading for #y"]);
  });

  it("leaves links that it cannot or need not follow", () => {
    const text = [
      "[same](#nowhere)",
      "[web](https://example.com/b.md#nowhere)",
      "[out](../../README.md#nowhere)",
      "[img](b.png#nowhere)",
      "[missing](missing.md#nowhere)",
      "[plain](b.md)",
      "",
    ].join("\n");
    expect(linkProblems(docs({ "tooling/a.md": text, "tooling/b.md": "# B\n" }))).toEqual([]);
  });

  it("leaves URLs by their scheme and headings of the same file, even where a document matches", () => {
    // A scheme is a letter, then letters, digits, +, - and . (RFC 3986, section 3.1).
    const files = docs({
      "tooling/a.md": "[u](Ab+.-1:b.md#nowhere)\n[l](b.mdd)\n",
      "tooling/Ab+.-1:b.md": "# B\n",
      "tooling/b.md": "# B\n",
      "x.md/a.md": "[s](#nowhere)\n",
      "x.md": "# X\n",
    });
    expect(linkProblems(files)).toEqual([]);
  });

  it("reads a --- line as frontmatter only on the first line", () => {
    const text = "[b](b.md#first)\n---\n[b](b.md#third)\n";
    expect(linkProblems(docs({ "a.md": text, "b.md": "# B\n" }))).toEqual([
      "a.md:1: b.md has no heading for #first",
      "a.md:3: b.md has no heading for #third",
    ]);
  });

  it("skips frontmatter, fenced code (also in a quote) and inline code", () => {
    const text = [
      "---",
      "x: [b](b.md#nowhere)",
      "---",
      "`[b](b.md#nowhere)`",
      "> ```",
      "> [b](b.md#nowhere)",
      "> ```",
      "~~~",
      "[b](b.md#nowhere)",
      "```",
      "[b](b.md#nowhere)",
      "~~~",
      "[b](b.md#last)",
      ">```",
      "[b](b.md#nowhere)",
      "> > ```",
      "  > ```",
      "[b](b.md#after-quotes)",
      "",
    ].join("\n");
    expect(linkProblems(docs({ "a.md": text, "b.md": "# B\n" }))).toEqual([
      "a.md:13: b.md has no heading for #last",
      "a.md:18: b.md has no heading for #after-quotes",
    ]);
  });

  it("checks a file whose frontmatter does not close from the first line", () => {
    const text = "---\n[b](b.md#nowhere)\n";
    expect(linkProblems(docs({ "a.md": text, "b.md": "# B\n" }))).toEqual([
      "a.md:2: b.md has no heading for #nowhere",
    ]);
  });
});

describe("linkProblems: the site of an imported guideline", () => {
  const tree = {
    "guide/about.md": about("forLog"),
    "other/about.md": "# About\n",
  };

  it("refuses a link to the site of a guideline imported into docs/", () => {
    const page = `See [log](${site}/forLog/log_guidelines.html).\n`;
    expect(linkProblems(docs({ ...tree, "guide/page.md": page, "x/y.md": page }))).toEqual([
      "guide/page.md:1: links to the arch-guidelines site for a guideline imported into docs/; link to the docs/ document",
      "x/y.md:1: links to the arch-guidelines site for a guideline imported into docs/; link to the docs/ document",
    ]);
  });

  it("allows the link in an about.md, and to a guideline that was not imported", () => {
    const page = `See [aws](${site}/forAWS/aws.html) and ${site}/forLog/ as text.\n`;
    expect(linkProblems(docs({ ...tree, "guide/page.md": page }))).toEqual([]);
  });

  it("reads the imported guidelines from the frontmatter of every about.md", () => {
    const tree2 = {
      "a/about.md": about("forLog"),
      "b/c/about.md": about("forAWS"),
      "d/about.md": `# About\n\n${site}/forWeb/\n`,
      "e/about.md": `---\nx: y\n---\n\n${site}/forWeb/\n`,
      "f/page.md": about("forWeb"),
    };
    const page = [
      `[1](${site}/forLog/x.html)`,
      `[2](${site}/forAWS/x.html)`,
      `[3](${site}/forWeb/x.html)`,
      `[4](${site}/forLogs/x.html)`,
      `[5](http://future-architect.github.io/arch-guidelines/documents/forLog/)`,
      `[6](https://future-architectXgithubXio/arch-guidelines/documents/forLog/)`,
      `[7](${site}/forLog)`,
      "",
    ].join("\n");
    expect(linkProblems(docs({ ...tree2, "p.md": page })).map((p) => p.split(":")[1])).toEqual([
      "1",
      "2",
    ]);
  });

  it("refuses no site link when no guideline is imported", () => {
    const page = `[x](${site}/forLog/x.html) [y](${site}//x.html)\n`;
    expect(linkProblems(docs({ "p.md": page, "about.md": "---\nx: y\n---\n" }))).toEqual([]);
  });
});
