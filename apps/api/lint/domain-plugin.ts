// Oxlint plugin: blocks `throw` in the domain layer of the modules, packages/*/src/domain (docs/adr/0027).
// domain returns a business failure as a Result instead of throwing it, so the caller has to handle each failure.
// The rule is a plugin, as in docs/adr/0019, so that its message can say what to write instead.
import { definePlugin, defineRule } from "vite-plus/lint/plugins";

const noThrow = defineRule({
  meta: {
    type: "problem",
    messages: {
      noThrow:
        "domain does not `throw`: a caller cannot see from the type that the function fails, so a missing handler is not stopped. " +
        'Return a Result: `{ _tag: "Err", error: { _tag: "<what happened>" } }`, with the type Result from ' +
        "@agent-software-factory/shared (`import type`). Only the parseX functions of infrastructure throw, " +
        "for a row that is not a domain value (docs/adr/0027, docs/domain-model/failures.md).",
    },
  },
  create(context) {
    return {
      ThrowStatement(node) {
        context.report({ node, messageId: "noThrow" });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "domain" },
  rules: {
    "no-throw": noThrow,
  },
});
