import type { ClaimDatabase } from "@agent-software-factory/claim";
import { describe, expectTypeOf, it } from "vite-plus/test";

// 生成した型 (packages/*/src/infrastructure/db.gen.ts、src/types.ts の typeMapping) は、日時の読みを Temporal にし、
// 書きを string に限る (docs/adr/0043)。Vitest の typecheck が確かめる (vite.config.ts の `typecheck`、docs/adr/0020)。
// Vitest はこのファイルを実行せず、型の検査だけをする。`vp check` の型検査も同じファイルを読む。
declare const claims: ClaimDatabase;
declare const instant: Temporal.Instant;

describe("生成した型の日時", () => {
  it("読みは Temporal.Instant で、NULL を許す列は null も返す", () => {
    const query = claims.selectFrom("claim.t_claim").select(["created_at", "patched_at"]);
    expectTypeOf(query.executeTakeFirstOrThrow()).resolves.toEqualTypeOf<{
      created_at: Temporal.Instant;
      patched_at: Temporal.Instant | null;
    }>();
  });

  it("書きは string を受け、Temporal.Instant は受けない", () => {
    claims.updateTable("claim.t_claim").set({ updated_at: instant.toString() });
    // @ts-expect-error -- Temporal.Instant は書きの値にできない。toString() の文字列で渡す。
    claims.updateTable("claim.t_claim").set({ updated_at: instant });
  });
});
