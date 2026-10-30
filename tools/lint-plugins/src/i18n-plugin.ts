// Oxlint plugin: the key passed to `t` is a string literal (docs/adr/0044). `i18next-cli` finds the keys of the
// code by reading `t("…")`, so `status` misses a key that is not in the resources when `t` is given a variable or a
// built string, and `status --unused` reports the key that such a call uses as unused. No built-in rule of Oxlint
// reads the first argument of a call by the name of the callee, so this is a plugin (docs/adr/0019, docs/adr/0030).
import { definePlugin, defineRule, type ESTree } from "vite-plus/lint/plugins";

type AstNode = ESTree.Node | null | undefined;

// The objects whose `t` method is the translation function.
const i18nObjects = new Set(["i18n", "i18next"]);

const nameOf = (node: AstNode): string | undefined =>
  node?.type === "Identifier" ? node.name : undefined;

// `obj.name` and `obj["name"]`.
const propertyNameOf = (member: ESTree.MemberExpression): string | undefined => {
  if (!member.computed) return nameOf(member.property);
  return member.property.type === "Literal" && typeof member.property.value === "string"
    ? member.property.value
    : undefined;
};

// A key that i18next-cli can read: a string literal, or a template literal without `${}`.
const isLiteralKey = (node: ESTree.Node): boolean =>
  (node.type === "Literal" && typeof node.value === "string") ||
  (node.type === "TemplateLiteral" && node.expressions.length === 0);

// The name that `const { t: name } = useTranslation()` binds `t` to.
const translationAlias = (declarator: ESTree.VariableDeclarator): string | undefined => {
  const { id, init } = declarator;
  if (id.type !== "ObjectPattern" || init?.type !== "CallExpression") return undefined;
  if (nameOf(init.callee) !== "useTranslation") return undefined;
  for (const property of id.properties) {
    if (property.type !== "Property" || property.computed) continue;
    if (nameOf(property.key) !== "t") continue;
    // `{ t: translate }` and `{ t: translate = fallback }`.
    const value = property.value;
    return nameOf(value.type === "AssignmentPattern" ? value.left : value);
  }
  return undefined;
};

const literalKey = defineRule({
  meta: {
    type: "problem",
    messages: {
      nonLiteralKey:
        'Pass `t` the key as a string literal, `t("home.title")`. `i18next-cli` finds the keys by reading the ' +
        "literal, so a key built from a variable or a template is missed when it is not in the resources, and the " +
        'key it builds is reported as unused. Write one `t("…")` for each key, and choose between them with ' +
        "`switch` or an object of `t` calls (docs/adr/0044).",
    },
  },
  create(context) {
    const aliases = new Set<string>();
    return {
      VariableDeclarator(node) {
        const alias = translationAlias(node);
        if (alias) aliases.add(alias);
      },
      CallExpression(node) {
        const callee = node.callee;
        const isTranslation =
          callee.type === "MemberExpression"
            ? propertyNameOf(callee) === "t" && i18nObjects.has(nameOf(callee.object) ?? "")
            : (() => {
                const name = nameOf(callee);
                return name === "t" || (name !== undefined && aliases.has(name));
              })();
        if (!isTranslation) return;
        const key = node.arguments[0];
        if (key && !isLiteralKey(key)) context.report({ node: key, messageId: "nonLiteralKey" });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "i18n" },
  rules: { "literal-key": literalKey },
});
