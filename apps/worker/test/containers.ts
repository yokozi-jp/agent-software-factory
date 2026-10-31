import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

// ElasticMQ と Mailpit の版。ElasticMQ は 1.7.1 で調べた (Issue #347)。Mailpit は調べた時点の最新。
const elasticMqImage = "softwaremill/elasticmq:1.7.1";
const mailpitImage = "axllent/mailpit:v1.33.0";

// キューの URL に、リクエストの Host を使わせる。既定は localhost:9324 で、コンテナの外から割り当てられたポートでは
// 届かない URL を返す。ElasticMQ の設定の `node-address.host = "*"` がその指定。
const elasticMqConfig = `include classpath("application.conf")

node-address {
  protocol = http
  host = "*"
  context-path = ""
}
`;

/** ElasticMQ (SQS の代わり) を起動する。キューは作らない (createNotificationQueues がテストごとに作る)。 */
export function startElasticMq(): Promise<StartedTestContainer> {
  return new GenericContainer(elasticMqImage)
    .withExposedPorts(9324)
    .withCopyContentToContainer([{ content: elasticMqConfig, target: "/opt/elasticmq.conf" }])
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
}

/** Mailpit (SES の代わりに SMTP で受け、HTTP の API で読めるメールサーバー) を起動する。SMTP は 1025、API は 8025。 */
export function startMailpit(): Promise<StartedTestContainer> {
  return new GenericContainer(mailpitImage)
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp("/livez", 8025))
    .start();
}
