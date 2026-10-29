import { setTimeout as sleep } from "node:timers/promises";
import type { Pool } from "pg";

export interface BlockedSessions {
  /** 待つ側 (B) の `pg_backend_pid()`。 */
  readonly waiter: number;
  /** 待たせる側 (A) の `pg_backend_pid()`。commit せずにロックを持っている。 */
  readonly holder: number;
}

// 待ちを確かめる間隔 (ミリ秒)。
const intervalMs = 20;

export interface AwaitBlockedOptions {
  /** 待ちを見つけるまでの上限 (ミリ秒)。超えたら失敗する。既定は 10 秒。 */
  readonly timeoutMs?: number;
}

/**
 * `waiter` の接続が `holder` の接続のロックを待つまで、`pg_blocking_pids()` で確かめ続ける。
 * 競合を決定的に再現するための待ち合わせで、`sleep` で待つ代わりに使う (docs/db/concurrency-testing.md)。
 * 行ロックの待ちも、一意索引の待ちも、相手のトランザクションの終わりを待つので検出できる。
 * `pool` は、待ち合わせに使う 2 つの接続とは別の接続から、`pg_blocking_pids()` を呼ぶために使う。
 * 時間が過ぎても待ちが見つからなければ、2 つの pid と、`waiter` を実際に待たせている接続を示して失敗する。
 * `waiter` の文がエラーで終わったときも、ここでは見分けられず、上限の時間の後に失敗する。メッセージの
 * 「待たせている接続」が空なら、`waiter` は何も待っていない。
 */
export async function awaitBlocked(
  pool: Pool,
  { waiter, holder }: BlockedSessions,
  { timeoutMs = 10_000 }: AwaitBlockedOptions = {},
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const { rows } = await pool.query<{ blockers: number[] }>(
      "SELECT pg_blocking_pids($1::int) AS blockers",
      [waiter],
    );
    const blockers = rows[0]?.blockers ?? [];
    if (blockers.includes(holder)) return;
    if (performance.now() >= deadline) {
      throw new Error(
        `接続 ${waiter} が接続 ${holder} のロックを待つ状態を、${timeoutMs} ミリ秒のあいだ確かめられませんでした` +
          `(待たせている接続: ${blockers.length === 0 ? "なし" : blockers.join(", ")})`,
      );
    }
    await sleep(intervalMs);
  }
}
