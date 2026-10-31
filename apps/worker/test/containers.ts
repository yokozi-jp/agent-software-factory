import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

// ElasticMQ と Mailpit のイメージと、ElasticMQ の設定は、手で動かす環境 (compose.local.yaml、docs/tooling/local-worker.md)
// と同じものを読む。版と設定を 2 か所に持たない。ElasticMQ は 1.7.1 で調べた (Issue #347)。
const composeFile = fileURLToPath(new URL("../../../compose.local.yaml", import.meta.url));
const elasticMqConfigFile = fileURLToPath(
  new URL("../../../docker/elasticmq.conf", import.meta.url),
);

function composeImage(repository: string): string {
  const match = new RegExp(`^\\s*image:\\s*(${repository}:\\S+)\\s*$`, "m").exec(
    readFileSync(composeFile, "utf8"),
  );
  if (match?.[1] === undefined) throw new Error(`${composeFile} に ${repository} の image がない`);
  return match[1];
}

/** ElasticMQ (SQS の代わり) を起動する。キューは作らない (createNotificationQueues がテストごとに作る)。 */
export function startElasticMq(): Promise<StartedTestContainer> {
  return new GenericContainer(composeImage("softwaremill/elasticmq"))
    .withExposedPorts(9324)
    .withCopyFilesToContainer([{ source: elasticMqConfigFile, target: "/opt/elasticmq.conf" }])
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
}

/** Mailpit (SES の代わりに SMTP で受け、HTTP の API で読めるメールサーバー) を起動する。SMTP は 1025、API は 8025。 */
export function startMailpit(): Promise<StartedTestContainer> {
  return new GenericContainer(composeImage("axllent/mailpit"))
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp("/livez", 8025))
    .start();
}
