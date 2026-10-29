import { setTimeout as sleep } from "node:timers/promises";
import type { Pool } from "pg";

export interface BlockedSessions {
  /** 待つ側 (B) の `pg_backend_pid()`。 */
  readonly waiter: number;
  /** 待たせる側 (A) の `pg_backend_pid()`。commit せずにロックを持っている。 */
  readonly holder: number;
}

export interface AwaitBlockedOptions {
  /** 待ちを見つけるまでの上限 (ミリ秒)。超えたら失敗する。既定は 10 秒。 */
  readonly timeoutMs?: number;
  /** 確かめる間隔 (ミリ秒)。既定は 20 ミリ秒。 */
  readonly intervalMs?: number;
}

/**
 * `waiter` の接続が `holder` の接続のロックを待つまで、`pg_blocking_pids()` で確かめ続ける。
 * 競合を決定的に再現するための待ち合わせで、`sleep` で待つ代わりに使う (docs/db/concurrency-testing.md)。
 * 行ロックの待ちも、一意索引の待ちも、相手のトランザクションの終わりを待つので検出できる。
 * `pool` は、待ち合わせに使う 2 つの接続とは別の接続から、`pg_blocking_pids()` を呼ぶために使う。
 * 時間が過ぎても待ちが見つからなければ、2 つの pid を示して失敗する。
 */
export async function awaitBlocked(
  pool: Pool,
  { waiter, holder }: BlockedSessions,
  { timeoutMs = 10_000, intervalMs = 20 }: AwaitBlockedOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await pool.query<{ blocked: boolean }>(
      "SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked",
      [holder, waiter],
    );
    if (rows[0]?.blocked === true) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `接続 ${waiter} が接続 ${holder} のロックを待つ状態を、${timeoutMs} ミリ秒のあいだ確かめられませんでした`,
      );
    }
    await sleep(intervalMs);
  }
}
