// Detection-power fixture (#230) for the exclusion of the tests of application/ from the rule that stops an Effect
// from being run there (root vite.config.ts, docs/adr/0028). A test may run an Effect, so the line below carries no
// disable comment: if the override of the tests stops reaching this file, Oxlint reports it and `vp check` fails.
// The rule matches the name of the property, so a local type stands for the runtime, and the file does not import
// effect (Knip reads a *.test.ts file even in __fixtures__/, and would count the dependency as used). The file is
// named *.test.ts so that the override reaches it; Knip and jscpd skip __fixtures__/.
type Runtime = { runPromise: (effect: unknown) => unknown };
export const runRuntime = (runtime: Runtime) => runtime.runPromise(1);
