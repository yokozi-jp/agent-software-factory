// Detection-power fixture (#327) for the ban on pino (docs/adr/0049, root vite.config.ts). Outside
// packages/logging/src/node.ts, the entry files and the tests, code depends on the `Logger` interface of
// @agent-software-factory/logging. Each line below is one that no-restricted-imports must report. If the rule is turned off, or
// its `files` stop reaching this directory, the disable comment is unused and `vp check` fails (reportUnusedDisableDirectives).
// repo-policy checks that this file has the line. Knip skips __fixtures__/, and nothing imports this file.
// @ts-expect-error -- fixture: not a dependency of this package, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: the logger library
import "pino";
