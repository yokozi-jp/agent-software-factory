// Detection-power fixture (#230) for the rules that stop a test from running a subset or being hidden (the tests
// override in the root vite.config.ts). Each test below is what a rule must report. If a rule is turned off, or
// its `files` stop reaching *.test.ts, its disable comment is unused and `vp check` fails
// (reportUnusedDisableDirectives). The file is named *.test.ts so the rules reach it; Vitest, coverage and
// Stryker skip fixtures/.
import { expect, it } from "vite-plus/test";

// oxlint-disable-next-line vitest/no-focused-tests -- fixture: .only runs this test alone
it.only("is the only test that runs", () => {
  expect(1).toBe(1);
});

// oxlint-disable-next-line vitest/no-disabled-tests -- fixture: .skip hides a test that may be failing
it.skip("is hidden", () => {
  expect(1).toBe(1);
});
