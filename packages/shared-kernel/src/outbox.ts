import { Effect, Option } from "effect";
import { sql, type Insertable } from "kysely";
import { z } from "zod";

import { createdColumns, CurrentWrite } from "./common-columns.ts";
import { dbCall } from "./db-call.ts";
import { insertRow } from "./insert-row.ts";
import type { MessagingOutbox } from "./messaging.gen.ts";
import type { ModuleTx } from "./tenant-transaction.ts";

/**
 * What every event has (`defineEvent`, docs/adr/0046): the `id` (the key of the receiver's `processed_message`), the
 * `tenantId`, the `kind`, the `version` and the moment it happened. The items of the kind follow and are kept as they
 * are; their shape is the job of the sending module's schema.
 */
const outboxEvent = z.looseObject({
  id: z.uuid(),
  tenantId: z.uuid(),
  kind: z.string().min(1),
  version: z.int().min(1),
  occurredAt: z.iso.datetime({ precision: 3 }),
});

/** An event that `enqueueOutbox` writes: a message that `defineEvent` of the sending module parsed. */
export type OutboxEvent = z.infer<typeof outboxEvent>;

// The traceparent of the W3C Trace Context: version, trace id (32 hex digits), parent span id (16) and flags. An id that
// is not hex of that length (a span of another tracer) or is all zeros is not a valid traceparent.
const traceId = /^(?!0{32}$)[0-9a-f]{32}$/;
const spanId = /^(?!0{16}$)[0-9a-f]{16}$/;

/** The `traceparent` of the current span, or `null` when there is no span or its ids are not valid. */
const currentTraceparent = Effect.currentParentSpan.pipe(
  Effect.option,
  Effect.map(
    Option.match({
      onNone: () => null,
      onSome: (span) =>
        traceId.test(span.traceId) && spanId.test(span.spanId)
          ? `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`
          : null,
    }),
  ),
);

/**
 * Writes one row of `messaging.outbox` in the open transaction of the module `tx`, so the row commits or rolls back
 * with the business writes (docs/adr/0013, docs/adr/0029). The row takes the tenant of the transaction: the policy of
 * the table refuses the row of another tenant, which is a defect. A failure of the database is a defect (`dbCall`).
 *
 * The event must have the items that every event has (`defineEvent`); an event that lacks one is a defect, as it is a
 * bug of the sender. `publication_date` and the common columns take the moment of the transaction (`CurrentWrite`).
 * `traceparent` is taken from the current span, so the trace goes on to the receiver; without a span it is `NULL`.
 * The row waits for the relay (`outbox_relay`) to send it, which this does not do.
 */
export const enqueueOutbox = <K extends ModuleTx>(
  tx: K,
  event: OutboxEvent,
): Effect.Effect<void, never, K["Identifier"] | CurrentWrite> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.sync(() => outboxEvent.parse(event));
    const write = yield* CurrentWrite;
    const traceparent = yield* currentTraceparent;
    // Typed from the generated table, so a column that the migration changes stops here (docs/adr/0025).
    const row: Insertable<MessagingOutbox> = {
      tenant_id: parsed.tenantId,
      id: parsed.id,
      event_type: parsed.kind,
      event_version: parsed.version,
      serialized_event: JSON.stringify(event),
      traceparent,
      occurred_at: parsed.occurredAt,
      publication_date: write.at.toString(),
      ...createdColumns(write),
    };
    yield* dbCall(tx, (trx) => insertRow(trx, sql.table("messaging.outbox"), row));
  });
