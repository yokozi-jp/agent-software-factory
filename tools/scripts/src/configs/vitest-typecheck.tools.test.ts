// Process tests for the type tests (*.test-d.ts) with the real Vitest and the real TypeScript of the workspace (pinned in
// pnpm-workspace.yaml), on a small project in a sandbox. packages/db reads its type tests with the `typecheck` option
// (docs/adr/0020, #436): Vitest runs `tsc --noEmit` and reports a type error as a failed test. This shows that, with the
// versions pinned today, a wrong expected type, an unused @ts-expect-error and a real type error each fail the run, and
// a correct file passes. A new Vitest or TypeScript (Renovate) that reads the output of `tsc` wrongly would pass a broken
// type test; the test fails first. Reads pnpm-lock.yaml of the workspace, an input of the test-tools target
// (package.json). The `typecheck` keys and the file name are the ones of packages/db/vite.config.ts.
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { runIn, sandbox, type Sandbox } from "../test/sandbox.ts";

const workspace = join(import.meta.dirname, "../../../..");
const vp = join(workspace, "node_modules/.bin/vp");

let box: Sandbox;
let count = 0;

const put = (path: string, text: string): void => {
  mkdirSync(dirname(join(box.root, path)), { recursive: true });
  writeFileSync(join(box.root, path), text);
};

// A project of its own for each case, so that a result is never read from the case before. `source` is the type test.
function typecheck(source: string): { readonly status: number | null; readonly output: string } {
  count += 1;
  const project = `case-${count}`;
  put(
    `${project}/vite.config.ts`,
    'import { defineConfig } from "vite-plus";\nexport default defineConfig({ test: { include: ["src/**/*.test.ts"], typecheck: { enabled: true, include: ["src/**/*.test-d.ts"] } } });\n',
  );
  put(
    `${project}/tsconfig.json`,
    '{ "compilerOptions": { "noEmit": true, "module": "nodenext", "moduleResolution": "nodenext", "target": "es2024", "strict": true, "skipLibCheck": true, "types": [] }, "include": ["src"] }\n',
  );
  put(`${project}/src/a.test-d.ts`, source);
  const result = runIn(join(box.root, project), vp, ["test", "run"], { timeout: 100_000 });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const header = 'import { expectTypeOf, it } from "vite-plus/test";\n';

beforeAll(() => {
  box = sandbox();
  put("package.json", '{"type":"module"}');
  // vite-plus is imported by the config and the type test, and Vitest starts `tsc` from node_modules/.bin of the project root.
  // The shim of pnpm finds its package through the link, so a link to the workspace's shim is enough.
  mkdirSync(join(box.root, "node_modules/.bin"), { recursive: true });
  symlinkSync(
    realpathSync(join(workspace, "node_modules/vite-plus")),
    join(box.root, "node_modules/vite-plus"),
  );
  symlinkSync(
    realpathSync(join(workspace, "node_modules/typescript")),
    join(box.root, "node_modules/typescript"),
  );
  symlinkSync(join(workspace, "node_modules/.bin/tsc"), join(box.root, "node_modules/.bin/tsc"));
});
afterAll(() => {
  box.remove();
});

describe("型だけのテスト (*.test-d.ts) の typecheck", { timeout: 120_000 }, () => {
  it("型が合っていれば通ること", () => {
    const { status, output } = typecheck(
      `${header}it("文字列であること", () => {\n  expectTypeOf<string>().toEqualTypeOf<string>();\n  // @ts-expect-error -- number は string に入らない\n  const text: string = 1;\n  expectTypeOf(text).toBeString();\n});\n`,
    );

    expect(output).toContain("1 passed");
    expect(status).toBe(0);
  });

  it("期待の型が違えば失敗すること", () => {
    const { status, output } = typecheck(
      `${header}it("文字列であること", () => {\n  expectTypeOf<string>().toEqualTypeOf<number>();\n});\n`,
    );

    expect(output).toContain("TypeCheckError");
    expect(output).toContain("1 failed");
    expect(status).not.toBe(0);
  });

  it("エラーにならない行に @ts-expect-error を残せば失敗すること", () => {
    const { status, output } = typecheck(
      `${header}it("文字列であること", () => {\n  // @ts-expect-error -- 型は合っているので、使われない\n  const text: string = "a";\n  expectTypeOf(text).toBeString();\n});\n`,
    );

    expect(output).toContain("Unused '@ts-expect-error' directive");
    expect(status).not.toBe(0);
  });

  it("@ts-expect-error のない本物の型エラーは失敗すること", () => {
    const { status, output } = typecheck(
      `${header}it("文字列であること", () => {\n  const text: string = 1;\n  expectTypeOf(text).toBeString();\n});\n`,
    );

    expect(output).toContain("not assignable to type 'string'");
    expect(status).not.toBe(0);
  });

  it("テストの外にある型エラーでも失敗すること", () => {
    const { status, output } = typecheck(
      `${header}it("文字列であること", () => {\n  expectTypeOf<string>().toBeString();\n});\nexpectTypeOf<string>().toEqualTypeOf<number>();\n`,
    );

    expect(output).toContain("TypeCheckError");
    expect(status).not.toBe(0);
  });
});
