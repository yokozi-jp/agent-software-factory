// Detection-power fixture (#43) for the layers of the modules (root vite.config.ts, docs/adr/0026).
// Each import below is one that no-restricted-imports must report in infrastructure/. If the rule is turned off,
// or its `files` stop reaching packages/*/src/infrastructure/, the disable comments are unused and
// `vp check` fails (reportUnusedDisableDirectives). Knip and jscpd skip __fixtures__/. Only the
// fixtures of the other layers import this file, to break the rule.
// oxlint-disable-next-line no-restricted-imports, import/no-cycle -- fixture: infrastructure does not import http; the two import each other
import "../../http/__fixtures__/boundaries.ts";
