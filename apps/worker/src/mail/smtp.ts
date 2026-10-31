import { MailSender, MailSendFailed } from "@agent-software-factory/approval";
import { Effect, Layer } from "effect";
import nodemailer from "nodemailer";

/**
 * `MailSender` that sends over SMTP without TLS, to Mailpit in the local environment and in CI (docs/adr/0013,
 * docs/adr/0041). It is not for production: SES sends there (`SesMailSenderLayer`), and there is no mock of SES. A refusal or
 * a network error is `MailSendFailed`, so the message is delivered again.
 */
export const SmtpMailSenderLayer = (config: {
  readonly host: string;
  readonly port: number;
  readonly from: string;
}): Layer.Layer<MailSender> =>
  // The transport opens a connection for each mail and keeps none (it is not a pool), so there is nothing to close.
  Layer.effect(
    MailSender,
    Effect.sync(() => {
      const transport = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        ignoreTLS: true,
      });
      return MailSender.of({
        send: (mail) =>
          Effect.tryPromise({
            try: () =>
              transport.sendMail({
                from: config.from,
                to: mail.to,
                subject: mail.subject,
                text: mail.text,
              }),
            catch: (cause) => new MailSendFailed({ cause }),
          }).pipe(Effect.asVoid),
      });
    }),
  );
