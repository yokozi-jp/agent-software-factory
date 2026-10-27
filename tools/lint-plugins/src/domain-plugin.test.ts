import { RuleTester } from "vite-plus/lint/plugins-dev";
import { describe, it } from "vite-plus/test";

import plugin from "./domain-plugin.ts";

RuleTester.describe = describe;
RuleTester.it = it;

// Indexing `plugin.rules` gives `Rule | undefined` (noUncheckedIndexedAccess).
const noThrow = plugin.rules["no-throw"];
if (!noThrow) throw new Error("no-throw の規則がない");

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("no-throw", noThrow, {
  valid: [
    // 失敗は Result で返す。
    'const f = (): Result<number, Failure> => ({ _tag: "Err", error: { _tag: "NoLines" } });',
    // throw ではない書き方。
    "const f = () => new Error('not thrown');",
    "const f = () => Promise.reject(new Error('x'));",
    "expect(() => run()).toThrow();",
    "const f = (error: Error) => error.message;",
  ],
  invalid: [
    { code: 'throw new Error("x");', errors: [{ messageId: "noThrow" }] },
    { code: 'function f() { throw new Error("x"); }', errors: [{ messageId: "noThrow" }] },
    { code: "const f = () => { throw error; };", errors: [{ messageId: "noThrow" }] },
    // 入れ子の関数、分岐、catch の中の throw も止める。
    {
      code: "function f(x: number) { if (x < 0) { throw new RangeError('x'); } }",
      errors: [{ messageId: "noThrow" }],
    },
    {
      code: "try { run(); } catch (e) { throw e; }",
      errors: [{ messageId: "noThrow" }],
    },
    {
      code: "const f = () => () => { throw new Error('x'); };",
      errors: [{ messageId: "noThrow" }],
    },
    // throw の数だけ報告する。
    {
      code: "function f(x: number) { if (x < 0) throw new Error('a'); throw new Error('b'); }",
      errors: [{ messageId: "noThrow" }, { messageId: "noThrow" }],
    },
  ],
});
