// Detection-power fixture (#43) for the entry `tenant-db` of shared-kernel (root vite.config.ts, sharedKernelEntries, docs/adr/0051): the entry imports
// only the libraries it is listed for. Each import below is one that no-restricted-imports must report. If the rule is turned off, or its
// `files` stop reaching this directory, the disable comments are unused and `vp check` fails (reportUnusedDisableDirectives).
// Knip and jscpd skip __fixtures__/, and nothing imports this file.
// oxlint-disable-next-line no-restricted-imports -- fixture: `tenant-db` does not import hono
import "hono";
// oxlint-disable-next-line no-restricted-imports -- fixture: `tenant-db` does not import zod
import "zod";
