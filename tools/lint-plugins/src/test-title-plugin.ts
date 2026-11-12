// Oxlint plugin: the title of every test is written in Japanese.
// With `--reporter=verbose`, the titles of a run read as a list of what the code guarantees,
// so a reader who does not read the test code can follow it (CODING_STANDARDS.md "テスト名").
import { definePlugin, defineRule, type ESTree } from "vite-plus/lint/plugins";

type AstNode = ESTree.Node | null | undefined;

const testFunctions = new Set(["describe", "it", "test"]);

// Hiragana, katakana (including the long-vowel mark) and CJK ideographs.
const japanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u;

// The title of a describe that is one name from the code, such as `describe("startPostgres")` or
// `describe("vite.config.ts")`. It names the thing under test and says nothing in a language, so it needs no
// Japanese. It has no space. An `it` or a `test` says what holds, so it always needs Japanese.
const codeName = /^[A-Za-z_$][\w$.\-/]*(?:\(\))?$/u;

const nameOf = (node: AstNode): string | undefined =>
  node?.type === "Identifier" ? node.name : undefined;

// The function a declaration calls: `describe("title")`, `it("title")`, `test("title")` and the table forms
// `it.each(table)("title")`. Anything else is not a test declaration.
const declaredWith = (callee: AstNode): string | undefined => {
  const name = nameOf(callee);
  if (name !== undefined) return testFunctions.has(name) ? name : undefined;
  // `it.each(table)` returns a function that takes the title.
  if (callee?.type !== "CallExpression") return undefined;
  const each = callee.callee;
  if (each.type !== "MemberExpression" || each.computed || nameOf(each.property) !== "each") {
    return undefined;
  }
  const object = nameOf(each.object);
  return object !== undefined && testFunctions.has(object) ? object : undefined;
};

// The text of a title that is known at lint time: a string literal, or the fixed parts of a template literal.
// A title built from a variable has no text to check, so it returns undefined.
const titleText = (node: AstNode): string | undefined => {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral") {
    // cooked is null only for an invalid escape, which is a syntax error outside a tagged template.
    /* v8 ignore next -- the null case cannot be parsed here */
    return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("");
  }
  return undefined;
};

const japaneseTitle = defineRule({
  meta: {
    type: "problem",
    messages: {
      notJapanese:
        "テスト名は日本語で書く。「〜すること」「〜しないこと」の形にする。" +
        "実行結果 (--reporter=verbose) が、そのまま何を保証しているかの一覧になるため。" +
        "英数字や略語が混ざってもよいが、日本語を1文字は含める。" +
        "describe の名前だけは、startPostgres のようなコードの名前 1 つ (空白なし) をそのまま書ける。",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const declaration = declaredWith(node.callee);
        if (declaration === undefined) return;
        const [title] = node.arguments;
        const text = titleText(title);
        if (title === undefined || text === undefined || japanese.test(text)) return;
        if (declaration === "describe" && codeName.test(text)) return;
        context.report({ node: title, messageId: "notJapanese" });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "test-title" },
  rules: { "japanese-title": japaneseTitle },
});
