import {
  processedMessageTableSql,
  diffRowCounts,
  snapshotRowCounts,
} from "@agent-software-factory/db/testing";
import type { TestDatabase } from "@agent-software-factory/db/testing";
import {
  type ConsumeResult,
  type RegisteredConsumer,
} from "@agent-software-factory/shared-kernel/messaging";
import { type Database, type WriteActor } from "@agent-software-factory/shared-kernel/tenant-db";
import type { Effect } from "effect";

/**
 * Runs every consumer in `consumers` with its example message twice, and returns what is wrong (an empty list means
 * every consumer removes the duplicates, docs/adr/0029). Each module's test gives an example by the `name` that the
 * consumer registered with. The check fails when:
 *
 * - a consumer has no example (a new consumer must come with one),
 * - an example has no consumer (it is left over from a consumer that is gone),
 * - the first delivery is not `Processed`,
 * - the second delivery of the same message is not `Duplicate`, or it changes a row of any table.
 *
 * `run` runs an effect on the database of the test. The table `processed_message` is made in the schema of a module
 * that does not have it yet, from the template of the migration, so this check works before the module's migration
 * is written; once the module has the table, it is left as it is.
 */
export async function consumerProblems(options: {
  readonly consumers: readonly RegisteredConsumer[];
  readonly examples: Readonly<Record<string, unknown>>;
  readonly db: TestDatabase;
  readonly write: WriteActor;
  readonly run: <A, E>(effect: Effect.Effect<A, E, Database>) => Promise<A>;
}): Promise<string[]> {
  const { consumers, examples, db, write, run } = options;
  const problems: string[] = [];
  const names = new Set(consumers.map((consumer) => consumer.name));
  for (const name of Object.keys(examples))
    if (!names.has(name)) problems.push(`${name}: the example has no registered consumer`);

  for (const consumer of consumers) {
    if (!Object.hasOwn(examples, consumer.name)) {
      problems.push(`${consumer.name}: no example message (add one to the examples of the test)`);
      continue;
    }
    const message = examples[consumer.name];
    const { rows } = await db.superuser.query<{ table: string | null }>(
      `SELECT to_regclass('${consumer.module}.processed_message')::text AS "table"`,
    );
    if (rows[0]?.table === null) await db.migrator.query(processedMessageTableSql(consumer.module));

    const first: ConsumeResult<unknown> = await run(consumer.consume(message, write));
    if (first._tag !== "Processed") {
      problems.push(`${consumer.name}: the first delivery is ${first._tag}, not Processed`);
      continue;
    }
    const before = await snapshotRowCounts(db.superuser);
    const second: ConsumeResult<unknown> = await run(consumer.consume(message, write));
    const changed = diffRowCounts(before, await snapshotRowCounts(db.superuser));
    if (second._tag !== "Duplicate")
      problems.push(`${consumer.name}: the second delivery is ${second._tag}, not Duplicate`);
    if (Object.keys(changed).length > 0)
      problems.push(
        `${consumer.name}: the second delivery changed rows: ${JSON.stringify(changed)}`,
      );
  }
  return problems;
}
