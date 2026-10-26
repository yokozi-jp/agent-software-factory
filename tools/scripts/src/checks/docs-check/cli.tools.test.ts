// Process tests for the docs-check entry point with the real iwe (pinned in pnpm-workspace.yaml) and the
// real OKF schemas of this repository (docs/.iwe), on a small docs/ in a sandbox repository. Both are
// inputs of the test-tools target (package.json). Each rule's cases are in rules.test.ts and links.test.ts;
// these check what only iwe and git decide: the schema, broken links, orphans, the staged set, and the
// exit code and output. Checking this repository's own docs/ is the sensor run (CI and pre-commit).
import { appendFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const cli = join(import.meta.dirname, "cli.ts");
const schemas = join(import.meta.dirname, "../../../../../docs/.iwe");
const site = "https://future-architect.github.io/arch-guidelines/documents/forLog/";

let box: Sandbox;
let repo: string;

const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(repo, "docs", path)), { recursive: true });
  writeFileSync(join(repo, "docs", path), text);
};
// Paths are relative to docs/ (also keeps them out of repo-policy's check of cited docs/ files).
const append = (path: string, text: string): void => {
  appendFileSync(join(repo, "docs", path), text);
};
const doc = (path: string, type: string, body: string, extra = ""): void => {
  write(
    path,
    `---\ntype: ${type}\ntitle: ${path}\ndescription: d\ntags: [t]\n${extra}---\n\n# ${path}\n\n${body}\n`,
  );
};
const docsCheck = (...args: string[]) => runIn(repo, process.execPath, [cli, ...args]);
const git = (...args: string[]) => gitIn(repo, args);

// tooling/index.md -> a.md, b.md; guide/index.md -> about.md (cites the imported forLog), page.md.
beforeEach(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  cpSync(schemas, join(repo, "docs/.iwe"), { recursive: true });
  write(
    "index.md",
    '---\nokf_version: "0.2"\n---\n\n# Docs\n\n- [Tooling](tooling/index.md)：t\n- [Guide](guide/index.md)：t\n',
  );
  write("tooling/index.md", "# Tooling\n\n- [A](a.md)：t\n- [B](b.md)：t\n");
  write("guide/index.md", "# Guide\n\n- [About](about.md)：t\n- [Page](page.md)：t\n");
  doc("tooling/a.md", "Reference", "See [b](b.md#見出し).");
  doc("tooling/b.md", "Reference", "## 見出し");
  doc("guide/about.md", "Reference", `[原文](${site})`, `sources:\n  - resource: ${site}\n`);
  doc("guide/page.md", "Convention", "p");
  git("add", "-A");
  git("commit", "-qm", "base");
});
afterEach(() => {
  box.remove();
});

// Each case runs iwe two or more times, which takes seconds on a loaded machine.
describe("docs-check", { timeout: 120_000 }, () => {
  it("passes a valid bundle and says OK", () => {
    const result = docsCheck();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("docs-check: OK\n");
  });

  it("fails when a type is not in the vocabulary of the schema", () => {
    doc("tooling/a.md", "Guide", "a");
    const result = docsCheck();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs-check: OKF schema validation failed (see above).");
    expect(result.stdout).not.toContain("docs-check: OK");
  });

  it("fails on missing frontmatter fields and an orphan", () => {
    write("tooling/stray.md", "---\ntype: Reference\ntitle: x\n---\n\n# x\n");
    const result = docsCheck();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs-check: OKF schema validation failed");
    expect(result.stderr).toContain(
      "docs-check: orphan (link it from an index.md): tooling/stray\n",
    );
  });

  it("names the unquoted value before the schema reports the fields as missing", () => {
    write(
      "tooling/a.md",
      "---\ntype: Reference\ntitle: a\ndescription: javascript: x\ntags: [t]\n---\n\n# a\n",
    );
    const { status, stderr } = docsCheck();
    expect(status).toBe(1);
    const cause = stderr.indexOf("docs-check: tooling/a.md:4: the value of description");
    expect(cause).toBeGreaterThanOrEqual(0);
    expect(cause).toBeLessThan(stderr.indexOf("OKF schema validation failed"));
  });

  it("fails on a broken link inside docs/, not on a link to a repository file", () => {
    append("tooling/a.md", "See [r](../../README.md).\n");
    expect(docsCheck().status).toBe(0);
    append("tooling/a.md", "See [missing](missing.md).\n");
    const result = docsCheck();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs-check: broken link: tooling/a -> tooling/missing\n");
  });

  it("reports the rules of the documents with the docs-check prefix, and warns without failing", () => {
    append("tooling/a.md", "See [b](b.md#none) and [b](b).\n");
    append("tooling/index.md", "- [A](a.md): half\n");
    append("guide/page.md", `[log](${site}x.html)\n`);
    const { status, stderr } = docsCheck();
    expect(status).toBe(1);
    expect(stderr).toContain(
      "docs-check: tooling/a.md:11: tooling/b.md has no heading for #none\n",
    );
    expect(stderr).toContain(
      "docs-check: tooling/a.md:11: link to b needs the file extension (.md)\n",
    );
    expect(stderr).toContain(
      'docs-check: tooling/index.md:5: link line needs a "：when to read" note',
    );
    expect(stderr).toContain("docs-check: guide/page.md:11: links to the arch-guidelines site");

    git("checkout", "-q", "--", ".");
    append("tooling/a.md", "\n".repeat(300));
    const long = docsCheck();
    expect(long.status).toBe(0);
    expect(long.stderr).toContain("docs-check: tooling/a.md is 310 lines (over 250)");
  });

  describe("staged", () => {
    it("needs about.md staged with a change to an imported area; CI does not check it", () => {
      append("guide/page.md", "more\n");
      git("add", "-A");
      const result = docsCheck("staged");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        "docs-check: guide/page.md is in an imported guideline. Record the change under 原文からの変更点 in guide/about.md",
      );
      expect(docsCheck().status).toBe(0);
      append("guide/about.md", "- page.md を変えた。\n");
      git("add", "-A");
      expect(docsCheck("staged").status).toBe(0);
    });

    it("counts only what is staged", () => {
      append("guide/page.md", "more\n");
      expect(docsCheck("staged").status).toBe(0);
      append("tooling/a.md", "more\n");
      git("add", "-A", "docs/tooling");
      expect(docsCheck("staged").status).toBe(0);
    });
  });
});
