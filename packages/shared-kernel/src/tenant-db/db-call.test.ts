import { Context, Effect, Exit } from "effect";
import type { QueryExecutorProvider } from "kysely";
import { describe, expect, it } from "vite-plus/test";

import { dbCallUnique, UniqueViolation } from "./db-call.ts";

// dbCallUnique が、`run` の失敗のどれを UniqueViolation にし、どれを defect にするか (docs/adr/0028)。
// 本物の PostgreSQL の失敗は apps/api/src/db/tenant-transaction.test.ts が確かめる。ここで確かめるのは、そこで起こせない形
// (object でない失敗、constraint のない 23505) の扱い。偽装するのは driver ではなく、`run` が返す失敗の形だけである。
class TestTx extends Context.Service<TestTx, QueryExecutorProvider>()("shared-kernel/TestTx") {
  static readonly module = "claim" as const;
}

// `run` は transaction を使わないので、executor は呼ばれない。
const unused: QueryExecutorProvider = {
  getExecutor: () => {
    throw new Error("The executor is not used");
  },
};

/** `run` が `reason` で reject したときの、dbCallUnique。 */
const rejectedWith = (reason: unknown) =>
  dbCallUnique(TestTx, () =>
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- 確かめるのは、Error でない失敗の扱いである
    Promise.reject(reason),
  ).pipe(Effect.provideService(TestTx, unused));

/** 型つきの失敗 (UniqueViolation) の値。defect になったときは、テストが失敗する。 */
const violationOf = (reason: unknown) => Effect.runPromise(Effect.flip(rejectedWith(reason)));

describe("dbCallUnique", () => {
  it("23505 と constraint の名前がある失敗を、その名前の UniqueViolation にすること", async () => {
    expect(await violationOf({ code: "23505", constraint: "t_claim_pkey" })).toEqual(
      new UniqueViolation({ constraint: "t_claim_pkey" }),
    );
  });

  it("23505 に constraint がなければ、名前が空の UniqueViolation にすること", async () => {
    expect(await violationOf({ code: "23505" })).toEqual(new UniqueViolation({ constraint: "" }));
  });

  it("23505 の constraint が文字列でなければ、名前が空の UniqueViolation にすること", async () => {
    expect(await violationOf({ code: "23505", constraint: 7 })).toEqual(
      new UniqueViolation({ constraint: "" }),
    );
  });

  it.each([
    ["object でない値", "23505"],
    ["null", null],
    ["undefined", undefined],
    ["code のない object", { constraint: "t_claim_pkey" }],
    ["23505 でない code", { code: "40001", constraint: "t_claim_pkey" }],
    ["数値の 23505", { code: 23_505 }],
  ])("%s の失敗は、型つきの失敗にせず defect にすること", async (_name, reason) => {
    const exit = await Effect.runPromise(Effect.exit(rejectedWith(reason)));

    expect(Exit.hasDies(exit)).toBe(true);
    expect(Exit.hasFails(exit)).toBe(false);
  });
});
