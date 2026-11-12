import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { sandbox, type Sandbox } from "../test/sandbox.ts";
import { generatedWriteRefusal, writeTarget } from "./generated-writes.ts";

describe("generatedWriteRefusal", () => {
  it.each([
    ["apps/web/src/routeTree.gen.ts", "TanStack Router generates it", "pnpm exec nx build web"],
    ["routeTree.gen.ts", "TanStack Router generates it", "pnpm exec nx build web"],
    ["skills-lock.json", "skills CLI", "pnpm dlx skills update"],
    [".agents/skills", "skills CLI", "pnpm dlx skills update"],
    [
      ".agents/skills/tdd/SKILL.md",
      "skills CLI",
      "node tools/scripts/src/checks/skills-lock/cli.ts",
    ],
    [".kiro/skills", "skills CLI", "pnpm dlx skills update"],
    [".kiro/skills/tdd/SKILL.md", "skills CLI", "pnpm dlx skills update"],
    ["pnpm-lock.yaml", "pnpm writes it.", "pnpm install"],
    ["mise.lock", "mise writes it (docs/adr/0009).", "mise lock --platform linux-x64"],
    [".mise/locks/pypi-semgrep/1.182.1/uv.lock", "mise writes it", "mise lock"],
    [
      "packages/claim/src/infrastructure/db.gen.ts",
      "kysely-codegen generates it from the migrations",
      "pnpm exec nx db-types db",
    ],
    ["packages/closing/src/infrastructure/db.gen.ts", "(docs/adr/0025)", "packages/db/migrations/"],
  ])("%s を拒否し、理由と生成し直す方法を述べること", (path, why, how) => {
    const message = generatedWriteRefusal("fs_write", path);
    expect(message).toContain(`block-generated-writes: refused fs_write on ${path}. `);
    expect(message).toContain(why);
    expect(message).toContain(how);
    expect(message).toContain(
      "If the user really wants a hand edit, they start Kiro with KIRO_ALLOW_GENERATED_WRITE=1.",
    );
  });

  it("1 つのファイルにメッセージ全体を書くこと", () => {
    expect(generatedWriteRefusal("delete_file", "pnpm-lock.yaml")).toBe(
      "block-generated-writes: refused delete_file on pnpm-lock.yaml. pnpm writes it. Do not edit it by hand; change package.json or pnpm-workspace.yaml and run `pnpm install` (or `pnpm add`). If the user really wants a hand edit, they start Kiro with KIRO_ALLOW_GENERATED_WRITE=1.",
    );
  });

  it.each([
    "README.md",
    "pnpm-lock.yaml.bak",
    "apps/web/pnpm-lock.yaml",
    "apps/web/.agents/skills/tdd/SKILL.md",
    "notes/mise.lock.md",
    "mise.lock.bak",
    ".mise/config.toml",
    ".agents/skills-notes.md",
    ".kiro/skills-notes.md",
    "skills-lock.json.bak",
    "apps/web/src/routeTree.gen.tsx",
    "apps/web/src/xrouteTree.gen.ts",
    "packages/claim/src/infrastructure/database.ts",
    "packages/claim/src/db.gen.ts",
    "packages/claim/src/infrastructure/db.gen.ts.bak",
    "apps/api/src/infrastructure/db.gen.ts",
    "vendor/packages/claim/src/infrastructure/db.gen.ts",
  ])("%s を許可すること", (path) => {
    expect(generatedWriteRefusal("fs_write", path)).toBeUndefined();
  });
});

describe("writeTarget", () => {
  let box: Sandbox;
  let root: string;
  beforeAll(() => {
    box = sandbox();
    root = join(box.root, "repo");
    mkdirSync(join(root, "apps/web/src"), { recursive: true });
    mkdirSync(join(root, "apps/api"), { recursive: true });
    mkdirSync(join(root, ".agents/skills/tdd"), { recursive: true });
    mkdirSync(join(root, ".kiro/skills"), { recursive: true });
    symlinkSync(join(root, ".agents/skills/tdd"), join(root, ".kiro/skills/tdd"));
    writeFileSync(join(root, "pnpm-lock.yaml"), "");
    mkdirSync(join(box.root, "elsewhere"));
  });
  afterAll(() => {
    box.remove();
  });

  it.each([
    ["fs_write", { path: "pnpm-lock.yaml", text: "x" }, "pnpm-lock.yaml"],
    ["fs_append", { path: "mise.lock", text: "x" }, "mise.lock"],
    ["str_replace", { path: "README.md", oldStr: "a", newStr: "b" }, "README.md"],
    ["delete_file", { targetFile: "skills-lock.json", explanation: "x" }, "skills-lock.json"],
  ])("%s の path を cwd からの相対として読むこと", (tool, input, rel) => {
    expect(writeTarget(tool, input, root, root)).toBe(rel);
  });

  it("絶対 path を読むこと", () => {
    const path = join(root, "apps/web/src/routeTree.gen.ts");
    expect(writeTarget("fs_write", { path }, root, root)).toBe("apps/web/src/routeTree.gen.ts");
  });

  it("存在するディレクトリの . と .. を解決すること", () => {
    const input = { path: "./apps/api/../web/src/routeTree.gen.ts" };
    expect(writeTarget("fs_write", input, root, root)).toBe("apps/web/src/routeTree.gen.ts");
  });

  it("ルートより下の cwd からの相対 path を解決すること", () => {
    const input = { path: "src/routeTree.gen.ts" };
    expect(writeTarget("fs_write", input, join(root, "apps/web"), root)).toBe(
      "apps/web/src/routeTree.gen.ts",
    );
  });

  it("symlink をその先にたどること (.kiro/skills/<name> から .agents/skills/<name>)", () => {
    const input = { path: ".kiro/skills/tdd/SKILL.md" };
    expect(writeTarget("str_replace", input, root, root)).toBe(".agents/skills/tdd/SKILL.md");
  });

  it("まだ存在しないディレクトリを、書いたまま残すこと", () => {
    const input = { path: ".agents/skills/tdd/new/deeper/notes.md" };
    expect(writeTarget("fs_write", input, root, root)).toBe(
      ".agents/skills/tdd/new/deeper/notes.md",
    );
  });

  it("ルートのときはルートそのものであること", () => {
    expect(writeTarget("delete_file", { targetFile: "." }, root, root)).toBe("");
  });

  it("名前が 2 つのドットで始まるファイルを検査すること", () => {
    expect(writeTarget("fs_write", { path: "..pnpm-lock.yaml" }, root, root)).toBe(
      "..pnpm-lock.yaml",
    );
  });

  it.each([
    ["a path outside the root", "fs_write", { path: "../elsewhere/pnpm-lock.yaml" }],
    ["a path into another directory", "fs_write", { path: "/tmp/pnpm-lock.yaml" }],
    ["the directory above the root", "delete_file", { targetFile: ".." }],
    ["a write without a path", "fs_write", { text: "x" }],
    ["a path that is not a string", "fs_write", { path: 1 }],
    ["delete_file with path instead of targetFile", "delete_file", { path: "pnpm-lock.yaml" }],
    ["an input that is not an object", "fs_write", "pnpm-lock.yaml"],
    ["an empty path", "fs_write", { path: "" }],
  ])("%s のとき undefined であること", (_, tool, input) => {
    expect(writeTarget(tool, input, root, root)).toBeUndefined();
  });
});
