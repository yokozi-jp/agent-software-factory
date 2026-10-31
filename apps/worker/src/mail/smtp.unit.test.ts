import { MailSender, MailSendFailed } from "@agent-software-factory/approval";
import { Effect, ManagedRuntime } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { SmtpMailSenderLayer } from "./smtp.ts";

describe("SMTP のメール送信", () => {
  it("つながらないサーバーへの送信は、宛先を含まない MailSendFailed の defect になること", async () => {
    const runtime = ManagedRuntime.make(
      SmtpMailSenderLayer({ host: "127.0.0.1", port: 1, from: "noreply@example.test" }),
    );
    const to = "someone-private@example.test";

    const failure: unknown = await runtime.runPromise(
      Effect.gen(function* () {
        const sender = yield* MailSender;
        return yield* sender.send({ to, subject: "s", text: "t" }).pipe(
          Effect.as(undefined),
          Effect.catchDefect((defect) => Effect.succeed(defect)),
        );
      }),
    );
    await runtime.dispose();

    expect(failure).toBeInstanceOf(MailSendFailed);
    expect(String(failure instanceof Error && failure.message)).toBe(
      "The mail could not be sent: Error ESOCKET",
    );
  });

  it("エラーの種類が分からない原因でも、MailSendFailed の文に本文を入れないこと", () => {
    expect(new MailSendFailed({ cause: "refused for a@example.test" }).message).toBe(
      "The mail could not be sent",
    );
    expect(new MailSendFailed({ cause: new Error("a@example.test") }).message).toBe(
      "The mail could not be sent: Error",
    );
    expect(new MailSendFailed({ cause: { name: 1, code: 2 } }).message).toBe(
      "The mail could not be sent: unknown",
    );
  });
});
