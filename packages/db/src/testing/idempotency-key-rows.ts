import type { Pool } from "pg";

/** 冪等キーの行の期限: `expired` は 1 時間前、`alive` は 1 時間後。SQL には固定の式だけを入れる。 */
export type ExpiryExpression = "expired" | "alive";

const expiry: Readonly<Record<ExpiryExpression, string>> = {
  expired: "now() - interval '1 hour'",
  alive: "now() + interval '1 hour'",
};

/**
 * `module` の `idempotency_key` に、`tenantId` の行を `count` 件、`expiry` の期限で書く。superuser が直接書くので RLS は効かない。
 * 掃除の試験 (Issue #325) が、期限切れと期限内の行を用意するのに使う。`key` を渡すと、その 1 つのキーの行を作る (`count` は 1)。
 */
export async function seedIdempotencyKeys(
  superuser: Pool,
  rows: {
    readonly module: string;
    readonly tenantId: string;
    readonly count: number;
    readonly expiry: ExpiryExpression;
    readonly key?: string | undefined;
    readonly userId?: string | undefined;
  },
): Promise<void> {
  await superuser.query(
    `INSERT INTO ${quoteIdentifier(rows.module)}.idempotency_key
       (tenant_id, user_id, idempotency_key, request_hash, status_code, expires_at,
        created_at, created_by, created_pgm_cd, created_tx_id,
        updated_at, updated_by, updated_pgm_cd, updated_tx_id)
     SELECT $1::uuid, COALESCE($2::uuid, gen_random_uuid()), COALESCE($3::uuid, gen_random_uuid()),
            repeat('a', 64), 201, ${expiry[rows.expiry]},
            now(), 'seed', 'seed', 'seed', now(), 'seed', 'seed', 'seed'
     FROM generate_series(1, $4::int)`,
    [rows.tenantId, rows.userId ?? null, rows.key ?? null, rows.count],
  );
}

/** `module` の `idempotency_key` の、`tenantId` の行の数。 */
export async function countIdempotencyKeys(
  superuser: Pool,
  module: string,
  tenantId: string,
): Promise<number> {
  const { rows } = await superuser.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${quoteIdentifier(module)}.idempotency_key WHERE tenant_id = $1`,
    [tenantId],
  );
  return Number(rows[0]?.n);
}

function quoteIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Invalid schema name: ${name}`);
  return `"${name}"`;
}
