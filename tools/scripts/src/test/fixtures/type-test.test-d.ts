// Detection-power fixture (#436) for the type tests (*.test-d.ts, read by the typecheck of Vitest, docs/adr/0020): the
// tests overrides in the root vite.config.ts must reach them as they reach *.test.ts. Each test below is what a rule
// must report. If a rule is turned off, or its `files` stop reaching *.test-d.ts, its disable comment is unused and
// `vp check` fails (reportUnusedDisableDirectives). Vitest, coverage and Stryker skip fixtures/.
import { expectTypeOf, it } from "vite-plus/test";

// oxlint-disable-next-line vitest/expect-expect -- fixture: a type test with no assertion
it("何も表明しないこと", () => {
  JSON.parse("{}");
});

// oxlint-disable-next-line vitest/no-disabled-tests -- fixture: .skip hides a failing type test
it.skip("飛ばされること", () => {
  expectTypeOf<string>().toBeString();
});

// oxlint-disable-next-line test-title/japanese-title -- fixture: the title is not Japanese
it("not Japanese", () => {
  expectTypeOf<string>().toBeString();
});
