import { NotificationStoreLayer } from "@agent-software-factory/approval";
import type { MailSender } from "@agent-software-factory/approval";
import { createDatabase } from "@agent-software-factory/db/node";
import { Database } from "@agent-software-factory/shared-kernel/tenant-db";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { Layer, ManagedRuntime } from "effect";
import type { Kysely } from "kysely";

import type { WorkerEnv } from "./env.ts";
import { SesMailSenderLayer } from "./mail/ses.ts";
import { SmtpMailSenderLayer } from "./mail/smtp.ts";
import { createNotificationHandler, type NotificationRuntime } from "./notification-worker.ts";
import type { QueueMessage } from "./poller.ts";

/** The mail layer of the environment: SES, or SMTP to Mailpit (local and CI). */
export const mailLayer = (env: WorkerEnv): Layer.Layer<MailSender> =>
  env.MAIL_TRANSPORT === "ses"
    ? // The region and the credentials come from the environment of the SDK (AWS_REGION, the role of the task or function).
      SesMailSenderLayer({ client: new SESv2Client({}), from: env.MAIL_FROM })
    : SmtpMailSenderLayer({ host: env.SMTP_HOST, port: env.SMTP_PORT, from: env.MAIL_FROM });

/**
 * The `ManagedRuntime` of a worker: one per process, made at the start by the entry file and disposed at the stop
 * (docs/adr/0028). The layers hold the mail transport and wrap the pool; they keep no state of a message.
 */
export const createNotificationRuntime = (config: {
  readonly mail: Layer.Layer<MailSender>;
  readonly db: Kysely<never>;
}): NotificationRuntime =>
  ManagedRuntime.make(
    Layer.mergeAll(config.mail, Layer.provide(NotificationStoreLayer, Database.layer(config.db))),
  );

/** What an entry file needs of a worker: the handler of one queue message, and the stop. */
export interface NotificationWorker {
  readonly handle: (message: QueueMessage) => Promise<void>;
  /** Disposes the runtime and closes the pool. */
  readonly close: () => Promise<void>;
}

/** The pool, the runtime and the handler of the worker of this environment, which both entry files make the same way. */
export function createWorker(env: WorkerEnv): NotificationWorker {
  const db = createDatabase({ connectionString: env.APP_DATABASE_URL, max: env.DATABASE_POOL_MAX });
  const runtime = createNotificationRuntime({ mail: mailLayer(env), db });
  return {
    handle: createNotificationHandler(runtime),
    close: async () => {
      await runtime.dispose();
      await db.destroy();
    },
  };
}
