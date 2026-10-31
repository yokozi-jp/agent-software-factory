// The entry `@agent-software-factory/shared-kernel/messaging` (docs/adr/0051). The Outbox, the consumers and the table of processed messages (docs/adr/0029, 0041).
export { enqueueOutbox, type OutboxEvent } from "./outbox.ts";
export {
  defineConsumer,
  registeredConsumers,
  type ConsumeResult,
  type RegisteredConsumer,
} from "./consumer.ts";
export {
  isMessageProcessed,
  recordProcessedMessage,
  type ConsumedMessage,
} from "./processed-message.ts";
