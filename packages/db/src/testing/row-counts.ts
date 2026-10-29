import type { Pool } from "pg";

/** `<スキーマ>.<表>` をキーにした、表ごとの行数。 */
export type RowCounts = Readonly<Record<string, number>>;

// 数えないスキーマ。auth は Better Auth が、migrations は dbmate が書く。業務の処理の原子性とは関係がない (ADR 0025)。
const excludedSchemas = ["pg_catalog", "information_schema", "pg_toast", "auth", "migrations"];

/**
 * 全表の行数を数える。`pool` は superuser の接続にする。superuser は RLS を通らないので、全テナントの行が数えられる。
 * 表の名前を知らなくても、新しく足したモジュールの表も数えるので、「どの表にも行が残らない」ことを確かめられる。
 */
export async function snapshotRowCounts(pool: Pool): Promise<RowCounts> {
  const { rows } = await pool.query<{ name: string; count: string }>(
    `SELECT schemaname || '.' || tablename AS name,
            (xpath('/row/c/text()',
                   query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, tablename),
                                false, true, '')))[1]::text AS count
       FROM pg_tables
      WHERE schemaname <> ALL ($1::text[])`,
    [excludedSchemas],
  );
  return Object.fromEntries(rows.map(({ name, count }) => [name, Number(count)]));
}

/** 前後の行数の差。差がある表だけを、増えた行数 (減ったら負の数) で返す。現れた表と消えた表は 0 からの差にする。 */
export function diffRowCounts(before: RowCounts, after: RowCounts): Record<string, number> {
  const diff: Record<string, number> = {};
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const change = (after[name] ?? 0) - (before[name] ?? 0);
    if (change !== 0) diff[name] = change;
  }
  return diff;
}
