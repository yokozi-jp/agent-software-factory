// Detection-power fixture (#43) for import/no-cycle (root vite.config.ts, docs/adr/0026): cycle-a.ts and
// cycle-b.ts import each other, and the rule reports the import in each. If the rule is turned off, or the
// `files` of its override stop reaching packages/*/src, the disable comments are unused and `vp check` fails
// (reportUnusedDisableDirectives). Knip and jscpd skip __fixtures__/, and nothing else imports these files.
// oxlint-disable-next-line import/no-cycle -- fixture: cycle-b.ts imports this file back
import { fromB } from "./cycle-b.ts";

export const fromA: string = `a${fromB}`;
