import { RuleTester } from "vite-plus/lint/plugins-dev";
import { describe, it } from "vite-plus/test";

import plugin from "./xss-plugin.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx", ecmaFeatures: { jsx: true } } },
});

tester.run("no-html-injection", plugin.rules["no-html-injection"], {
  valid: [
    "const a = <div>{text}</div>;",
    "el.textContent = text;",
    "writer.write(text);",
    "const a = { html: text };",
  ],
  invalid: [
    {
      code: "const a = <div dangerouslySetInnerHTML={{ __html: html }} />;",
      errors: [{ messageId: "dangerouslySetInnerHTML" }],
    },
    {
      code: "const a = <Markdown dangerouslySetInnerHTML={{ __html: html }} />;",
      errors: [{ messageId: "dangerouslySetInnerHTML" }],
    },
    {
      code: 'createElement("div", { dangerouslySetInnerHTML: { __html: html } });',
      errors: [{ messageId: "dangerouslySetInnerHTML" }],
    },
    { code: "el.innerHTML = html;", errors: [{ messageId: "htmlSink" }] },
    { code: 'el["outerHTML"] = html;', errors: [{ messageId: "htmlSink" }] },
    { code: 'el.insertAdjacentHTML("beforeend", html);', errors: [{ messageId: "htmlSink" }] },
    { code: "document.write(html);", errors: [{ messageId: "htmlSink" }] },
  ],
});

tester.run("no-javascript-url", plugin.rules["no-javascript-url"], {
  valid: [
    'const a = <a href="https://example.com">x</a>;',
    'const a = "see javascript: docs";',
    "const a = <a href={url}>x</a>;",
  ],
  invalid: [
    {
      code: 'const a = <a href="javascript:void(0)">x</a>;',
      errors: [{ messageId: "javascriptUrl" }],
    },
    {
      code: 'const a = <a href="  JavaScript:alert(1)">x</a>;',
      errors: [{ messageId: "javascriptUrl" }],
    },
    { code: 'location.href = "javascript:alert(1)";', errors: [{ messageId: "javascriptUrl" }] },
    { code: "const a = `javascript:alert(1)`;", errors: [{ messageId: "javascriptUrl" }] },
  ],
});

tester.run("no-dynamic-code", plugin.rules["no-dynamic-code"], {
  valid: [
    "JSON.parse(text);",
    "setTimeout(() => run(), 0);",
    "setTimeout(callback, 0);",
    "const f = (eval: number) => eval;",
    "obj.eval(code);",
  ],
  invalid: [
    { code: 'eval("1");', errors: [{ messageId: "dynamicCode" }] },
    { code: 'window.eval("1");', errors: [{ messageId: "dynamicCode" }] },
    { code: 'globalThis["eval"]("1");', errors: [{ messageId: "dynamicCode" }] },
    { code: '(0, eval)("1");', errors: [{ messageId: "dynamicCode" }] },
    { code: 'new Function("return 1");', errors: [{ messageId: "dynamicCode" }] },
    { code: 'Function("return 1");', errors: [{ messageId: "dynamicCode" }] },
    { code: 'setTimeout("alert(1)", 0);', errors: [{ messageId: "dynamicCode" }] },
    { code: 'window.setInterval("alert(1)", 0);', errors: [{ messageId: "dynamicCode" }] },
  ],
});

tester.run("require-disable-reason", plugin.rules["require-disable-reason"], {
  valid: [
    "// an ordinary comment\nconst a = 1;",
    "// oxlint-disable-next-line no-eval -- the string is a build-time constant\neval(code);",
    "/* eslint-disable no-eval -- legacy widget, removal tracked in #1 */\neval(code);",
  ],
  invalid: [
    {
      code: "// oxlint-disable-next-line no-eval\neval(code);",
      errors: [{ messageId: "missingReason" }],
    },
    {
      code: "eval(code); // eslint-disable-line no-eval --",
      errors: [{ messageId: "missingReason" }],
    },
    { code: "/* oxlint-disable */\neval(code);", errors: [{ messageId: "missingReason" }] },
    {
      code: "// oxlint-disable-next-line no-eval -- \neval(code);",
      errors: [{ messageId: "missingReason" }],
    },
  ],
});
