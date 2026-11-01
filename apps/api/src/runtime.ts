import { Database } from "@agent-software-factory/shared-kernel/tenant-db";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { Kysely } from "kysely";

/**
 * The `ManagedRuntime` of the api: one per process, made by the entry file at the start and disposed at the stop
 * (docs/adr/0028). Its layer only wraps the pool of `app_user` that the entry made (`createDatabase` of
 * @agent-software-factory/db/node); the module's `Tx` picks the role of a transaction (docs/adr/0029). A route runs its use
 * case with `runtime.runPromise`.
 */
export type ApiRuntime = ManagedRuntime.ManagedRuntime<Database, never>;

export const createApiRuntime = (db: Kysely<never>): ApiRuntime =>
  ManagedRuntime.make(Database.layer(db));

/**
 * The runtime for code that builds the app without a database: the generation of the spec (`openapi.ts`) and the tests of
 * routes that do not use it. The layer is built on the first run only, so a route that never runs an effect answers as
 * usual; a run dies with a message that says the database is missing.
 */
export const runtimeWithoutDatabase = (): ApiRuntime =>
  ManagedRuntime.make(
    Layer.effect(
      Database,
      Effect.die(
        new Error(
          "This runtime has no database: the entry file passes createApiRuntime to createApp.",
        ),
      ),
    ),
  );
