import { describe, expect, it } from "vite-plus/test";

import {
  createdColumns,
  patchedColumns,
  updatedColumns,
  type WriteContext,
} from "./common-columns.ts";

// 共通カラムの値の入れ方 (docs/db/postgresql-keys.md)。時刻は呼び出し側が取った 1 つの値で、関数は時計を読まない。
const ctx: WriteContext = {
  at: Temporal.Instant.from("2026-10-29T09:30:00Z"),
  actor: "user-1",
  pgmCd: "claim.create",
  txId: "tx-1",
};

describe("createdColumns", () => {
  it("作成系と更新系の両方に、バインドする時刻と実行者を入れること", () => {
    expect(createdColumns(ctx)).toEqual({
      created_at: "2026-10-29T09:30:00Z",
      created_by: "user-1",
      created_pgm_cd: "claim.create",
      created_tx_id: "tx-1",
      updated_at: "2026-10-29T09:30:00Z",
      updated_by: "user-1",
      updated_pgm_cd: "claim.create",
      updated_tx_id: "tx-1",
    });
  });

  it("lock_no を含めないこと (DB の既定値 1 に任せる)", () => {
    expect(createdColumns(ctx)).not.toHaveProperty("lock_no");
  });
});

describe("updatedColumns", () => {
  it("更新系だけを入れ、作成系を含めないこと", () => {
    const columns = updatedColumns(ctx);

    expect(columns).toMatchObject({
      updated_at: "2026-10-29T09:30:00Z",
      updated_by: "user-1",
      updated_pgm_cd: "claim.create",
      updated_tx_id: "tx-1",
    });
    expect(Object.keys(columns).filter((name) => name.startsWith("created_"))).toEqual([]);
  });

  it("lock_no を 1 上げる式を含むこと", () => {
    expect(updatedColumns(ctx)).toHaveProperty("lock_no");
  });
});

describe("patchedColumns", () => {
  it("patched_* だけを入れ、updated_* と lock_no を含めないこと", () => {
    expect(patchedColumns(ctx, "TICKET-42")).toEqual({
      patched_at: "2026-10-29T09:30:00Z",
      patched_by: "user-1",
      patched_id: "TICKET-42",
    });
  });
});
