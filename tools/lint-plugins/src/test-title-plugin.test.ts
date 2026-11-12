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
    'it.only("セッションが始まること", () => {});',
    'describe.skip("startPostgres", () => {});',
    'it.skipIf(ci)("日本語の名前", () => {});',
    // describe の名前は、コードの名前 1 つ (空白なし) ならそのまま書ける。
    'describe("startPostgres", () => {});',
    'describe("vite.config.ts", () => {});',
    'describe("checkNumbers()", () => {});',
    'describe.each([1, 2])("parseIssues", () => {});',
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
    'items.it.each([1, 2])("english", () => {});',
    'build(1)("english", () => {});',
    'it["each"]([1, 2])("english", () => {});',
    'items.it.only("english", () => {});',
    'it.unknown("english", () => {});',
    'it.each[1]("english", () => {});',
    'items.map([1, 2])("english", () => {});',
    // 名前が文字列でないものは、検査できないので通す。
    "it(title, () => {});",
    "it();",
  ],
  invalid: [
    {
      code: 'describe("log in", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    // 修飾子 (only、skip、concurrent、skipIf、for) を付けても検査する。
    {
      code: 'it.only("returns ok", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    {
      code: 'it.skip("returns ok", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    {
      code: 'it.concurrent.each([1, 2])("accepts %s", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    {
      code: 'it.skipIf(ci)("returns ok", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    {
      code: 'test.for([1, 2])("accepts %s", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    {
      code: 'it.skip("startPostgres", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    // it と test の名前は、コードの名前 1 つでも日本語が要る。
    {
      code: 'it("startPostgres", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    {
      code: 'test("startPostgres", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    {
      code: 'it.each([1, 2])("startPostgres", () => {});',
      errors: [{ messageId: "notJapanese" }],
    },
    // 空白を含む名前は、コードの名前 1 つではない。
    {
      code: 'describe("startPostgres starts", () => {});',
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
