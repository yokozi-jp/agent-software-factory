// Detection-power fixture (#230) for the rules of the *.test.tsx files: test-title/japanese-title in
// apps/*/src/**/*.test.tsx, and vitest/no-focused-tests in **/*.test.tsx (root vite.config.ts). The *.test.ts
// files have their own globs, shown by apps/api/src/__fixtures__/ and tools/scripts/src/test/fixtures/. If a
// rule is turned off, or its `files` stop reaching *.test.tsx, the disable comment is unused and `vp check` fails
// (reportUnusedDisableDirectives). Vitest (apps/web/vite.config.ts) and Knip skip __fixtures__/.
import { expect, it } from "vite-plus/test";

// oxlint-disable-next-line test-title/japanese-title -- fixture: the title has no Japanese character
it("has an English title", () => {
  expect(1 + 1).toBe(2);
});

// oxlint-disable-next-line vitest/no-focused-tests -- fixture: .only runs this test alone
it.only("ただ 1 つ実行されること", () => {
  expect(1).toBe(1);
});
