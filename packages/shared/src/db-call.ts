import { Data, Effect } from "effect";

import type { ModuleTx } from "./tenant-transaction.ts";

/** A PostgreSQL unique violation (23505), with the name of the constraint. The module's repository maps it to a business failure. */
export class UniqueViolation extends Data.TaggedError("UniqueViolation")<{
  readonly constraint: string;
}> {}

/**
 * A Kysely call in the open transaction of the module `tx`. A failure of the database is a defect, so it does not show
 * in the error type (docs/adr/0028).
 */
export const dbCall = <K extends ModuleTx, A>(
  tx: K,
  run: (trx: K["Service"]) => Promise<A>,
): Effect.Effect<A, never, K["Identifier"]> =>
  Effect.gen(function* () {
    const trx = yield* tx;
    // A rejection of the promise is a defect, with the error of the driver as it is (Effect.promise).
    return yield* Effect.promise(() => run(trx));
  });

const uniqueViolationOf = (error: unknown): UniqueViolation | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  if (!("code" in error) || error.code !== "23505") return undefined;
  const constraint = "constraint" in error ? error.constraint : undefined;
  return new UniqueViolation({ constraint: typeof constraint === "string" ? constraint : "" });
};

/**
 * Like `dbCall`, where a unique violation (23505) is the typed failure `UniqueViolation`. Any other failure of the
 * database is a defect. The module's repository reads the constraint name and fails with its own business failure
 * (`catchTag`).
 */
export const dbCallUnique = <K extends ModuleTx, A>(
  tx: K,
  run: (trx: K["Service"]) => Promise<A>,
): Effect.Effect<A, UniqueViolation, K["Identifier"]> =>
  Effect.gen(function* () {
    const trx = yield* tx;
    return yield* Effect.tryPromise({ try: () => run(trx), catch: (error) => error }).pipe(
      Effect.catch((error) => {
        const violation = uniqueViolationOf(error);
        return violation === undefined ? Effect.die(error) : Effect.fail(violation);
      }),
    );
  });
