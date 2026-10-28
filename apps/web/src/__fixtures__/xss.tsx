// Detection-power fixture (#230) for the XSS rules of apps/web/src (the web-xss rules and
// unicorn/no-abusive-eslint-disable in the root vite.config.ts, docs/web-frontend/static-analysis.md). Each
// statement below is what a rule must report. The rules themselves are tested by RuleTester in
// tools/lint-plugins/src/xss-plugin.test.ts; this file shows that they reach apps/web/src/. If a rule is turned
// off, or its `files` stop reaching apps/web/src/, its disable comment is unused and `vp check` fails
// (reportUnusedDisableDirectives). Knip skips __fixtures__/, and nothing imports this file.

// oxlint-disable-next-line web-xss/no-html-injection -- fixture: a string inserted as HTML
export const html = <div dangerouslySetInnerHTML={{ __html: "<b>fixture</b>" }} />;

// oxlint-disable-next-line web-xss/no-javascript-url -- fixture: a URL that runs script when followed
export const href = "javascript:void(0)";

// oxlint-disable-next-line web-xss/no-dynamic-code -- fixture: a string run as code
export const evaluated: unknown = eval("1");

// The comment on the next line is the one that is reported: it disables a rule and gives no reason. It disables
// no-console for the line after it, so the directive is used.
// oxlint-disable-next-line web-xss/require-disable-reason -- fixture: the next comment has no reason
// oxlint-disable-next-line no-console
console.log("a disable comment without a reason");

// A disable comment without rule names disables every rule of its line. Both rules report it, and this
// one has no reason either.
// oxlint-disable-next-line unicorn/no-abusive-eslint-disable, web-xss/require-disable-reason -- fixture: a blanket disable
// eslint-disable-next-line
console.log("a blanket disable comment");
