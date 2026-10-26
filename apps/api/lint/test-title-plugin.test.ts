import { RuleTester } from "vite-plus/lint/plugins-dev";
import { describe, it } from "vite-plus/test";

import plugin from "./test-title-plugin.ts";

// プラグインの規則は 1 つだけなので、名前で引いて、なければ失敗にする。
const japaneseTitle = plugin.rules["japanese-title"];
if (!japaneseTitle) throw new Error("japanese-title の規則がない");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

tester.run("japanese-title", japaneseTitle, {
  valid: [
    'describe("ログイン", () => {});',
    'it("セッションが始まること", () => {});',
    'test("ok を返すこと", () => {});',
    // 英数字が混ざっていてもよい。日本語が1文字でもあればよい。
    'it("OIDC でログインできること (ADR 0022)", () => {});',
    'it.each([1, 2])("値 %s を受け取ること", () => {});',
    'describe.each([1, 2])("値 %s の検査", () => {});',
    "it(`${name} を拒否すること`, () => {});",
    // テスト名ではない呼び出し。
    'items.it("english", () => {});',
    'expect("english").toBe("english");',
    // 名前が文字列でないものは、検査できないので通す。
    "it(title, () => {});",
  ],
  invalid: [
    {
      code: 'describe("login", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    {
      code: 'it("returns ok", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    {
      code: 'test("returns ok", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    {
      code: 'it.each([1, 2])("accepts %s", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    {
      code: 'describe.each([1, 2])("value %s", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    {
      code: "it(`returns ${name}`, () => {});",
      errors: [{ messageId: "notJapanese" }],
    },
    {
      code: 'it("", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
  ],
});
