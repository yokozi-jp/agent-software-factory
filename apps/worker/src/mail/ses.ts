import { MailSender, MailSendFailed } from "@agent-software-factory/approval";
import { SendEmailCommand, type SESv2Client } from "@aws-sdk/client-sesv2";
import { Effect, Layer } from "effect";

/**
 * `MailSender` on SES v2 `SendEmail`. The AWS SDK retries a failed call by itself (docs/adr/0023); a failure after
 * the retries is `MailSendFailed`, so the message is delivered again. `SendEmail` has no idempotency key, so a call that
 * the SDK repeats after a timeout may send two mails (docs/adr/0041).
 *
 * There is no mock of SES (docs/adr/0041): this layer is checked against the real SES in the verification environment. In the
 * local environment and CI, `SmtpMailSenderLayer` takes its place.
 */
export const SesMailSenderLayer = (config: {
  readonly client: SESv2Client;
  readonly from: string;
}): Layer.Layer<MailSender> =>
  Layer.succeed(
    MailSender,
    MailSender.of({
      send: (mail) =>
        Effect.tryPromise({
          try: () =>
            config.client.send(
              new SendEmailCommand({
                FromEmailAddress: config.from,
                Destination: { ToAddresses: [mail.to] },
                Content: {
                  Simple: {
                    Subject: { Data: mail.subject, Charset: "UTF-8" },
                    Body: { Text: { Data: mail.text, Charset: "UTF-8" } },
                  },
                },
              }),
            ),
          catch: (cause) => new MailSendFailed({ cause }),
        }).pipe(Effect.asVoid),
    }),
  );
