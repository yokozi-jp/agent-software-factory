import { Effect } from "effect";
import { sql, type ColumnType, type Insertable } from "kysely";
import type { z } from "zod";

import { createdColumns, CurrentWrite, type WriteActor } from "./common-columns.ts";
import { dbCall } from "./db-call.ts";
import { insertRow } from "./insert-row.ts";
import {
  inTenantTransaction,
  type Database,
  type ModuleName,
  type ModuleTx,
} from "./tenant-transaction.ts";

/** What a consumer needs of a message: the `id` (the key of `processed_message`) and the `tenantId`. */
export interface ConsumedMessage {
  readonly id: string;
  readonly tenantId: string;
}

/**
 * The result of a consumer. `Processed` carries what `handle` returned. `Duplicate` means the message was processed
 * before: `handle` was not called and nothing was written.
 */
export type ConsumeResult<A> =
  | { readonly _tag: "Processed"; readonly value: A }
  | { readonly _tag: "Duplicate" };

type Instant = ColumnType<Temporal.Instant, string, string>;

/**
 * `processed_message` of a module's schema, with the columns that `defineConsumer` writes (the template is
 * packages/db/templates/processed_message.sql). It is written here by hand: the generated types of a module are
 * not visible to shared-kernel (docs/adr/0026), and the table is the same in every module.
 */
interface ProcessedMessageTable {
  tenant_id: string;
  message_id: string;
  created_at: Instant;
  created_by: string;
  created_pgm_cd: string;
  created_tx_id: string;
  updated_at: Instant;
  updated_by: string;
  updated_pgm_cd: string;
  updated_tx_id: string;
}

/** A consumer as the registry lists it: the message is `unknown`, which the consumer parses. */
export interface RegisteredConsumer {
  /** The name that the consumer registered with; the tests of the module give its example messages by it. */
  readonly name: string;
  readonly module: ModuleName;
  readonly consume: (
    message: unknown,
    write: WriteActor,
  ) => Effect.Effect<ConsumeResult<unknown>, unknown, Database>;
}

const registry = new Map<string, RegisteredConsumer>();

/**
 * Every consumer registered so far, in the order of registration. Importing a module registers its consumers, so
 * the all-consumers test imports the modules first (apps/api/src/db/consumers.test.ts).
 */
export const registeredConsumers = (): readonly RegisteredConsumer[] => [...registry.values()];

/**
 * The one way to register a handler of a message from another module (docs/adr/0029): it removes the duplicates, so
 * the handler runs once per message even though the delivery is at least once (docs/async/qos.md).
 *
 * `consume` parses the message with `schema` (a message that does not parse is a defect: it can never succeed, so it
 * goes on to the DLQ). It then runs in one transaction of the module `tx` with the tenant of the message
 * (`inTenantTransaction`). In that transaction it first runs `INSERT … ON CONFLICT DO NOTHING RETURNING` on the
 * module's `processed_message` with the key `(tenantId, id)`:
 *
 * - If the row went in, it calls `handle` and returns `{ _tag: "Processed", value }`.
 * - If the row was there, it does not call `handle` and returns `{ _tag: "Duplicate" }`.
 *
 * If `handle` fails, the transaction rolls back, and the row of `processed_message` goes with it, so the next delivery
 * is processed again. Two deliveries at the same time wait for each other on the row: the one that comes second sees
 * the commit and returns `Duplicate`, or the rollback and processes the message.
 *
 * `write` gives the actor, the program code and the id of the call for the common columns; the entry file of the
 * consumer decides them. `name` must be unique: registering a name twice throws.
 */
export function defineConsumer<
  K extends ModuleTx,
  S extends z.ZodType<ConsumedMessage>,
  A,
  E,
>(definition: {
  readonly tx: K;
  readonly name: string;
  readonly schema: S;
  readonly handle: (message: z.output<S>) => Effect.Effect<A, E, K["Identifier"] | CurrentWrite>;
}) {
  const { tx, name, schema, handle } = definition;
  if (registry.has(name)) throw new Error(`The consumer is already registered: ${name}`);

  const consume = (
    message: unknown,
    write: WriteActor,
  ): Effect.Effect<ConsumeResult<A>, E, Database> =>
    Effect.gen(function* () {
      const parsed = yield* Effect.sync(() => schema.parse(message));
      return yield* inTenantTransaction(
        tx,
        { tenantId: parsed.tenantId, ...write },
        Effect.gen(function* () {
          const current = yield* CurrentWrite;
          const row: Insertable<ProcessedMessageTable> = {
            tenant_id: parsed.tenantId,
            message_id: parsed.id,
            ...createdColumns(current),
          };
          const inserted = yield* dbCall(tx, (trx) =>
            insertRow(
              trx,
              // The module name is one of `ModuleName`; it is quoted as an identifier all the same.
              sql.id(tx.module, "processed_message"),
              row,
              sql`ON CONFLICT (tenant_id, message_id) DO NOTHING RETURNING message_id`,
            ),
          );
          if (inserted.rows.length === 0) return { _tag: "Duplicate" } as const;
          const value = yield* handle(parsed);
          return { _tag: "Processed", value } as const;
        }),
      );
    });

  registry.set(name, { name, module: tx.module, consume });
  return { name, module: tx.module, consume } as const;
}
