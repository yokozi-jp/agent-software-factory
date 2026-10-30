import { ClaimTx } from "@agent-software-factory/claim";
import {
  createdColumns,
  CurrentWrite,
  dbCall,
  inTenantTransaction,
  OptimisticLockConflict,
  patchedColumns,
  RowNotFound,
  updatedColumns,
  updateWithLock,
} from "@agent-software-factory/shared";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vite-plus/test";

import { useDatabase } from "../../test/use-database.ts";

// 共通カラムの値の入れ方と楽観排他 (docs/db/postgresql-keys.md、docs/db/postgresql-concurrency.md)。
// 時刻はトランザクションの開始時に 1 回取る。テストは TestClock で時刻を決め、バインドした値になることを確かめる。
const tenantA = "00000000-0000-4000-8000-00000000000a";
const tenantB = "00000000-0000-4000-8000-00000000000b";

const creator = { actor: "creator", pgmCd: "claim.create", txId: "tx-create" };
const updater = { actor: "updater", pgmCd: "claim.update", txId: "tx-update" };
const patcher = { actor: "patcher", pgmCd: "claim.patch", txId: "tx-patch" };

const createdAt = Temporal.Instant.from("2026-10-29T01:00:00Z");
const updatedAt = Temporal.Instant.from("2026-10-29T02:00:00Z");
const patchedAt = Temporal.Instant.from("2026-10-29T03:00:00Z");

interface ClaimRow {
  lock_no: number;
  created_at: Date;
  created_by: string;
  created_pgm_cd: string;
  created_tx_id: string;
  updated_at: Date;
  updated_by: string;
  updated_pgm_cd: string;
  updated_tx_id: string;
  patched_at: Date | null;
  patched_by: string | null;
  patched_id: string | null;
}

