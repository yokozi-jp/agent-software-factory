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

describe(".markdownlint-cli2.yaml による markdownlint-cli2", () => {
  it("きれいな文書を通すこと", () => {
    expect(lint()).toMatchObject({ status: 0 });
  });

  it("見出しの階層が飛ぶと失敗し (MD001)、規則が有効であること", () => {
    put("a.md", "# Title\n\n### Jump\n");
    const result = lint();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MD001");
  });

  it("どの長さの行も通すこと (MD013 は off)", () => {
    put("a.md", `# Title\n\n${Array(100).fill("長い行").join(" ")}\n`);
    expect(lint().status).toBe(0);
  });

  it("異なる親の下の同じ見出しを通し、同じ親の下では失敗すること (MD024)", () => {
    put("a.md", "# Title\n\n## One\n\n### Consequences\n\n## Two\n\n### Consequences\n");
    expect(lint().status).toBe(0);
    put("a.md", "# Title\n\n## One\n\n### Same\n\n### Same\n");
    const result = lint();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MD024");
  });

  it("front matter の title を H1 に数えず (MD025)、2 つ目の H1 を数えること", () => {
    put("a.md", "---\ntitle: Front matter\n---\n\n# Title\n");
    expect(lint().status).toBe(0);
    put("a.md", "# Title\n\n# Second\n");
    const result = lint();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("MD025");
  });

  it("表の体裁を formatter に任せること (MD060 は off)", () => {
    put("a.md", "# Title\n\n| a | b |\n|---|---|\n| longer cell | c |\n");
    expect(lint().status).toBe(0);
  });

  it.each([
    ".agents/skills/s/SKILL.md",
    ".kiro/skills/s/SKILL.md",
    "node_modules/pkg/README.md",
    "apps/api/CHANGELOG.md",
  ])("%s を lint しないこと", (path) => {
    put(path, "# Title\n\n### Jump\n");
    expect(lint().status).toBe(0);
  });
});
