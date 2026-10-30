import { Pool, TypeOverrides, type PoolConfig } from "pg";

// PostgreSQL の型の OID。
const oidTimestamp = 1114;
const oidTimestamptz = 1184;
const oidDate = 1082;
// 配列の型。要素を Temporal にする parser は、使う列ができたときに足す。それまでは Date の配列を返さず、例外にする。
const oidArrayTypes = [1115, 1185, 1182]; // timestamp[]、timestamptz[]、date[]

/** 読んだら例外にする parser。 */
const refuse = (message: string) => (): never => {
  throw new Error(message);
};

/**
 * pg が日時を読む型 (docs/adr/0043)。pg の既定は `timestamptz`、`timestamp`、`date` のすべてを `Date` で返し、
 * `date` はプロセスの TZ の 0 時になる。ここでは `Temporal` で読む。global の `types.setTypeParser` は使わず、
 * この接続だけに効かせる。日時以外の型は pg の既定のまま。`Temporal` は global を前提にする (入口が polyfill を import する)。
 */
function temporalTypes(): TypeOverrides {
  const overrides = new TypeOverrides();
  overrides.setTypeParser(oidTimestamptz, (text: string) => Temporal.Instant.from(text));
  overrides.setTypeParser(oidDate, (text: string) => Temporal.PlainDate.from(text));
  overrides.setTypeParser(
    oidTimestamp,
    refuse("timestamp (タイムゾーン無し) は使わない。timestamptz にする (docs/adr/0043)"),
  );
  for (const oid of oidArrayTypes) {
    overrides.setTypeParser(
      oid,
      refuse("日時の配列は読めない。要素を Temporal にする parser を足す (docs/adr/0043)"),
    );
  }
  return overrides;
}

/**
 * 接続の待ちを有限にする設定 (docs/db/postgresql-client.md)。pool を作る入口は、必ずこれを入れる。
 * - `connectionTimeoutMillis`: pool が空のとき、接続を待つ長さ。トランザクションを始める処理は中断できず、
 *   `Effect.timeout` では待ちを切れないので、ここで切る。
 * - `idle_in_transaction_session_timeout`: `BEGIN` の後に何も送らない接続を、PostgreSQL が切るまでの長さ。
 */
export const poolTimeouts = {
  connectionTimeoutMillis: 5_000,
  idle_in_transaction_session_timeout: 30_000,
} as const;

/**
 * アプリの接続 (`Pool`)。`poolTimeouts` を既定で入れる。`timestamptz` を `Temporal.Instant`、`date` を `Temporal.PlainDate` で読み、`timestamp` は例外にする。
 * 書きは `Temporal` の値をパラメータに渡さず、`toString()` の文字列で渡す (pg は値を JSON の文字列で送る)。
 */
export function createPool(config: PoolConfig): Pool {
  return new Pool({ ...poolTimeouts, ...config, types: temporalTypes() });
}
