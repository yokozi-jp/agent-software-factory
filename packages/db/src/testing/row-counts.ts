import type { Pool } from "pg";

/** `<スキーマ>.<表>` をキーにした、表ごとの行数。 */
export type RowCounts = Readonly<Record<string, number>>;

// 数えないスキーマ。auth は Better Auth が、migrations は dbmate が書く。業務の処理の原子性とは関係がない (ADR 0025)。
const excludedSchemas = ["pg_catalog", "information_schema", "pg_toast", "auth", "migrations"];

/**
 * 全表の行数を数える。`pool` は superuser の接続にする。superuser は RLS を通らないので、全テナントの行が数えられる。
 * superuser でない接続は、RLS で行が見えず、少なく数えて「行が残っていない」と誤って通るので、数える前に失敗する。
 * 表の名前を知らなくても、新しく足したモジュールの表も数えるので、「どの表にも行が残らない」ことを確かめられる。
 * 数えるのは通常の表と、パーティション表の子だけで、パーティション表の親は子と二重になるので数えない。
 * 一時テーブルは接続ごとのもので、ほかの接続からは読めないので数えない。
 * 行数だけを比べる。既存の行の更新や、行を 1 つ足して 1 つ消す変化は、差に出ない。
 */
export async function snapshotRowCounts(pool: Pool): Promise<RowCounts> {
  const { rows: roles } = await pool.query<{ superuser: boolean }>(
    "SELECT current_setting('is_superuser') = 'on' AS superuser",
  );
  if (roles[0]?.superuser !== true) {
    throw new Error(
      "snapshotRowCounts は superuser の接続で呼ぶこと: そうでない接続は RLS で行が見えず、少なく数える",
    );
  }
  const { rows } = await pool.query<{ name: string; count: string }>(
    `SELECT n.nspname || '.' || c.relname AS name,
            (xpath('/row/c/text()',
                   query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
                                false, true, '')))[1]::text AS count
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND c.relpersistence <> 't'
        AND n.nspname <> ALL ($1::text[])
        AND n.nspname NOT LIKE 'pg\\_temp\\_%'
        AND n.nspname NOT LIKE 'pg\\_toast\\_temp\\_%'`,
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
