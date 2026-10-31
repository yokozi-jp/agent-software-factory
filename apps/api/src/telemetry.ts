// トレースの起動 (docs/adr/0048)。server.ts が最初に import する。ES module は import の順に評価されるので、
// `pg` などを import するファイルより前にこのファイルが評価され、計装がそれらの module を差し替えられる。
// 入口のファイルなので、環境変数をここで読んで渡す (docs/adr/0032)。送り先は OTEL_EXPORTER_OTLP_ENDPOINT。
import { startTelemetry } from "@agent-software-factory/telemetry/node";

export const telemetry = startTelemetry({ env: process.env, serviceName: "api" });