describe("共通カラムの値と楽観排他", () => {
  const ctx = useDatabase();
  const { run } = ctx;

  /** TestClock を `instant` に合わせて流す。トランザクションの開始時に読む時刻が、この値になる。 */
  const at = <A, E, R>(instant: Temporal.Instant, effect: Effect.Effect<A, E, R>) =>
    TestClock.setTime(instant.epochMilliseconds).pipe(
      Effect.andThen(effect),
      Effect.provide(TestClock.layer()),
    );

  const insertClaim = (tenantId: string) =>
    at(
      createdAt,
      inTenantTransaction(
        ClaimTx,
        { tenantId, ...creator },
        Effect.gen(function* () {
          const write = yield* CurrentWrite;
          return yield* dbCall(ClaimTx, (trx) =>
            trx
              .insertInto("claim.t_claim")
              .values({ tenant_id: tenantId, ...createdColumns(write) })
              .returning("claim_id")
              .executeTakeFirstOrThrow(),
          );
        }),
      ),
    );

  /** `lock_no` を条件にして更新する。0 行なら、行があるかで 409 と 404 を分ける。 */
  const updateClaim = (tenantId: string, claimId: string, lockNo: number) =>
    at(
      updatedAt,
      inTenantTransaction(
        ClaimTx,
        { tenantId, ...updater },
        Effect.gen(function* () {
          const write = yield* CurrentWrite;
          return yield* updateWithLock(ClaimTx, {
            update: (trx) =>
              trx
                .updateTable("claim.t_claim")
                .set(updatedColumns(write))
                .where("tenant_id", "=", tenantId)
                .where("claim_id", "=", claimId)
                .where("lock_no", "=", lockNo)
                .returning("lock_no")
                .executeTakeFirst(),
            exists: async (trx) =>
              (await trx
                .selectFrom("claim.t_claim")
                .select("claim_id")
                .where("tenant_id", "=", tenantId)
                .where("claim_id", "=", claimId)
                .executeTakeFirst()) !== undefined,
          });
        }),
      ),
    );

  const patchClaim = (tenantId: string, claimId: string) =>
    at(
      patchedAt,
      inTenantTransaction(
        ClaimTx,
        { tenantId, ...patcher },
        Effect.gen(function* () {
          const write = yield* CurrentWrite;
          return yield* dbCall(ClaimTx, (trx) =>
            trx
              .updateTable("claim.t_claim")
              .set(patchedColumns(write, "TICKET-42"))
              .where("tenant_id", "=", tenantId)
              .where("claim_id", "=", claimId)
              .execute(),
          );
        }),
      ),
    );

  /** 行をそのまま読む (superuser。RLS を通さない)。 */
  const readRow = async (claimId: string): Promise<ClaimRow | undefined> => {
    const { rows } = await ctx.db.superuser.query<ClaimRow>(
      `SELECT lock_no, created_at, created_by, created_pgm_cd, created_tx_id,
              updated_at, updated_by, updated_pgm_cd, updated_tx_id,
              patched_at, patched_by, patched_id
         FROM claim.t_claim WHERE claim_id = $1`,
      [claimId],
    );
    return rows[0];
  };

  it("INSERT で、created_* と updated_* の両方が、バインドした時刻と実行者になること", async () => {
    const { claim_id } = await run(insertClaim(tenantA));

    const row = await readRow(claim_id);

    expect(row).toMatchObject({
      lock_no: 1,
      created_at: new Date("2026-10-29T01:00:00Z"),
      created_by: "creator",
      created_pgm_cd: "claim.create",
      created_tx_id: "tx-create",
      updated_at: new Date("2026-10-29T01:00:00Z"),
      updated_by: "creator",
      updated_pgm_cd: "claim.create",
      updated_tx_id: "tx-create",
      patched_at: null,
      patched_by: null,
      patched_id: null,
    });
  });

  it("UPDATE で、updated_* が更新の時刻と実行者になり、lock_no が 1 上がり、created_* は変わらないこと", async () => {
    const { claim_id } = await run(insertClaim(tenantA));

    const updated = await run(updateClaim(tenantA, claim_id, 1));

    expect(updated).toEqual({ lock_no: 2 });
    expect(await readRow(claim_id)).toMatchObject({
      lock_no: 2,
      created_at: new Date("2026-10-29T01:00:00Z"),
      created_by: "creator",
      updated_at: new Date("2026-10-29T02:00:00Z"),
      updated_by: "updater",
      updated_pgm_cd: "claim.update",
      updated_tx_id: "tx-update",
    });
  });

  it("同じ lock_no で 2 回更新すると、2 回目は OptimisticLockConflict になり、行が変わらないこと", async () => {
    const { claim_id } = await run(insertClaim(tenantA));
    await run(updateClaim(tenantA, claim_id, 1));
    const before = await readRow(claim_id);

    const error = await run(Effect.flip(updateClaim(tenantA, claim_id, 1)));

    expect(error).toBeInstanceOf(OptimisticLockConflict);
    expect(await readRow(claim_id)).toEqual(before);
  });

  it("別のテナントの行は、lock_no が合っていても RowNotFound になること", async () => {
    const { claim_id } = await run(insertClaim(tenantA));

    const error = await run(Effect.flip(updateClaim(tenantB, claim_id, 1)));

    expect(error).toBeInstanceOf(RowNotFound);
    expect((await readRow(claim_id))?.lock_no).toBe(1);
  });

  it("存在しない行は RowNotFound になること", async () => {
    const error = await run(Effect.flip(updateClaim(tenantA, "999999", 1)));

    expect(error).toBeInstanceOf(RowNotFound);
  });

  it("データパッチは patched_* だけを変え、lock_no と updated_* と created_* を変えないこと", async () => {
    const { claim_id } = await run(insertClaim(tenantA));
    const before = await readRow(claim_id);

    await run(patchClaim(tenantA, claim_id));

    expect(await readRow(claim_id)).toEqual({
      ...before,
      patched_at: new Date("2026-10-29T03:00:00Z"),
      patched_by: "patcher",
      patched_id: "TICKET-42",
    });
  });
});
