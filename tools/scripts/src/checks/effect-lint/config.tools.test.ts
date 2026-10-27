// Process tests for oxlint.effect.json with the real `effect-tsgo oxlint` (pinned in pnpm-workspace.yaml) and the
// real Effect 4 of this repository, on a small project in a sandbox. The config and the pinned versions are
// inputs of the test-tools target (package.json).
// Why here: effecttsgo/outdated-api also reports once for the file, at line 1 column 1, and no disable comment
// reaches that report. So a fixture with a disable comment (as for the other three rules, in
// packages/*/src/{application,infrastructure}/__fixtures__/effect-tsgo.ts) cannot show that the rule works.
// A file with a v3 API must fail the check; a file with the v4 name must pass it.
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { isObject } from "../json.ts";
import { runIn, sandbox, type Sandbox } from "../../test/sandbox.ts";

const root = join(import.meta.dirname, "../../../../..");
const effectTsgo = join(root, "node_modules/@effect/tsgo/dist/effect-tsgo.cjs");

let box: Sandbox;
let project: string;

// The config of this repository without its ignore patterns, which keep the fixtures out of the normal run.
function config(): string {
  const parsed: unknown = JSON.parse(readFileSync(join(root, "oxlint.effect.json"), "utf8"));
  if (!isObject(parsed)) throw new Error("oxlint.effect.json is not a JSON object");
  const { ignorePatterns: _ignored, ...rest } = parsed;
  return JSON.stringify(rest);
}

beforeEach(() => {
  box = sandbox();
  project = join(box.root, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  mkdirSync(join(project, "node_modules"));
  writeFileSync(join(project, "package.json"), '{"type":"module"}');
  writeFileSync(
    join(project, "tsconfig.json"),
    '{"compilerOptions":{"target":"es2024","module":"esnext","moduleResolution":"bundler","strict":true,"noEmit":true,"types":[]},"include":["src"]}',
  );
  writeFileSync(join(project, "oxlint.json"), config());
  // effect-tsgo resolves oxlint from vite-plus, and the sources resolve effect and typescript, from the project.
  for (const [name, from] of [
    ["effect", "packages/shared/node_modules/effect"],
    ["vite-plus", "node_modules/vite-plus"],
    ["typescript", "node_modules/typescript"],
  ] as const)
    symlinkSync(realpathSync(join(root, from)), join(project, "node_modules", name));
});
afterEach(() => {
  box.remove();
});

const lint = (source: string) => {
  writeFileSync(join(project, "src/source.ts"), source);
  const result = runIn(
    project,
    process.execPath,
    [effectTsgo, "oxlint", "--type-aware", "-c", "oxlint.json", "src"],
    { timeout: 120_000 },
  );
  return { status: result.status, output: result.stdout + result.stderr };
};

describe("oxlint.effect.json", { timeout: 120_000 }, () => {
  it("passes an Effect written with the v4 names", () => {
    const result = lint(
      'import { Effect } from "effect";\n\nexport const caught = Effect.catch(Effect.fail(1), () => Effect.succeed(2));\n',
    );
    expect(result.output).toContain("Found 0 warnings and 0 errors");
    expect(result.status).toBe(0);
  });

  it("fails on a v3 function name, and names the rule and the v4 name", () => {
    const result = lint(
      'import { Effect } from "effect";\n\nexport const caught = Effect.catchAll(Effect.fail(1), () => Effect.succeed(2));\n',
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain("effecttsgo(outdated-api)");
    expect(result.output).toContain("`catchAll`");
    expect(result.output).toContain("Renamed to catch");
  });

  it("fails on another v3 function name", () => {
    const result = lint(
      'import { Effect } from "effect";\n\nexport const fiber = Effect.fork(Effect.succeed(1));\n',
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain("effecttsgo(outdated-api)");
    expect(result.output).toContain("Renamed to forkChild");
  });

  it("fails on an Effect that is created and never run", () => {
    const result = lint('import { Effect } from "effect";\n\nEffect.succeed(1);\n');
    expect(result.status).toBe(1);
    expect(result.output).toContain("effecttsgo(floating-effect)");
  });
});
