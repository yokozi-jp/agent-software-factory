// Detection-power fixture (#43) for the layers of closing (root vite.config.ts, docs/adr/0026).
// Each import below is one that no-restricted-imports must report in application/. If the rule is turned off,
// or its `files` stop reaching packages/closing/src/application/, the disable comments are unused and
// `vp check` fails (reportUnusedDisableDirectives). Knip and jscpd skip __fixtures__/. Only the
// fixtures of the other layers import this file, to break the rule.
// oxlint-disable-next-line no-restricted-imports -- fixture: application imports domain only
import "../../infrastructure/__fixtures__/boundaries.ts";
// oxlint-disable-next-line no-restricted-imports -- fixture: application imports domain only
import "../../http/__fixtures__/boundaries.ts";
