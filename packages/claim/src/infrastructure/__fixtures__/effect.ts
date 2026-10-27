// Detection-power fixture (#43) for the Effect rules of vite.config.ts (docs/adr/0028). Each line below is
// one that the rule must report. If the rule is turned off, or its `files` stop reaching this directory, the
// disable comments are unused and `vp check` fails (reportUnusedDisableDirectives). The rules of effect-tsgo
// are in effect-tsgo.ts. Knip and jscpd skip __fixtures__/.
import { Effect } from "effect";
// @ts-expect-error -- fixture: the module does not depend on @effect/sql-pg, so the import does not resolve
// oxlint-disable-next-line no-restricted-imports -- fixture: @effect/sql* is not used
import "@effect/sql-pg";
// oxlint-disable-next-line no-restricted-imports -- fixture: effect/Stream is not used
import "effect/Stream";
// oxlint-disable-next-line no-restricted-imports -- fixture: effect/http is an unstable module
import "effect/http";

// oxlint-disable-next-line no-restricted-imports -- fixture: Schema is not used (validation is zod)
export { Schema } from "effect";

// oxlint-disable-next-line no-restricted-properties -- fixture: application and infrastructure never run an Effect
export const run = () => Effect.runPromise(Effect.succeed(1));
type Runtime = { runPromise: (effect: Effect.Effect<number>) => unknown };
// oxlint-disable-next-line no-restricted-properties -- fixture: matched by property, whatever holds the runtime
export const runRuntime = (runtime: Runtime) => runtime.runPromise(Effect.succeed(1));
// oxlint-disable-next-line no-restricted-imports -- fixture: a run function imported by name is not called as a property
export { runPromise } from "effect/Effect";
