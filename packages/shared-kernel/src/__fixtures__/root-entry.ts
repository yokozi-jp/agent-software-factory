// Detection-power fixture (#43) for the entry `.` of shared-kernel (root vite.config.ts, sharedKernelEntries, docs/adr/0051):
// the contract imports zod and no other library of the entries. Each import below is one that no-restricted-imports must
// report. If the rule is turned off, or its `files` stop reaching this file, the disable comments are unused and
// `vp check` fails (reportUnusedDisableDirectives). Knip and jscpd skip __fixtures__/, and nothing imports this file.
// oxlint-disable-next-line no-restricted-imports -- fixture: `.` does not import Effect
import "effect";
// oxlint-disable-next-line no-restricted-imports -- fixture: `.` does not import Kysely
import "kysely";
// oxlint-disable-next-line no-restricted-imports -- fixture: `.` does not import Hono, or a subpath of it
import "hono/client";
// The one import that `.` may have. It carries no disable comment, so `vp check` fails if the rule stops it.
import "zod";
