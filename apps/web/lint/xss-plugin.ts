// Oxlint plugin: blocks the code that opens an XSS hole in apps/web (docs/web-frontend/static-analysis.md).
// Oxlint's built-in rules (react/no-danger, no-eval, ...) cannot carry a message that tells the reader
// what to write instead, so these rules report their own messages: the reason, then the alternative.
import { definePlugin, defineRule } from "vite-plus/lint/plugins";

// The plugin API's AST types are not worth restating for these small checks; nodes are read by property name.
type Node = any;

const timerFunctions = new Set(["setTimeout", "setInterval"]);
const globalObjects = new Set(["window", "globalThis", "self"]);
const htmlSinkProperties = new Set(["innerHTML", "outerHTML"]);
const htmlSinkMethods = new Set(["insertAdjacentHTML", "write", "writeln"]);

const nameOf = (node: Node): string | undefined =>
  node?.type === "Identifier" ? node.name : undefined;

// `obj.name` and `obj["name"]`.
const propertyNameOf = (member: Node): string | undefined => {
  if (member?.type !== "MemberExpression") return undefined;
  if (!member.computed) return nameOf(member.property);
  return member.property.type === "Literal" && typeof member.property.value === "string"
    ? member.property.value
    : undefined;
};

// A string that is known at lint time: a literal, or a template literal without `${}`.
const staticString = (node: Node): string | undefined => {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
};

const noHtmlInjection = defineRule({
  meta: {
    type: "problem",
    messages: {
      dangerouslySetInnerHTML:
        "`dangerouslySetInnerHTML` inserts a string as HTML, so any user input in it runs as script (XSS). " +
        "Render the content as React elements. If you must show HTML you do not control, pass it through a sanitizer first, " +
        "and put the reason on the disable comment (docs/web-frontend/static-analysis.md).",
      htmlSink:
        "`{{name}}` inserts a string as HTML, so any user input in it runs as script (XSS). " +
        "Set `textContent` or render React elements instead. If you must insert HTML you do not control, sanitize it first, " +
        "and put the reason on the disable comment (docs/web-frontend/static-analysis.md).",
    },
  },
  create(context) {
    return {
      JSXAttribute(node: Node) {
        if (node.name.type === "JSXIdentifier" && node.name.name === "dangerouslySetInnerHTML") {
          context.report({ node, messageId: "dangerouslySetInnerHTML" });
        }
      },
      // `createElement("div", { dangerouslySetInnerHTML })` and `{...{ dangerouslySetInnerHTML }}`.
      Property(node: Node) {
        const key = node.computed
          ? staticString(node.key)
          : (nameOf(node.key) ?? staticString(node.key));
        if (key === "dangerouslySetInnerHTML") {
          context.report({ node, messageId: "dangerouslySetInnerHTML" });
        }
      },
      AssignmentExpression(node: Node) {
        const name = propertyNameOf(node.left);
        if (name && htmlSinkProperties.has(name)) {
          context.report({ node, messageId: "htmlSink", data: { name } });
        }
      },
      CallExpression(node: Node) {
        const name = propertyNameOf(node.callee);
        if (!name || !htmlSinkMethods.has(name)) return;
        // `write` and `writeln` are common method names; only `document.write` is the sink.
        if (name !== "insertAdjacentHTML" && nameOf(node.callee.object) !== "document") return;
        context.report({ node, messageId: "htmlSink", data: { name } });
      },
    };
  },
});

const noJavascriptUrl = defineRule({
  meta: {
    type: "problem",
    messages: {
      javascriptUrl:
        "A `javascript:` URL runs its code when the link is followed, so any user input in it is XSS. " +
        "Use an `onClick` handler for an action, or a real URL for navigation (docs/web-frontend/static-analysis.md).",
    },
  },
  create(context) {
    const check = (node: Node) => {
      const value = staticString(node);
      // Browsers ignore leading whitespace and control characters, and the scheme is case-insensitive.
      // oxlint-disable-next-line no-control-regex -- the control characters are what browsers strip
      if (value !== undefined && /^[\s\u0000-\u001f]*javascript:/i.test(value)) {
        context.report({ node, messageId: "javascriptUrl" });
      }
    };
    return {
      Literal: check,
      TemplateLiteral: check,
    };
  },
});

const noDynamicCode = defineRule({
  meta: {
    type: "problem",
    messages: {
      dynamicCode:
        "`{{name}}` runs a string as code, so any user input in it is XSS. " +
        "Call a function directly, or parse data with `JSON.parse`. If the code must be dynamic, " +
        "put the reason on the disable comment (docs/web-frontend/static-analysis.md).",
    },
  },
  create(context) {
    // `eval` / `Function`, bare or through the global object: `window.eval`, `globalThis["Function"]`.
    const dynamicCodeName = (node: Node): string | undefined => {
      const bare = nameOf(node);
      if (bare === "eval" || bare === "Function") return bare;
      const property = propertyNameOf(node);
      if (
        (property === "eval" || property === "Function") &&
        globalObjects.has(nameOf(node.object) ?? "")
      ) {
        return property;
      }
      // `(0, eval)(code)`, the indirect eval idiom.
      if (node?.type === "SequenceExpression") return dynamicCodeName(node.expressions.at(-1));
      return undefined;
    };
    return {
      CallExpression(node: Node) {
        const name = dynamicCodeName(node.callee);
        if (name) {
          context.report({ node, messageId: "dynamicCode", data: { name } });
          return;
        }
        // `setTimeout("code", 0)` evaluates the string. Only a string known at lint time is reported.
        const timer = nameOf(node.callee) ?? propertyNameOf(node.callee);
        if (timer && timerFunctions.has(timer) && staticString(node.arguments[0]) !== undefined) {
          context.report({
            node,
            messageId: "dynamicCode",
            data: { name: `${timer} with a string` },
          });
        }
      },
      NewExpression(node: Node) {
        const name = dynamicCodeName(node.callee);
        if (name) context.report({ node, messageId: "dynamicCode", data: { name: `new ${name}` } });
      },
    };
  },
});

// A disable comment without a reason hides a finding and leaves no trace of why.
// The reason goes after ` -- `, as in `// oxlint-disable-next-line no-eval -- why this is safe`.
const requireDisableReason = defineRule({
  meta: {
    type: "problem",
    messages: {
      missingReason:
        "A lint disable comment needs a reason: add ` -- <why this is safe>` after the rule names " +
        "(docs/web-frontend/static-analysis.md).",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (!/^\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?(?:\s|$)/.test(comment.value))
            continue;
          const reason = comment.value.split(/\s--(?:\s|$)/)[1]?.trim();
          if (!reason) context.report({ node: comment, messageId: "missingReason" });
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "web-xss" },
  rules: {
    "no-html-injection": noHtmlInjection,
    "no-javascript-url": noJavascriptUrl,
    "no-dynamic-code": noDynamicCode,
    "require-disable-reason": requireDisableReason,
  },
});
