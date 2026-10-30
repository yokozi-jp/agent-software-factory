import { Pool, TypeOverrides, type PoolConfig } from "pg";

// PostgreSQL の型の OID。
const oidTimestamp = 1114;
const oidTimestamptz = 1184;
const oidDate = 1082;

/**
 * pg が日時を読む型 (docs/adr/0043)。pg の既定は `timestamptz`、`timestamp`、`date` のすべてを `Date` で返し、
 * `date` はプロセスの TZ の 0 時になる。ここでは `Temporal` で読む。global の `types.setTypeParser` は使わず、
 * この接続だけに効かせる。日時以外の型は pg の既定のまま。`Temporal` は global を前提にする (入口が polyfill を import する)。
 */
function temporalTypes(): TypeOverrides {
  const overrides = new TypeOverrides();
  overrides.setTypeParser(oidTimestamptz, (text: string) => Temporal.Instant.from(text));
  overrides.setTypeParser(oidDate, (text: string) => Temporal.PlainDate.from(text));
  overrides.setTypeParser(oidTimestamp, () => {
    throw new Error("timestamp (タイムゾーン無し) は使わない。timestamptz にする (docs/adr/0043)");
  });
  return overrides;
}

/**
 * アプリの接続 (`Pool`)。`timestamptz` を `Temporal.Instant`、`date` を `Temporal.PlainDate` で読み、`timestamp` は例外にする。
 * 書きは `Temporal` の値をパラメータに渡さず、`toString()` の文字列で渡す (pg は値を JSON の文字列で送る)。
 */
export function createPool(config: PoolConfig): Pool {
  return new Pool({ ...config, types: temporalTypes() });
}
