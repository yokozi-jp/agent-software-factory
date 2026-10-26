// Oxlint plugin: the title of every test in apps/*/src is written in Japanese.
// With `--reporter=verbose`, the titles of a run read as a list of what the code guarantees,
// so a reader who does not read the test code can follow it (CODING_STANDARDS.md "テスト名").
import { definePlugin, defineRule, type ESTree } from "vite-plus/lint/plugins";

type AstNode = ESTree.Node | null | undefined;

const testFunctions = new Set(["describe", "it", "test"]);

// Hiragana, katakana (including the long-vowel mark) and CJK ideographs.
const japanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u;

const nameOf = (node: AstNode): string | undefined =>
  node?.type === "Identifier" ? node.name : undefined;

// `describe("title")`, `it("title")`, `test("title")` and the table forms `it.each(table)("title")`.
const isTestDeclaration = (callee: AstNode): boolean => {
  const name = nameOf(callee);
  if (name !== undefined) return testFunctions.has(name);
  // `it.each(table)` returns a function that takes the title.
  if (callee?.type !== "CallExpression") return false;
  const each = callee.callee;
  return (
    each.type === "MemberExpression" &&
    !each.computed &&
    nameOf(each.property) === "each" &&
    testFunctions.has(nameOf(each.object) ?? "")
  );
};

// The text of a title that is known at lint time: a string literal, or the fixed parts of a template literal.
// A title built from a variable has no text to check, so it returns undefined.
const titleText = (node: AstNode): string | undefined => {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral") {
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
        "英数字や略語が混ざってもよいが、日本語を1文字は含める。",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isTestDeclaration(node.callee)) return;
        const text = titleText(node.arguments[0]);
        if (text === undefined || japanese.test(text)) return;
        context.report({ node: node.arguments[0] ?? node, messageId: "notJapanese" });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "test-title" },
  rules: { "japanese-title": japaneseTitle },
});
