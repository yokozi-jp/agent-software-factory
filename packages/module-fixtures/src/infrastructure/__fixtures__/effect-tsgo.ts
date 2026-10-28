// Detection-power fixture (#43) for the rules of effect-tsgo (oxlint.effect.json, docs/adr/0028). Each line
// below is one that the rule must report. If the rule is turned off, the disable comments are unused and
// `effect-tsgo oxlint` fails (reportUnusedDisableDirectives). `vp lint` skips this file (vite.config.ts), as it
// does not load the plugin. The rule outdated-api cannot be tested here (docs/tooling/effect-lint.md).
import { Effect, Schema } from "effect";

// oxlint-disable-next-line effecttsgo/floating-effect -- fixture: an Effect that is never run
Effect.succeed(1);

// oxlint-disable-next-line effecttsgo/unstable-api-usage -- fixture: @stability unstable
export const withErrorReporting = Effect.withErrorReporting;

// oxlint-disable-next-line effecttsgo/experimental-api-usage -- fixture: @stability experimental
export const domainName = Schema.DomainName;
