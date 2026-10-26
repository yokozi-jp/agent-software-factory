// The real jscpd (`pnpm lint:dup`) with the .jscpd.json and .gitignore of this repository, on code written
// here in a sandbox repository. A deliberate copy is kept by marking it, not by raising the threshold
// (docs/adr/0014).
// Reads .jscpd.json and .gitignore of the workspace, inputs of the test-tools target
// (tools/scripts/package.json). The jscpd version is pinned in pnpm-workspace.yaml (`sharedGlobals`).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { gitIn, runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const workspace = join(import.meta.dirname, "../../../..");
const jscpd = join(workspace, "node_modules/.bin/jscpd");

// A function long enough to count as a clone (11 lines, about 100 tokens).
const summarize = `export function summarize(items: { name: string; price: number; quantity: number }[]) {
  let total = 0;
  const lines: string[] = [];
  for (const item of items) {
    const subtotal = item.price * item.quantity;
    total += subtotal;
    lines.push(\`\${item.name}: \${item.quantity} x \${item.price} = \${subtotal}\`);
  }
  lines.push(\`total: \${total}\`);
  return lines.join("\\n");
}
`;

let box: Sandbox;
let repo: string;
const put = (path: string, text = summarize): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};
const scan = () => runIn(repo, jscpd, []);

beforeAll(() => {
  box = sandbox();
  repo = join(box.root, "repo");
  gitIn(repo, ["init", "-q", "-b", "main"]);
  for (const file of [".jscpd.json", ".gitignore"]) cpSync(join(workspace, file), join(repo, file));
});
afterAll(() => {
  box.remove();
});
// Only apps/api/src/summarize.ts, the copy every case is compared with.
beforeEach(() => {
  for (const dir of ["apps", "packages", "tools"])
    rmSync(join(repo, dir), { recursive: true, force: true });
  put("apps/api/src/summarize.ts");
});

describe("jscpd with .jscpd.json", () => {
  it("passes code with no copy", () => {
    expect(scan().status).toBe(0);
  });

  it.each([
    ["in another app", "apps/web/src/summarize.ts"],
    ["in the same app", "apps/api/src/other.ts"],
    ["in packages/", "packages/shared/src/summarize.ts"],
  ])("fails on a copy %s", (_, path) => {
    put(path);
    expect(scan().status).toBe(1);
  });

  it.each([
    "apps/web/src/routeTree.gen.ts",
    "apps/web/.tanstack/tmp/summarize.ts",
    "apps/api/src/fixtures/summarize.ts",
    "apps/api/src/__fixtures__/summarize.ts",
    "apps/api/dist/summarize.ts",
    "tools/scripts/summarize.ts",
  ])("ignores a copy in %s", (path) => {
    put(path);
    expect(scan().status).toBe(0);
  });

  it("ignores a copy between jscpd:ignore-start and jscpd:ignore-end", () => {
    put("apps/web/src/summarize.ts", `// jscpd:ignore-start\n${summarize}// jscpd:ignore-end\n`);
    expect(scan().status).toBe(0);
  });

  // failOnEmpty: a pattern or format that matches no file fails instead of passing unchecked.
  it("fails when no file is scanned", () => {
    rmSync(join(repo, "apps"), { recursive: true });
    expect(scan().status).toBe(1);
  });

  it("is configured to count the copy that it fails on", () => {
    const config: unknown = JSON.parse(readFileSync(join(repo, ".jscpd.json"), "utf8"));
    expect(config).toMatchObject({ threshold: 0, failOnEmpty: true });
  });
});
