// The real markdownlint-cli2 (`pnpm lint:md`) with the .markdownlint-cli2.yaml of this repository, on
// Markdown written here in a sandbox. Each case turns on one of the choices of the config.
// Reads .markdownlint-cli2.yaml of the workspace, an input of the test-tools target
// (tools/scripts/package.json). The markdownlint-cli2 version is pinned in pnpm-workspace.yaml.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const workspace = join(import.meta.dirname, "../../../..");
const markdownlint = join(workspace, "node_modules/.bin/markdownlint-cli2");

let box: Sandbox;
let docs: string;
const put = (path: string, text: string): void => {
  mkdirSync(dirname(join(docs, path)), { recursive: true });
  writeFileSync(join(docs, path), text);
};
// `pnpm lint:md`: every Markdown file, with the config found in the working directory.
const lint = () => runIn(docs, markdownlint, ["**/*.md"]);

beforeAll(() => {
  box = sandbox();
  docs = join(box.root, "docs");
  mkdirSync(docs);
  cpSync(join(workspace, ".markdownlint-cli2.yaml"), join(docs, ".markdownlint-cli2.yaml"));
});
afterAll(() => {
  box.remove();
});
beforeEach(() => {
  for (const name of [".agents", ".kiro", "node_modules", "apps"])
    rmSync(join(docs, name), { recursive: true, force: true });
  rmSync(join(docs, "a.md"), { force: true });
  put("ok.md", "# Title\n\nText.\n");
});

describe("markdownlint-cli2 with .markdownlint-cli2.yaml", () => {
  it("passes a clean document", () => {
    expect(lint()).toMatchObject({ status: 0 });
  });

  it("fails on a heading level that jumps (MD001), so the rules are on", () => {
    put("a.md", "# Title\n\n### Jump\n");
    const result = lint();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MD001");
  });

  it("passes a line of any length (MD013 off)", () => {
    put("a.md", `# Title\n\n${Array(100).fill("長い行").join(" ")}\n`);
    expect(lint().status).toBe(0);
  });

  it("passes the same heading under different parents, and fails under the same parent (MD024)", () => {
    put("a.md", "# Title\n\n## One\n\n### Consequences\n\n## Two\n\n### Consequences\n");
    expect(lint().status).toBe(0);
    put("a.md", "# Title\n\n## One\n\n### Same\n\n### Same\n");
    const result = lint();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MD024");
  });

  it("does not count the title of the front matter as an H1 (MD025), and counts a second H1", () => {
    put("a.md", "---\ntitle: Front matter\n---\n\n# Title\n");
    expect(lint().status).toBe(0);
    put("a.md", "# Title\n\n# Second\n");
    const result = lint();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MD025");
  });

  it("leaves the layout of a table to the formatter (MD060 off)", () => {
    put("a.md", "# Title\n\n| a | b |\n|---|---|\n| longer cell | c |\n");
    expect(lint().status).toBe(0);
  });

  it.each([
    ".agents/skills/s/SKILL.md",
    ".kiro/skills/s/SKILL.md",
    "node_modules/pkg/README.md",
    "apps/api/CHANGELOG.md",
  ])("does not lint %s", (path) => {
    put(path, "# Title\n\n### Jump\n");
    expect(lint().status).toBe(0);
  });
});
