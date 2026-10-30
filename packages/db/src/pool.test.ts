import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { createPool } from "./pool.ts";
import { createTestDatabase, type TestDatabase } from "./testing/database.ts";

// アプリの接続が日時を Temporal で読むこと (src/pool.ts、docs/adr/0043)。Vitest の TZ は America/New_York。
describe("createPool: 日時を Temporal で読む", () => {
  let db: TestDatabase;
  let pool: ReturnType<typeof createPool>;

  beforeEach(async () => {
    db = await createTestDatabase();
    pool = createPool({ connectionString: db.url("app_user") });
  });

  afterEach(async () => {
    await pool.end();
    await db.close();
  });

  const read = async (sql: string, values: unknown[] = []): Promise<unknown> =>
    (await pool.query<{ value: unknown }>(sql, values)).rows[0]?.value;

  it("プロセスの TZ が America/New_York でも、タイムゾーンが -04 の timestamptz を Temporal.Instant で読むこと", async () => {
    const value = await read(`SELECT '2026-03-31 23:30-04'::timestamptz AS value`);

    expect(value).toBeInstanceOf(Temporal.Instant);
    expect(String(value)).toBe("2026-04-01T03:30:00Z");
  });

  it("date を、プロセスの TZ に依らず Temporal.PlainDate で読むこと", async () => {
    const value = await read(`SELECT '2026-03-31'::date AS value`);

    expect(value).toBeInstanceOf(Temporal.PlainDate);
    expect(String(value)).toBe("2026-03-31");
  });

  it("Temporal.Instant と Temporal.PlainDate を toString() で書いて読み戻すと、マイクロ秒まで同じ値になること", async () => {
    const instant = Temporal.Instant.from("2026-04-01T02:00:00.123456789Z");
    const microsecond = instant.round({ smallestUnit: "microsecond" });
    const day = Temporal.PlainDate.from("2026-03-31");
    const connection = await pool.connect();
    try {
      await connection.query(`CREATE TEMP TABLE t_roundtrip (at timestamptz, day date)`);
      await connection.query(`INSERT INTO t_roundtrip VALUES ($1, $2)`, [
        microsecond.toString(),
        day.toString(),
      ]);
      const { rows } = await connection.query<{ at: unknown; day: unknown }>(
        `SELECT at, day FROM t_roundtrip`,
      );

      expect(String(rows[0]?.at)).toBe("2026-04-01T02:00:00.123457Z");
      expect(String(rows[0]?.day)).toBe("2026-03-31");
    } finally {
      connection.release();
    }
  });

  it("timestamp (タイムゾーン無し) を読むと、例外になること", async () => {
    await expect(read(`SELECT '2026-03-31 23:30'::timestamp AS value`)).rejects.toThrow(
      /timestamptz/,
    );
  });

  it("日時以外の型は、pg の既定のまま読むこと", async () => {
    expect(await read(`SELECT 42 AS value`)).toBe(42);
    expect(await read(`SELECT 'text' AS value`)).toBe("text");
  });

  it("バイナリ形式の要求は、pg の既定の parser に任せること", () => {
    expect(typeof pool.options.types?.getTypeParser(1184, "binary")).toBe("function");
  });
});
