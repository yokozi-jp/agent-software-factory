// Oxlint plugin: stops the SQL that changes the role or the tenant of the connection, outside the helper of shared
// (docs/adr/0029, docs/adr/0011). inTenantTransaction (packages/shared/src/tenant-transaction.ts) runs `SET LOCAL ROLE`
// and `set_config('app.current_tenant', …, true)` right after the start of every transaction. SQL that does the same
// elsewhere can leave a role or a tenant on a pooled connection, or switch to another module's role. A type cannot stop
// a `sql` template, so this rule reads the text of it. The rule is a plugin, as in docs/adr/0019, so that its message
// can say what to write instead.
import { definePlugin, defineRule, type ESTree } from "vite-plus/lint/plugins";

type AstNode = ESTree.Node | null | undefined;

// What changes the role or the tenant: `SET [LOCAL|SESSION] ROLE`, `RESET ROLE`, `SET [LOCAL|SESSION] SESSION
// AUTHORIZATION`, `set_config`, and the setting of the tenant by name. A column named `role` in `UPDATE t SET role = …`
// is not matched: `ROLE` must follow `SET` (and the optional scope) directly and no `=` may follow it; `role_name` is
// another word.
const sessionSetting =
  /\bset\s+(?:(?:local|session)\s+)?role\b(?!\s*=)|\breset\s+role\b|\bset\s+(?:(?:local|session)\s+)?session\s+authorization\b|\bset_config\b|\bapp\.current_tenant\b/i;

const isSqlTag = (tag: AstNode): boolean => {
  if (tag?.type === "Identifier") return tag.name === "sql";
  return (
    tag?.type === "MemberExpression" &&
    !tag.computed &&
    tag.property.type === "Identifier" &&
    tag.property.name === "sql"
  );
};

// The text of a string that is known at lint time: a literal, or the parts of a template literal around its `${}`.
const staticText = (node: AstNode): string => {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral")
    return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(" ");
  return "";
};

const noSessionSetting = defineRule({
  meta: {
    type: "problem",
    messages: {
      sessionSetting:
        "Do not change the role or the tenant of the connection in SQL: it can stay on a pooled connection or switch to " +
        "another module's role. Open a transaction with inTenantTransaction of @agent-software-factory/shared, which runs " +
        "SET LOCAL ROLE and the tenant setting right after the start (docs/adr/0011, docs/adr/0029).",
    },
  },
  create(context) {
    return {
      TaggedTemplateExpression(node) {
        if (isSqlTag(node.tag) && sessionSetting.test(staticText(node.quasi))) {
          context.report({ node, messageId: "sessionSetting" });
        }
      },
      // sql.raw("SET ROLE x"): a string known at lint time.
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.object.type === "Identifier" &&
          callee.object.name === "sql" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "raw" &&
          sessionSetting.test(staticText(node.arguments[0]))
        ) {
          context.report({ node, messageId: "sessionSetting" });
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "tenant-sql" },
  rules: {
    "no-session-setting": noSessionSetting,
  },
});
