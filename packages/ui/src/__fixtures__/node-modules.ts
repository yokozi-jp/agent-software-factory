// Detection-power fixture (#43) that import/no-nodejs-modules of the root vite.config.ts reaches packages/ui/src/
// (docs/adr/0034). The parts run in the browser and import no Node.js module. If the rule is turned off, or its
// `files` stop reaching packages/ui/src/, the disable comment is unused and `vp check` fails
// (reportUnusedDisableDirectives). Knip skips __fixtures__/, and nothing imports this file.

// @ts-expect-error -- fixture: the package has no Node.js types
// oxlint-disable-next-line import/no-nodejs-modules -- fixture: a Node.js module in a browser part
import "node:fs";
