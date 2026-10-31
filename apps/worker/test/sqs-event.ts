import type { SQSEvent, SQSRecord } from "aws-lambda";

/** Lambda の event source mapping が渡す SQS のレコードの形 (SQS のイベントの形の値、docs/adr/0041)。 */
export function sqsRecord(messageId: string, body: string): SQSRecord {
  return {
    messageId,
    receiptHandle: `receipt-${messageId}`,
    body,
    attributes: {
      ApproximateReceiveCount: "1",
      SentTimestamp: "1761789723000",
      SenderId: "AIDAEXAMPLE",
      ApproximateFirstReceiveTimestamp: "1761789723001",
    },
    messageAttributes: {},
    md5OfBody: "0".repeat(32),
    eventSource: "aws:sqs",
    eventSourceARN: "arn:aws:sqs:ap-northeast-1:000000000000:notification-mail",
    awsRegion: "ap-northeast-1",
  };
}

export const sqsEvent = (records: readonly SQSRecord[]): SQSEvent => ({ Records: [...records] });
