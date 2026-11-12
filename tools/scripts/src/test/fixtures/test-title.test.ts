// Detection-power fixture (#230) for test-title/japanese-title in the tests of tools/ and packages/ (the test-title
// override in the root vite.config.ts; the rule is in tools/lint-plugins/src/test-title-plugin.ts, docs/adr/0030).
// The file is named *.test.ts so that the rule reaches it; Vitest, coverage and Stryker skip fixtures/. If the rule
// is turned off, or its `files` stop reaching *.test.ts, the disable comment is unused and `vp check` fails
// (reportUnusedDisableDirectives).
import { expect, it } from "vite-plus/test";

// oxlint-disable-next-line test-title/japanese-title -- fixture: the title has no Japanese character
it("has an English title", () => {
  expect(1 + 1).toBe(2);
});
