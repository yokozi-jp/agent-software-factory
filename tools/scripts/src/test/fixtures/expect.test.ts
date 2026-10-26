// Detection-power fixture (#138) for the rules that stop a test from passing without checking anything (the
// tests override in the root vite.config.ts). Each test below is what a rule must report. If a rule is turned
// off, or its `files` stop reaching *.test.ts, its disable comment is unused and `vp check` fails
// (reportUnusedDisableDirectives). The file is named *.test.ts so the rules reach it; Vitest, coverage and
// Stryker skip fixtures/.
import { expect, it } from "vite-plus/test";

// oxlint-disable-next-line vitest/expect-expect -- fixture: a test with no expect
it("checks nothing", () => {
  JSON.parse("{}");
});

it("checks only on one branch", () => {
  const value = JSON.parse("1") === 1;
  expect(typeof value).toBe("boolean");
  // oxlint-disable-next-line vitest/no-conditional-expect -- fixture: an expect that may not run
  if (value) expect(value).toBe(true);
});

it("asserts nothing with its expect", () => {
  // oxlint-disable-next-line vitest/valid-expect -- fixture: an expect without a matcher
  expect(JSON.parse("1"));
});
