// Detection-power fixture (#230) for the exclusion of the tests of packages/*/src from the runtime restrictions
// (root vite.config.ts, docs/adr/0007). A test may use a runtime global and a Node.js module, so the lines below carry
// no disable comment: if the override of the tests stops reaching this file, Oxlint reports them and `vp check`
// fails. The only comments are the @ts-expect-error of the type checker, as the package has no Node.js types. The
// file is named *.test.ts so that the override reaches it; Vitest (the `test` script) and Knip skip __fixtures__/.
// @ts-expect-error -- fixture: the package has no Node.js types
export const bare: unknown = process;
// @ts-expect-error -- fixture: the package has no Node.js types
export const viaGlobalThis: unknown = globalThis.process;
// @ts-expect-error -- fixture: the package has no Node.js types
import "node:fs";
