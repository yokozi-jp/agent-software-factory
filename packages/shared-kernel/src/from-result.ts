import { Effect } from "effect";
import type { Result } from "./result.ts";

// Turns the Result that domain returns into an Effect, for application (docs/adr/0028). Effect 4's own
// Effect.fromResult takes Effect's Result, not this one. The error keeps its _tag, so catchTag handles it.
export const fromResult = <T, E>(result: Result<T, E>): Effect.Effect<T, E> =>
  result._tag === "Ok" ? Effect.succeed(result.value) : Effect.fail(result.error);
