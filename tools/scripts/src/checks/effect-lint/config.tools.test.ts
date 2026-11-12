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
import rootConfig from "../../../../../vite.config.ts";

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
    ["effect", "packages/shared-kernel/node_modules/effect"],
    ["vite-plus", "node_modules/vite-plus"],
    ["typescript", "node_modules/typescript"],
  ] as const)
    symlinkSync(realpathSync(join(root, from)), join(project, "node_modules", name));
});
afterEach(() => {
  box.remove();
});

const lint = (source: string, ...flags: string[]) => {
  writeFileSync(join(project, "src/source.ts"), source);
  const result = runIn(
    project,
    process.execPath,
    [effectTsgo, "oxlint", "--type-aware", "-c", "oxlint.json", ...flags, "src"],
    { timeout: 120_000 },
  );
  return { status: result.status, output: result.stdout + result.stderr };
};

describe("oxlint.effect.json", { timeout: 120_000 }, () => {
  it("v4 の名前で書いた Effect を通すこと", () => {
    const result = lint(
      'import { Effect } from "effect";\n\nexport const caught = Effect.catch(Effect.fail(1), () => Effect.succeed(2));\n',
    );
    expect(result.output).toContain("Found 0 warnings and 0 errors");
    expect(result.status).toBe(0);
  });

  it("v3 の関数名で失敗し、規則と v4 の名前を挙げること", () => {
    const result = lint(
      'import { Effect } from "effect";\n\nexport const caught = Effect.catchAll(Effect.fail(1), () => Effect.succeed(2));\n',
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain("effecttsgo(outdated-api)");
    expect(result.output).toContain("`catchAll`");
    expect(result.output).toContain("Renamed to catch");
  });

  it("別の v3 の関数名で失敗すること", () => {
    const result = lint(
      'import { Effect } from "effect";\n\nexport const fiber = Effect.fork(Effect.succeed(1));\n',
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain("effecttsgo(outdated-api)");
    expect(result.output).toContain("Renamed to forkChild");
  });

  it("作っただけで実行しない Effect で失敗すること", () => {
    const result = lint('import { Effect } from "effect";\n\nEffect.succeed(1);\n');
    expect(result.status).toBe(1);
    expect(result.output).toContain("effecttsgo(floating-effect)");
  });
});

// `vp check` demands an `oxlint-disable` for each rule of `typedRules` (vite.config.ts). `lint-effect` reports a disable
// of a rule that it does not enable as unused (reportUnusedDisableDirectives), so it enables the same rules.
describe("oxlint.effect.json と vite.config.ts の型つきの規則", () => {
  it("vite.config.ts が有効にするすべての typescript/* の規則を、同じ option で有効にすること", () => {
    const parsed: unknown = JSON.parse(readFileSync(join(root, "oxlint.effect.json"), "utf8"));
    if (!isObject(parsed) || !isObject(parsed.rules))
      throw new Error("oxlint.effect.json has no rules");
    const typed = (rules: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(rules).filter(([name]) => name.startsWith("typescript/")));
    expect(typed(parsed.rules)).toEqual(typed({ ...rootConfig.lint?.rules }));
  });
});

// #517: lint-effect has only some of the rules, so the script of a module turns the report of unused disable comments
// off (modulesLintEffect in repo-policy), and module-fixtures keeps the setting of the config (error), where the
// disable comments prove that the effecttsgo rules fire. These tests run both with the real tool: the flag must
// override the config, and must not let a violation through.
describe("oxlint.effect.json と未使用の disable の報告", { timeout: 120_000 }, () => {
  const off = ["--report-unused-disable-directives-severity", "off"];
  // no-restricted-imports is a rule of vp check (vite.config.ts) that this config does not load.
  const otherRule =
    "// oxlint-disable-next-line no-restricted-imports -- a rule of vp check\nexport const value = 1;\n";
  const floating =
    'import { Effect } from "effect";\n\n// oxlint-disable-next-line effecttsgo/floating-effect -- fixture\nEffect.succeed(1);\n';

  it("設定のままでは、この設定にない規則の disable を、未使用として報告して失敗すること", () => {
    const result = lint(otherRule);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Unused oxlint-disable directive");
  });

  it("flag で報告を切ると、この設定にない規則の disable を通すこと", () => {
    const result = lint(otherRule, ...off);
    expect(result.output).toContain("Found 0 warnings and 0 errors");
    expect(result.status).toBe(0);
  });

  it("flag で報告を切っても、v3 の API と実行し忘れの Effect で失敗すること", () => {
    const outdated = lint(
      'import { Effect } from "effect";\n\nexport const caught = Effect.catchAll(Effect.fail(1), () => Effect.succeed(2));\n',
      ...off,
    );
    expect(outdated.status).toBe(1);
    expect(outdated.output).toContain("effecttsgo(outdated-api)");
    const unrun = lint('import { Effect } from "effect";\n\nEffect.succeed(1);\n', ...off);
    expect(unrun.status).toBe(1);
    expect(unrun.output).toContain("effecttsgo(floating-effect)");
  });

  it("flag で報告を切っても、unstable と experimental の API で失敗すること", () => {
    const unstable = lint(
      'import { Effect } from "effect";\n\nexport const reported = Effect.withErrorReporting(Effect.succeed(1));\n',
      ...off,
    );
    expect(unstable.status).toBe(1);
    expect(unstable.output).toContain("effecttsgo(unstable-api-usage)");
    const experimental = lint(
      'import { Schema } from "effect";\n\nexport const domain = Schema.DomainName;\n',
      ...off,
    );
    expect(experimental.status).toBe(1);
    expect(experimental.output).toContain("effecttsgo(experimental-api-usage)");
  });

  it("flag で報告を切っても、型つきの規則の違反で失敗すること", () => {
    const result = lint("export const value = (JSON.parse('1') as number) + 1;\n", ...off);
    expect(result.status).toBe(1);
    expect(result.output).toContain("no-unsafe-type-assertion");
  });

  it("設定のままでは、規則が止める行の disable を通し、規則が外れた行の disable を失敗させること", () => {
    const works = lint(floating);
    expect(works.output).toContain("Found 0 warnings and 0 errors");
    expect(works.status).toBe(0);
    const outOfRule = lint(
      'import { Effect } from "effect";\n\n// oxlint-disable-next-line effecttsgo/floating-effect -- fixture\nexport const ran = Effect.succeed(1);\n',
    );
    expect(outOfRule.status).toBe(1);
    expect(outOfRule.output).toContain("Unused oxlint-disable directive");
  });
});
