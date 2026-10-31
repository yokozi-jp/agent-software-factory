import {
  purgeExpiredIdempotencyKeys,
  type Database,
  type ModuleName,
  type ModuleTx,
  type PurgeResult,
} from "@agent-software-factory/shared-kernel";
import { Effect } from "effect";

// 期限切れの冪等キーを消すバッチの本体 (Issue #325、docs/adr/0040)。入口 (purge-idempotency-keys.ts) が環境変数を検査して呼ぶ。
// 1 回の実行は 1 つのテナントを受け持つ。テナントを回すのは Step Functions の Map で、アプリではない (docs/adr/0042 と同じ形)。

/**
 * 冪等キーの表 `idempotency_key` を持つモジュールの Tx。書き込みの API を持つモジュールが、migration で表を足すときに、同じ変更でここへ足す。
 * 食い違えば `purge-idempotency-keys-job.test.ts` が、DB のスキーマと比べて失敗する。
 */
export const idempotencyKeyModules: readonly ModuleTx[] = [];

/** バッチのプログラム名。共通カラムの `*_by` (バッチでは pgmCd と同じ) と `*_pgm_cd` に入る。 */
const PURGE_PGM_CD = "purge-idempotency-keys";

export interface PurgeJobInput {
  readonly modules: readonly ModuleTx[];
  readonly tenantId: string;
  /** Step Functions の実行名。共通カラムの `tx_id` に入る (docs/adr/0042)。 */
  readonly txId: string;
  readonly batchSize?: number | undefined;
}

/** モジュールごとの結果。1 つのトランザクションは 1 つのモジュールの表だけを書くので (docs/adr/0029)、モジュールを順に回す。 */
export type PurgeJobResult = Readonly<Partial<Record<ModuleName, PurgeResult>>>;

export const runPurgeJob = (input: PurgeJobInput): Effect.Effect<PurgeJobResult, never, Database> =>
  Effect.gen(function* () {
    const results: Partial<Record<ModuleName, PurgeResult>> = {};
    for (const tx of input.modules) {
      results[tx.module] = yield* purgeExpiredIdempotencyKeys(
        tx,
        {
          tenantId: input.tenantId,
          actor: PURGE_PGM_CD,
          pgmCd: PURGE_PGM_CD,
          txId: input.txId,
        },
        input.batchSize === undefined ? {} : { batchSize: input.batchSize },
      );
    }
    return results;
  });

/** 終了のログの 1 行 (`batch.stats`)。件数だけで、行の中身は書かない。 */
export function purgeFinishedLine(input: PurgeJobInput, result: PurgeJobResult): string {
  return JSON.stringify({
    level: "info",
    event: "idempotency_key_purge_finished",
    txId: input.txId,
    tenantId: input.tenantId,
    "batch.stats": result,
  });
}
