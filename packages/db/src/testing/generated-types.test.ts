import type { ClaimDatabase } from "@agent-software-factory/claim";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";

// 生成した型 (packages/*/src/infrastructure/db.gen.ts、src/types.ts の typeMapping) は、日時の読みを Temporal にし、
// 書きを string に限る (docs/adr/0043)。型検査 (`vp check`) が確かめる。実行時には何も呼ばない。
declare const claims: ClaimDatabase;

/** 呼ばない。型の検査のためだけに置く。 */
export function typeChecks(instant: Temporal.Instant): void {
  void claims
    .selectFrom("claim.t_claim")
    .select(["created_at", "patched_at"])
    .execute()
    .then(([row]) => {
      expectTypeOf(row?.created_at).toEqualTypeOf<Temporal.Instant | undefined>();
      expectTypeOf(row?.patched_at).toEqualTypeOf<Temporal.Instant | null | undefined>();
    });
  // 書きは string を受ける。
  claims.updateTable("claim.t_claim").set({ updated_at: instant.toString() });
  // @ts-expect-error -- Temporal.Instant は書きの値にできない。toString() の文字列で渡す。
  claims.updateTable("claim.t_claim").set({ updated_at: instant });
}

describe("生成した型の日時", () => {
  it("型の検査を置いたファイルであること (検査は vp check の型検査)", () => {
    expect(typeof typeChecks).toBe("function");
  });
});
