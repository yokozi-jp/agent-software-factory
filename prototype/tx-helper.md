# 試作: トランザクションの共通の関数の形 (Issue #351)

捨てる試作で、main には入れない。問いは、業務の更新、Outbox の行、`processed_message` の行を 1 つのトランザクションに入れる関数を、ADR 0028 の範囲の Effect でどう書くか。

- 実行: `effect@4.0.6`、`kysely@0.29.7`、`pg`、`@testcontainers/postgresql`、`typescript@7` を `/tmp` に入れ、下のコードを `proto.ts` として `node proto.ts` で流す (Docker が要る)。
- 型の検査: `tsc --strict --module nodenext --noEmit`。最後の `@ts-expect-error` が、トランザクションなしで repository を呼ぶと型エラーになることを確かめる。
- `knip` が `.ts` を未使用として止めるので、コードは Markdown に入れている。

```ts
// PROTOTYPE (Issue #351): throwaway. Not production code. Wipe me.
//
// Question: what shape should a shared transaction function take in `packages/shared`, so that an application
// writes a business update, an Outbox row and a `processed_message` row in ONE transaction, in Effect 4,
// using only what ADR 0028 allows (Context.Service, Layer, acquireUseRelease, Data.TaggedError, no run* inside)?
//
// Run:  node proto.ts        (needs Docker: one real PostgreSQL via testcontainers)
// Check: npx tsc --noEmit

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Context, Data, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import pg from "pg";

// =====================================================================================================
// packages/shared (candidate)
// =====================================================================================================

/** The module whose tables a transaction writes (docs/adr/0029). */
export type ModuleName = "claim" | "approval" | "closing";
export interface TenantScope {
  readonly module: ModuleName;
  readonly tenantId: string;
}

/** The connection pool root. An entry point builds it once (ManagedRuntime, docs/adr/0028). */
export class Database extends Context.Service<Database, { readonly db: Kysely<unknown> }>()(
  "shared/Database",
) {
  static layer = (db: Kysely<unknown>) => Layer.succeed(Database, Database.of({ db }));
}

/** The open transaction. Only `inTenantTransaction` provides it, so no repository can run outside one. */
export class Tx extends Context.Service<Tx, Transaction<unknown>>()("shared/Tx") {}

/** The failures an application branches on (docs/adr/0028). Everything else is a defect. */
export class OptimisticLockConflict extends Data.TaggedError("OptimisticLockConflict")<{
  readonly table: string;
}> {}
export class UniqueViolation extends Data.TaggedError("UniqueViolation")<{
  readonly constraint: string;
}> {}

/** A Kysely call. A DB failure is a defect (orDie); the caller never sees it in the error type. */
export const dbCall = <A>(run: (trx: Transaction<unknown>) => Promise<A>) =>
  Effect.gen(function* () {
    const trx = yield* Tx;
    return yield* Effect.tryPromise(() => run(trx)).pipe(Effect.orDie);
  });

/** A Kysely call where a PostgreSQL unique violation (23505) is a typed failure. */
export const dbCallUnique = <A>(run: (trx: Transaction<unknown>) => Promise<A>) =>
  Effect.gen(function* () {
    const trx = yield* Tx;
    return yield* Effect.tryPromise({ try: () => run(trx), catch: (e) => e }).pipe(
      Effect.catch((e) =>
        isPgError(e, "23505")
          ? Effect.fail(new UniqueViolation({ constraint: e.constraint ?? "?" }))
          : Effect.die(e),
      ),
    );
  });

function isPgError(e: unknown, code: string): e is { code: string; constraint?: string } {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === code;
}

/**
 * Runs `work` in one transaction: begin, `set_config('app.current_tenant', …, true)`, work, then commit on
 * success and rollback on ANY other exit (typed failure, defect, interruption). Provides `Tx` to `work`.
 * Role switching (`SET LOCAL ROLE <module>_module`, Issue #268) goes right after the set_config.
 */
export const inTenantTransaction = <A, E, R>(scope: TenantScope, work: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const { db } = yield* Database;
      return yield* Effect.tryPromise(async () => {
        const trx = await db.startTransaction().execute();
        try {
          await sql`SELECT set_config('app.current_tenant', ${scope.tenantId}, true)`.execute(trx);
          return trx;
        } catch (error) {
          await trx.rollback().execute();
          throw error;
        }
      }).pipe(Effect.orDie);
    }),
    (trx) => work.pipe(Effect.provideService(Tx, trx)),
    (trx, exit) =>
      Effect.tryPromise(() =>
        Exit.isSuccess(exit) ? trx.commit().execute() : trx.rollback().execute(),
      ).pipe(Effect.orDie),
  );

/** Outbox: one row, same transaction as the business write (docs/adr/0029). */
export interface OutboxEvent {
  readonly type: string;
  readonly payload: unknown;
}
export const enqueueOutbox = Effect.fn("enqueueOutbox")(function* (
  scope: TenantScope,
  event: OutboxEvent,
) {
  yield* dbCall((trx) =>
    sql`INSERT INTO messaging.outbox (tenant_id, type, payload)
        VALUES (${scope.tenantId}, ${event.type}, ${JSON.stringify(event.payload)}::jsonb)`.execute(
      trx,
    ),
  );
});

/**
 * Receiving side: `processed_message` insert + the business work in the SAME transaction. If the row already
 * exists the work is not called. If the work fails, the row rolls back with everything else.
 */
export interface IncomingMessage {
  readonly tenantId: string;
  readonly messageId: string;
}
export type Received<A> =
  | { readonly _tag: "Processed"; readonly value: A }
  | { readonly _tag: "Duplicate" };

const receiveOnce = <A, E, R>(
  module: ModuleName,
  message: IncomingMessage,
  work: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const inserted = yield* dbCall((trx) =>
      sql<{ message_id: string }>`
          INSERT INTO ${sql.table(`${module}.processed_message`)} (tenant_id, message_id)
          VALUES (${message.tenantId}, ${message.messageId})
          ON CONFLICT DO NOTHING RETURNING message_id`.execute(trx),
    );
    if (inserted.rows.length === 0) return { _tag: "Duplicate" } as const;
    const value = yield* work;
    return { _tag: "Processed", value } as const;
  });

/**
 * The ONLY way to register a handler: dedup + transaction + tenant are built in, a module cannot forget them.
 * Returns a function an entry point (SQS handler) calls per message.
 */
export const defineConsumer =
  <M extends IncomingMessage, A, E, R>(
    module: ModuleName,
    handle: (message: M) => Effect.Effect<A, E, R>,
  ) =>
  (message: M) =>
    inTenantTransaction(
      { module, tenantId: message.tenantId },
      receiveOnce(module, message, handle(message)),
    );

// =====================================================================================================
// A module (claim): infrastructure + application (candidate usage)
// =====================================================================================================

// -- domain-ish failure the application also branches on
export class ClaimNotApprovable extends Data.TaggedError("ClaimNotApprovable")<{
  readonly id: number;
}> {}

// -- infrastructure: repository over Tx (module narrows the shared Tx to its own DB type; here: untyped sql)
export class ClaimRepository extends Context.Service<
  ClaimRepository,
  {
    create(
      scope: TenantScope,
      title: string,
    ): Effect.Effect<{ id: number; lockNo: number }, UniqueViolation, Tx>;
    rename(
      scope: TenantScope,
      id: number,
      title: string,
      expectedLockNo: number,
    ): Effect.Effect<void, OptimisticLockConflict, Tx>;
  }
>()("claim/ClaimRepository") {
  static layer = Layer.succeed(
    ClaimRepository,
    ClaimRepository.of({
      create: (scope, title) =>
        dbCallUnique((trx) =>
          sql<{ claim_id: number; lock_no: number }>`
              INSERT INTO claim.t_claim (tenant_id, title) VALUES (${scope.tenantId}, ${title})
              RETURNING claim_id, lock_no`.execute(trx),
        ).pipe(
          Effect.map((r) => ({ id: Number(r.rows[0]!.claim_id), lockNo: r.rows[0]!.lock_no })),
        ),
      rename: (scope, id, title, expectedLockNo) =>
        dbCall((trx) =>
          sql`UPDATE claim.t_claim SET title = ${title}, lock_no = lock_no + 1
                WHERE tenant_id = ${scope.tenantId} AND claim_id = ${id} AND lock_no = ${expectedLockNo}`.execute(
            trx,
          ),
        ).pipe(
          Effect.flatMap((r) =>
            Number(r.numAffectedRows ?? 0) === 0
              ? Effect.fail(new OptimisticLockConflict({ table: "claim.t_claim" }))
              : Effect.void,
          ),
        ),
    }),
  );
}

// -- application use cases: they read like business code, and know nothing about begin/commit
export const submitClaim = Effect.fn("submitClaim")(function* (
  scope: TenantScope,
  title: string,
  opts: { failAfterOutbox?: "typed" | "defect" } = {},
) {
  const claims = yield* ClaimRepository;
  const claim = yield* claims.create(scope, title);
  yield* enqueueOutbox(scope, { type: "ClaimSubmitted", payload: { claimId: claim.id } });
  if (opts.failAfterOutbox === "typed")
    return yield* Effect.fail(new ClaimNotApprovable({ id: claim.id }));
  if (opts.failAfterOutbox === "defect") return yield* Effect.die(new Error("boom"));
  return claim;
});
// the use case is wrapped once, at the application boundary:
export const submitClaimInTx = (
  scope: TenantScope,
  title: string,
  opts?: Parameters<typeof submitClaim>[2],
) => inTenantTransaction(scope, submitClaim(scope, title, opts));

// -- a consumer in `approval`: registered ONLY through defineConsumer
interface ClaimSubmitted extends IncomingMessage {
  readonly claimId: number;
}
export const onClaimSubmitted = (opts: { fail?: boolean; calls: string[] }) =>
  defineConsumer("approval", (m: ClaimSubmitted) =>
    Effect.gen(function* () {
      opts.calls.push(m.messageId);
      yield* dbCall((trx) =>
        sql`INSERT INTO approval.t_approval (tenant_id, claim_id) VALUES (${m.tenantId}, ${m.claimId})`.execute(
          trx,
        ),
      );
      if (opts.fail) return yield* Effect.fail(new ClaimNotApprovable({ id: m.claimId }));
      return "approved" as const;
    }),
  );

// =====================================================================================================
// Demo harness (throwaway)
// =====================================================================================================

const T1 = "00000000-0000-0000-0000-000000000001";

async function main() {
  const container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 });
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  try {
    await sql
      .raw(
        `CREATE SCHEMA claim; CREATE SCHEMA approval; CREATE SCHEMA messaging;
         CREATE TABLE claim.t_claim (tenant_id uuid NOT NULL, claim_id bigint GENERATED ALWAYS AS IDENTITY,
           title text NOT NULL, lock_no integer NOT NULL DEFAULT 1, PRIMARY KEY (tenant_id, claim_id));
         CREATE UNIQUE INDEX uq_claim_title ON claim.t_claim (tenant_id, title);
         CREATE TABLE messaging.outbox (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL,
           type text NOT NULL, payload jsonb NOT NULL);
         CREATE TABLE approval.t_approval (tenant_id uuid NOT NULL, claim_id bigint NOT NULL);
         CREATE TABLE approval.processed_message (tenant_id uuid NOT NULL, message_id text NOT NULL,
           PRIMARY KEY (tenant_id, message_id));
         CREATE TABLE claim.processed_message (tenant_id uuid NOT NULL, message_id text NOT NULL,
           PRIMARY KEY (tenant_id, message_id));`,
      )
      .execute(db);

    // one ManagedRuntime per entry point (docs/adr/0028)
    const runtime = ManagedRuntime.make(Layer.mergeAll(Database.layer(db), ClaimRepository.layer));
    const counts = async () => {
      const c = async (t: string) =>
        Number(
          (await sql<{ n: string }>`SELECT count(*)::text n FROM ${sql.table(t)}`.execute(db))
            .rows[0]!.n,
        );
      return {
        claims: await c("claim.t_claim"),
        outbox: await c("messaging.outbox"),
        approvals: await c("approval.t_approval"),
        processed: await c("approval.processed_message"),
      };
    };
    const show = async (label: string, result: unknown) =>
      console.log(
        `\n■ ${label}\n  result: ${JSON.stringify(result)}\n  rows:   ${JSON.stringify(await counts())}`,
      );
    const scope: TenantScope = { module: "claim", tenantId: T1 };

    // 1 happy path
    await show(
      "1. submit: claim + outbox commit together",
      await runtime.runPromiseExit(submitClaimInTx(scope, "A")).then(fmt),
    );

    // 2 typed failure AFTER the outbox row was written
    await show(
      "2. typed failure after outbox -> nothing remains",
      await runtime
        .runPromiseExit(submitClaimInTx(scope, "B", { failAfterOutbox: "typed" }))
        .then(fmt),
    );

    // 3 defect after the outbox row
    await show(
      "3. defect after outbox -> nothing remains",
      await runtime
        .runPromiseExit(submitClaimInTx(scope, "C", { failAfterOutbox: "defect" }))
        .then(fmt),
    );

    // 4 unique violation becomes a typed failure and can be caught by tag
    const r4 = await runtime.runPromise(
      submitClaimInTx(scope, "A").pipe(
        Effect.catchTag("UniqueViolation", (e) =>
          Effect.succeed(`caught ${e._tag}: ${e.constraint}`),
        ),
      ),
    );
    await show("4. duplicate title -> typed UniqueViolation (catchTag works, no defect)", r4);

    // 5 optimistic lock: 2nd update with the stale lock_no
    const upd = (lockNo: number) =>
      inTenantTransaction(
        scope,
        Effect.gen(function* () {
          const claims = yield* ClaimRepository;
          yield* claims.rename(scope, 1, "A2", lockNo);
        }),
      );
    const first = await runtime.runPromiseExit(upd(1)).then(fmt);
    const second = await runtime.runPromise(
      upd(1).pipe(
        Effect.catchTag("OptimisticLockConflict", () =>
          Effect.succeed("409 OptimisticLockConflict"),
        ),
      ),
    );
    await show("5. optimistic lock: 1st ok, stale 2nd -> typed conflict (409)", { first, second });

    // 6 consumer: delivered twice
    const calls: string[] = [];
    const consume = onClaimSubmitted({ calls });
    const msg = { tenantId: T1, messageId: "m-1", claimId: 1 };
    const d1 = await runtime.runPromise(consume(msg));
    const d2 = await runtime.runPromise(consume(msg));
    await show("6. same message twice -> 2nd is Duplicate, handler called once", {
      d1,
      d2,
      handlerCalls: calls.length,
    });

    // 7 consumer fails -> processed_message must not stay, redelivery works
    const calls7: string[] = [];
    const msg7 = { tenantId: T1, messageId: "m-2", claimId: 1 };
    const f = await runtime
      .runPromiseExit(onClaimSubmitted({ calls: calls7, fail: true })(msg7))
      .then(fmt);
    const redo = await runtime.runPromise(onClaimSubmitted({ calls: calls7 })(msg7));
    await show("7. handler fails -> no processed_message left; redelivery is Processed", {
      f,
      redo,
      handlerCalls: calls7.length,
    });

    // 8 two copies at once: the 2nd waits on the unique key, then sees the row
    const calls8: string[] = [];
    const msg8 = { tenantId: T1, messageId: "m-3", claimId: 1 };
    const both = await runtime.runPromise(
      Effect.all(
        [onClaimSubmitted({ calls: calls8 })(msg8), onClaimSubmitted({ calls: calls8 })(msg8)],
        { concurrency: 2 },
      ),
    );
    await show("8. same message, two concurrent consumers -> exactly one Processed", {
      both: both.map((b) => b._tag),
      handlerCalls: calls8.length,
    });

    // 9 interruption while the transaction is open -> rollback
    const slow = inTenantTransaction(
      scope,
      Effect.gen(function* () {
        const claims = yield* ClaimRepository;
        yield* claims.create(scope, "SLOW");
        yield* Effect.sleep("5 seconds");
      }),
    );
    const r9 = await runtime.runPromiseExit(slow.pipe(Effect.timeout("300 millis"))).then(fmt);
    await show("9. timeout/interrupt mid-transaction -> rollback", r9);

    // 10 transactions left open? (a leaked transaction would show as "idle in transaction")
    const idle = await sql<{
      n: string;
    }>`SELECT count(*)::text n FROM pg_stat_activity WHERE state = 'idle in transaction'`.execute(
      db,
    );
    console.log(`\n■ 10. connections left "idle in transaction": ${idle.rows[0]!.n}`);

    await runtime.dispose();
  } finally {
    await db.destroy();
    await container.stop();
  }
}

function fmt(exit: Exit.Exit<unknown, unknown>) {
  if (Exit.isSuccess(exit)) return { ok: exit.value };
  const cause = exit.cause as unknown as {
    reasons?: ReadonlyArray<{ _tag: string; error?: { _tag?: string }; defect?: unknown }>;
  };
  return {
    failed:
      cause.reasons?.map((r) =>
        r._tag === "Fail" ? `Fail(${r.error?._tag})` : r._tag === "Die" ? "Die" : r._tag,
      ) ?? "?",
  };
}

// 11 type level, never run: a repository call without a transaction must not compile.
export function neverCalled(
  runtime: ManagedRuntime.ManagedRuntime<Database | ClaimRepository, never>,
) {
  // @ts-expect-error ClaimRepository.create needs Tx; nobody provided it
  return runtime.runPromise(
    ClaimRepository.use((c) => c.create({ module: "claim", tenantId: T1 }, "X")),
  );
}

await main();
```
