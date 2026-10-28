// Detection-power fixture (#230) for no-console in apps/web/src (root vite.config.ts,
// docs/logging/frontend.md). If the rule is turned off, or its `files` stop reaching apps/web/src/, the disable
// comment is unused and `vp check` fails (reportUnusedDisableDirectives). Knip skips __fixtures__/, and nothing
// imports this file.

// oxlint-disable-next-line no-console -- fixture: the frontend logs nothing to the browser console
console.log("fixture");
