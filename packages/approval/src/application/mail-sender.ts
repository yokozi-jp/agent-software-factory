import { Context, Data, type Effect } from "effect";

/** A mail to send: the address, the subject and the plain-text body. The sender adds the From address of the system. */
export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/**
 * A mail that could not be sent (the server refused it, or could not be reached). No caller branches on it: nothing in
 * `application` answers differently for a refusal, so it is a defect, not a typed failure (docs/domain-model/application-effect.md,
 * "失敗の扱い"). The layers die with it, the worker rejects, and the message goes back to the queue and is delivered again
 * (docs/adr/0041). `cause` is what the transport threw.
 */
export class MailSendFailed extends Data.TaggedError("MailSendFailed")<{
  readonly cause: unknown;
}> {
  /**
   * What the log shows: the kind of the error (`name` and `code`, such as `Error ECONNECTION` or `MessageRejected`) and
   * nothing from its text. The text of a refusal often has the address of the person, which a log must not have.
   */
  override get message(): string {
    const { cause } = this;
    if (typeof cause !== "object" || cause === null) return "The mail could not be sent";
    const name = "name" in cause && typeof cause.name === "string" ? cause.name : "unknown";
    const code = "code" in cause && typeof cause.code === "string" ? ` ${cause.code}` : "";
    return `The mail could not be sent: ${name}${code}`;
  }
}

/**
 * Sends one mail. The entry file of a worker provides the implementation as a `Layer`: SES in production, SMTP to
 * Mailpit locally and in CI (docs/adr/0013). The module does not import an SDK (docs/adr/0029), so the module asks
 * for this port and the entry file decides how it is sent.
 *
 * SES gives no idempotency key to `SendEmail`, so a send that is repeated sends a second mail (docs/adr/0041).
 */
export class MailSender extends Context.Service<
  MailSender,
  { readonly send: (mail: OutgoingMail) => Effect.Effect<void> }
>()("approval/MailSender") {}
